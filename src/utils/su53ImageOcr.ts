import { createScheduler, createWorker, OEM, PSM, type Scheduler, type Worker } from 'tesseract.js';
import { LoadedFile } from '../types/su53';
import {
  extractUserCandidateFromText,
  INVALID_USER_TOKENS,
  OcrLine,
  OcrSU53Extraction,
  OcrWord,
  parseSu53Lines,
  stripDiacritics,
} from './su53TextEngine';

export type {
  OcrExtractedEntry,
  OcrLine,
  OcrSU53Extraction,
  OcrWord,
} from './su53TextEngine';
export {
  extractUserCandidateFromText,
  INVALID_USER_TOKENS,
  parseSu53Lines,
};

export interface OcrRgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  sourceScale?: number;
}

interface OcrStrip {
  blob: Blob;
  xOffset: number;
  yOffset: number;
}

interface PreparedOcrImage {
  gray: Uint8Array;
  w: number;
  h: number;
  effectiveScale: number;
  rowInkCount: Uint32Array;
  rowMinX: Int32Array;
  rowMaxX: Int32Array;
  minY: number;
  maxY: number;
  isInvertedRow: Uint8Array;
}

function getLocalOriginPrefix(): string {
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
}

function getOcrPoolSize(): number {
  if (typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)) {
    return Math.min(4, Math.max(2, navigator.hardwareConcurrency));
  }
  return 2;
}

let primaryWorkerPromise: Promise<Worker> | null = null;
let schedulerPromise: Promise<Scheduler> | null = null;
let schedulerReady = false;

async function spawnConfiguredWorker(): Promise<Worker> {
  const origin = getLocalOriginPrefix();
  const worker = await createWorker(
    'eng',
    OEM.LSTM_ONLY,
    {
      workerPath: `${origin}/tesseract/worker/worker.min.js`,
      corePath: `${origin}/tesseract/core`,
      langPath: `${origin}/tesseract/lang`,
    },
    {
      load_system_dawg: '0',
      load_freq_dawg: '0',
      load_punc_dawg: '0',
      load_number_dawg: '0',
    }
  );
  await worker.setParameters({
    user_defined_dpi: '300',
    preserve_interword_spaces: '1',
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_do_invert: '0',
  });
  return worker;
}

function getPrimaryWorker(): Promise<Worker> {
  if (!primaryWorkerPromise) {
    primaryWorkerPromise = spawnConfiguredWorker().catch((err) => {
      primaryWorkerPromise = null;
      throw err;
    });
  }
  return primaryWorkerPromise;
}

function getOcrScheduler(): Promise<Scheduler> {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const scheduler = createScheduler();
      // Aguarda o worker primário baixar/gravar o eng.traineddata.gz no cache local antes de inicializar os demais em paralelo
      const w1 = await getPrimaryWorker();
      scheduler.addWorker(w1);

      const extraCount = getOcrPoolSize() - 1;
      if (extraCount > 0) {
        const extraWorkers = await Promise.all(
          Array.from({ length: extraCount }, () => spawnConfiguredWorker())
        );
        extraWorkers.forEach((w) => scheduler.addWorker(w));
      }

      schedulerReady = true;
      return scheduler;
    })().catch((err) => {
      schedulerPromise = null;
      schedulerReady = false;
      throw err;
    });
  }
  return schedulerPromise;
}

/**
 * Pré-aquece o pool de workers OCR locais em segundo plano assim que uma imagem ou PDF entra na fila,
 * eliminando o tempo de inicialização quando o usuário clicar em Executar.
 */
export function warmUpOcrWorker(): void {
  void getOcrScheduler().catch(() => {
    // Falhas transitórias serão tratadas no momento da extração
  });
}

export function computeTargetOcrScale(origW: number, origH: number): number {
  const maxPixels = 5_500_000;
  const maxDimW = 3400;
  const maxDimH = 2600;

  let scale = origW > 2300 ? 1.35 : origW > 1800 ? 1.5 : origW > 1300 ? 1.75 : 2.0;
  if (origW * scale > maxDimW) scale = maxDimW / origW;
  if (origH * scale > maxDimH) scale = Math.min(scale, maxDimH / origH);
  if (origW * origH * scale * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (origW * origH));
  }
  return Math.max(1, scale);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível decodificar a imagem selecionada.'));
    img.src = src;
  });
}

/**
 * Codifica buffer grayscale em formato binário P5 (PGM) sem compressão PNG:
 * leva < 2 ms na thread principal (vs 1-4 s de canvas.toBlob PNG) e é lido
 * diretamente em memória pelo Leptonica/Tesseract WASM.
 */
function encodeGrayscalePgmBlob(gray: Uint8Array, width: number, height: number): Blob {
  const headerBytes = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const pgm = new Uint8Array(headerBytes.length + gray.length);
  pgm.set(headerBytes, 0);
  pgm.set(gray, headerBytes.length);
  return new Blob([pgm], { type: 'image/x-portable-graymap' });
}

/**
 * Pré-processamento em alta velocidade sobre buffer linear:
 * - Converte RGBA -> luminância com detecção automática de tema escuro SAP
 * - Detecta e inverte faixas contínuas de cabeçalho colorido/escuro com texto branco (ex.: SAP #6780B8)
 * - Aplica contraste adaptativo por linha preservando traços finos e sublinhados
 * - Remove linhas finas e bordas verticais longas de grade sem apagar caracteres adjacentes
 */
function preprocessRgbaToGray(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  effectiveScale: number
): PreparedOcrImage {
  const totalPixels = w * h;
  const gray = new Uint8Array(totalPixels);

  const sampleStep = Math.max(1, Math.floor(totalPixels / 4000));
  const samples = new Uint8Array(Math.ceil(totalPixels / sampleStep));
  let sampleIdx = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const lum = (77 * data[idx] + 150 * data[idx + 1] + 29 * data[idx + 2]) >> 8;
    gray[i] = lum;
    if (i % sampleStep === 0 && sampleIdx < samples.length) {
      samples[sampleIdx++] = lum;
    }
  }

  const sampleView = samples.subarray(0, sampleIdx);
  sampleView.sort();
  const medianLum = sampleView[sampleIdx >> 1] ?? 200;
  if (medianLum < 110) {
    for (let i = 0; i < totalPixels; i++) {
      gray[i] = 255 - gray[i];
    }
  }

  const rowStride = Math.max(1, Math.floor(w / 120));
  const rowVals = new Uint8Array(Math.ceil(w / rowStride));
  const rowMed = new Uint8Array(h);
  const rowP97 = new Uint8Array(h);

  for (let y = 0; y < h; y++) {
    let n = 0;
    const off = y * w;
    for (let x = 0; x < w; x += rowStride) {
      rowVals[n++] = gray[off + x];
    }
    const sub = rowVals.subarray(0, n);
    sub.sort();
    rowMed[y] = sub[n >> 1] ?? 255;
    rowP97[y] = sub[Math.floor(n * 0.97)] ?? 255;
  }

  // Identifica faixas horizontais inteiras de cabeçalhos coloridos (evita bordas escuras nas extremidades)
  const minBandH = Math.max(8, Math.round(8 * effectiveScale));
  const isInvertedRow = new Uint8Array(h);
  let bandHeaderStart = -1;
  for (let y = 0; y <= h; y++) {
    const inBand = y < h && rowMed[y] < 185;
    if (inBand && bandHeaderStart === -1) {
      bandHeaderStart = y;
    } else if (!inBand && bandHeaderStart !== -1) {
      if (y - bandHeaderStart >= minBandH) {
        let sumMed = 0;
        let maxP97 = 0;
        for (let ry = bandHeaderStart; ry < y; ry++) {
          sumMed += rowMed[ry];
          if (rowP97[ry] > maxP97) maxP97 = rowP97[ry];
        }
        const avgMed = sumMed / (y - bandHeaderStart);
        if (maxP97 > avgMed + 30) {
          isInvertedRow.fill(1, bandHeaderStart, y);
        }
      }
      bandHeaderStart = -1;
    }
  }

  for (let y = 0; y < h; y++) {
    const off = y * w;
    if (isInvertedRow[y]) {
      const darkCut = Math.min(185, rowMed[y] + 18);
      const textCut = Math.min(235, Math.max(darkCut + 20, rowMed[y] + 55));
      const span = Math.max(1, textCut - darkCut);
      for (let x = 0; x < w; x++) {
        const p = gray[off + x];
        if (p >= textCut) {
          gray[off + x] = 0;
        } else if (p <= darkCut) {
          gray[off + x] = 255;
        } else {
          gray[off + x] = (((textCut - p) * 255) / span) | 0;
        }
      }
      continue;
    }

    const whiteCut = Math.min(212, Math.max(175, rowMed[y] - 18));
    const blackCut = 48;
    const span = Math.max(1, whiteCut - blackCut);
    for (let x = 0; x < w; x++) {
      const v = gray[off + x];
      if (v >= whiteCut) {
        gray[off + x] = 255;
      } else if (v <= blackCut) {
        gray[off + x] = 0;
      } else {
        gray[off + x] = (((v - blackCut) * 255) / span) | 0;
      }
    }
  }

  // Remoção de linhas horizontais e bordas verticais de grade
  const minHorizRun = Math.max(30, Math.round(28 * effectiveScale));
  const minVertRun = Math.max(20, Math.round(14 * effectiveScale));
  const maxLineThickness = Math.max(3, Math.ceil(3 * effectiveScale));
  const tallGridThresh = Math.max(minVertRun * 2, Math.round(h * 0.16));
  const toErase = new Uint8Array(totalPixels);

  const rowHasLongRun = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    const off = y * w;
    for (let x = 0; x < w; x++) {
      if (gray[off + x] < 205) {
        run++;
        if (run >= minHorizRun) {
          rowHasLongRun[y] = 1;
          break;
        }
      } else {
        run = 0;
      }
    }
  }

  let bandStartY = -1;
  for (let y = 0; y <= h; y++) {
    const hasSeg = y < h && rowHasLongRun[y] === 1;
    if (hasSeg && bandStartY === -1) {
      bandStartY = y;
    } else if (!hasSeg && bandStartY !== -1) {
      if (y - bandStartY <= maxLineThickness) {
        for (let ry = bandStartY; ry < y; ry++) {
          let run = 0;
          const off = ry * w;
          for (let x = 0; x <= w; x++) {
            if (x < w && gray[off + x] < 205) {
              run++;
            } else {
              if (run >= minHorizRun) {
                toErase.fill(1, off + x - run, off + x);
              }
              run = 0;
            }
          }
        }
      }
      bandStartY = -1;
    }
  }

  const colMaxRun = new Uint32Array(w);
  for (let x = 0; x < w; x++) {
    let run = 0;
    let best = 0;
    for (let y = 0; y < h; y++) {
      if (gray[y * w + x] < 220) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    colMaxRun[x] = best;
  }

  let bandStartX = -1;
  for (let x = 0; x <= w; x++) {
    const hasSeg = x < w && colMaxRun[x] >= minVertRun;
    if (hasSeg && bandStartX === -1) {
      bandStartX = x;
    } else if (!hasSeg && bandStartX !== -1) {
      let bandMaxRun = 0;
      for (let cx = bandStartX; cx < x; cx++) {
        if (colMaxRun[cx] > bandMaxRun) bandMaxRun = colMaxRun[cx];
      }
      if (x - bandStartX <= maxLineThickness || bandMaxRun >= tallGridThresh) {
        for (let cx = bandStartX; cx < x; cx++) {
          let run = 0;
          for (let y = 0; y <= h; y++) {
            if (y < h && gray[y * w + cx] < 220) {
              run++;
            } else {
              if (run >= minVertRun) {
                for (let k = y - run; k < y; k++) {
                  toErase[k * w + cx] = 1;
                }
              }
              run = 0;
            }
          }
        }
      }
      bandStartX = -1;
    }
  }

  for (let i = 0; i < totalPixels; i++) {
    if (toErase[i]) {
      gray[i] = 255;
    }
  }

  const rowInkCount = new Uint32Array(h);
  const rowMinX = new Int32Array(h).fill(w);
  const rowMaxX = new Int32Array(h).fill(-1);
  let minY = h;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const off = y * w;
    let cnt = 0;
    let rMin = w;
    let rMax = -1;
    for (let x = 0; x < w; x++) {
      if (gray[off + x] < 210) {
        cnt++;
        if (x < rMin) rMin = x;
        if (x > rMax) rMax = x;
      }
    }
    rowInkCount[y] = cnt;
    rowMinX[y] = rMin;
    rowMaxX[y] = rMax;
    if (cnt > 0) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const pad = 8;
  if (maxY >= minY) {
    minY = Math.max(0, minY - pad);
    maxY = Math.min(h - 1, maxY + pad);
  }

  return {
    gray,
    w,
    h,
    effectiveScale,
    rowInkCount,
    rowMinX,
    rowMaxX,
    minY,
    maxY,
    isInvertedRow,
  };
}

function findCleanHorizontalCuts(
  prep: PreparedOcrImage,
  startY: number,
  endY: number,
  desiredStrips: number
): number[] {
  const cuts: number[] = [startY];
  const spanH = endY - startY;
  if (desiredStrips <= 1 || spanH < 240) {
    cuts.push(endY);
    return cuts;
  }

  const searchWindow = Math.min(180, Math.floor(spanH / (desiredStrips * 1.5)));
  for (let s = 1; s < desiredStrips; s++) {
    const targetY = Math.round(startY + (spanH * s) / desiredStrips);
    let bestY = -1;
    for (let d = 0; d < searchWindow; d++) {
      if (targetY + d < endY - 24 && prep.rowInkCount[targetY + d] <= 2) {
        bestY = targetY + d;
        break;
      }
      if (
        targetY - d > cuts[cuts.length - 1] + 24 &&
        prep.rowInkCount[targetY - d] <= 2
      ) {
        bestY = targetY - d;
        break;
      }
    }
    if (bestY !== -1 && bestY > cuts[cuts.length - 1] + 20) {
      cuts.push(bestY);
    }
  }
  cuts.push(endY);
  return cuts;
}

function sliceStripFromGray(
  prep: PreparedOcrImage,
  sy0: number,
  sy1: number,
  cropLeftX = 0
): OcrStrip | null {
  let sx0 = prep.w;
  let sx1 = -1;
  for (let y = sy0; y < sy1; y++) {
    if (prep.rowMaxX[y] >= 0) {
      const rMin = Math.max(cropLeftX, prep.rowMinX[y]);
      if (rMin < sx0) sx0 = rMin;
      if (prep.rowMaxX[y] > sx1) sx1 = prep.rowMaxX[y];
    }
  }
  if (sx1 < sx0) return null;

  const pad = 8;
  sx0 = Math.max(cropLeftX, sx0 - pad);
  sx1 = Math.min(prep.w - 1, sx1 + pad);
  const sw = sx1 - sx0 + 1;
  const sh = sy1 - sy0;
  if (sw <= 0 || sh <= 0) return null;

  const buf = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const srcOff = (sy0 + y) * prep.w + sx0;
    buf.set(prep.gray.subarray(srcOff, srcOff + sw), y * sw);
  }
  return {
    blob: encodeGrayscalePgmBlob(buf, sw, sh),
    xOffset: sx0,
    yOffset: sy0,
  };
}

function hasColumnInkInTail(
  prep: PreparedOcrImage,
  sy0: number,
  sy1: number,
  colX0: number,
  colX1: number
): boolean {
  const xStart = Math.max(0, Math.floor(colX0));
  const xEnd = Math.min(prep.w - 1, Math.ceil(colX1));
  if (xEnd <= xStart) return false;
  let darkPixels = 0;
  for (let y = sy0; y < sy1; y += 2) {
    const off = y * prep.w;
    for (let x = xStart; x <= xEnd; x += 2) {
      if (prep.gray[off + x] < 180) {
        darkPixels++;
        if (darkPixels >= 6) return true;
      }
    }
  }
  return false;
}

function detectTailCropLeftX(
  s0Lines: OcrLine[],
  prep: PreparedOcrImage,
  s0End: number
): number {
  for (const line of s0Lines) {
    const normLine = stripDiacritics(line.text).toLowerCase();
    if (
      !/(?:campo|campa|carmpo|camno|lampa|field|valor|vakor|nalor|talor|vator|valer|value)/.test(
        normLine
      )
    ) {
      continue;
    }

    const words = line.words || [];
    let objWord: OcrWord | null = null;
    for (const wd of words) {
      const clean = stripDiacritics(
        wd.text.replace(/^[,.;:"'!~`|[\](){}<>]+|[,.;:"'!~`|[\](){}<>]+$/g, '')
      ).toLowerCase();
      if (
        /^(?:[o0]b[ij1l]?[e3]t[o0a]|ob[ij]ect|objct|obiete|onieta|obieto|obdjeto|objelo|ojeto)$/.test(
          clean
        )
      ) {
        objWord = wd;
        break;
      }
    }
    if (!objWord) continue;

    // Preserva eventual coluna "Verificação para usuário" à esquerda de Objeto somente se ela tiver dados nas linhas
    let userColStartX = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].x0 >= objWord.x0) break;
      const t = stripDiacritics(words[i].text).toLowerCase();
      if (/^(?:verif|usuario|user)/.test(t)) {
        const nextX0 = i + 1 < words.length ? words[i + 1].x0 : objWord.x0;
        if (nextX0 <= objWord.x0) {
          userColStartX = words[i].x0;
          break;
        }
      }
    }

    if (
      userColStartX >= 0 &&
      hasColumnInkInTail(
        prep,
        s0End,
        prep.maxY + 1,
        Math.max(0, userColStartX - 8),
        objWord.x0 - 12 * prep.effectiveScale
      )
    ) {
      return Math.max(0, Math.floor(userColStartX - 16 * prep.effectiveScale));
    }

    return Math.max(0, Math.floor(objWord.x0 - 20 * prep.effectiveScale));
  }

  return 0;
}

function prepareImageElementToGray(img: HTMLImageElement): PreparedOcrImage {
  const scale = computeTargetOcrScale(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Não foi possível inicializar o contexto gráfico para OCR local.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;
  canvas.width = 0;
  canvas.height = 0;

  return preprocessRgbaToGray(data, w, h, scale);
}

/**
 * Reconstrói linhas visuais diretamente dos TSVs das faixas,
 * reajustando coordenadas X/Y pelo deslocamento da faixa, separando resíduos de borda '|'
 * e agrupando palavras na mesma linha visual.
 */
function parseStripTsvsToLines(
  stripResults: Array<{ xOffset: number; yOffset: number; tsv: string }>
): { lines: OcrLine[]; fullText: string } {
  const words: OcrWord[] = [];

  for (const { xOffset, yOffset, tsv } of stripResults) {
    if (!tsv) continue;
    const rawLines = tsv.split('\n');
    for (let i = 1; i < rawLines.length; i++) {
      const cols = rawLines[i].split('\t');
      if (cols.length < 12 || cols[0] !== '5') continue;

      const text = cols.slice(11).join('\t').trim();
      if (!text) continue;
      if (/^[~|¦`'"\\]+$/.test(text)) continue;

      const x0 = Number(cols[6]) + xOffset;
      const y0 = Number(cols[7]) + yOffset;
      const wd = Number(cols[8]);
      const ht = Number(cols[9]);
      const confidence = Number(cols[10]);

      if (!Number.isFinite(x0) || !Number.isFinite(y0) || wd <= 0 || ht <= 0) continue;

      if (text.includes('|')) {
        const totalLen = Math.max(1, text.length);
        const regex = /[^|]+/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          const part = match[0].trim();
          if (!part || /^[~¦`'"\\]+$/.test(part)) continue;
          const px0 = x0 + (match.index / totalLen) * wd;
          const px1 = x0 + ((match.index + part.length) / totalLen) * wd;
          words.push({
            text: part,
            x0: px0,
            y0,
            x1: Math.max(px0 + 2, px1),
            y1: y0 + ht,
            h: ht,
            confidence: Number.isFinite(confidence) ? confidence : 0,
          });
        }
        continue;
      }

      words.push({
        text,
        x0,
        y0,
        x1: x0 + wd,
        y1: y0 + ht,
        h: ht,
        confidence: Number.isFinite(confidence) ? confidence : 0,
      });
    }
  }

  words.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1) || a.x0 - b.x0);

  const rowGroups: Array<{ midY: number; avgH: number; words: OcrWord[] }> = [];
  for (const wd of words) {
    const mid = (wd.y0 + wd.y1) / 2;
    const last = rowGroups[rowGroups.length - 1];
    if (last && Math.abs(mid - last.midY) <= Math.max(8, last.avgH * 0.55)) {
      const count = last.words.length;
      last.words.push(wd);
      last.midY = (last.midY * count + mid) / (count + 1);
      last.avgH = (last.avgH * count + wd.h) / (count + 1);
    } else {
      rowGroups.push({ midY: mid, avgH: wd.h, words: [wd] });
    }
  }

  const lines: OcrLine[] = rowGroups.map((group) => {
    group.words.sort((a, b) => a.x0 - b.x0);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const wd of group.words) {
      if (wd.x0 < minX) minX = wd.x0;
      if (wd.x1 > maxX) maxX = wd.x1;
      if (wd.y0 < minY) minY = wd.y0;
      if (wd.y1 > maxY) maxY = wd.y1;
    }
    return {
      text: group.words.map((w) => w.text).join(' '),
      x0: minX,
      x1: maxX,
      y0: minY,
      y1: maxY,
      words: group.words,
    };
  });

  return {
    lines,
    fullText: lines.map((l) => l.text).join('\n'),
  };
}

const OCR_OUTPUT_OPTIONS = { text: false, tsv: true, blocks: false };

async function recognizePreparedImage(
  prep: PreparedOcrImage,
  desiredTailStrips: number
): Promise<OcrSU53Extraction> {
  if (prep.maxY < prep.minY) {
    const fallbackStrip: OcrStrip = {
      blob: encodeGrayscalePgmBlob(prep.gray, prep.w, prep.h),
      xOffset: 0,
      yOffset: 0,
    };
    const worker = schedulerReady ? null : await getPrimaryWorker();
    const res = worker
      ? await worker.recognize(fallbackStrip.blob, {}, OCR_OUTPUT_OPTIONS)
      : await (await getOcrScheduler()).addJob('recognize', fallbackStrip.blob, {}, OCR_OUTPUT_OPTIONS);
    const { lines, fullText } = parseStripTsvsToLines([
      { xOffset: 0, yOffset: 0, tsv: res.data.tsv || '' },
    ]);
    return parseSu53Lines(lines, fullText);
  }

  const cropH = prep.maxY - prep.minY + 1;

  // Para capturas curtas (ex.: 2-5 linhas), executa 1-2 faixas diretas sem sobrecarga de 2 estágios
  if (cropH < 660 || desiredTailStrips <= 1) {
    const stripCount = cropH >= 480 ? Math.min(2, Math.max(1, desiredTailStrips)) : 1;
    const cuts = findCleanHorizontalCuts(prep, prep.minY, prep.maxY + 1, stripCount);
    const strips: OcrStrip[] = [];
    for (let s = 0; s < cuts.length - 1; s++) {
      const st = sliceStripFromGray(prep, cuts[s], cuts[s + 1], 0);
      if (st) strips.push(st);
    }
    if (strips.length === 0) {
      strips.push({
        blob: encodeGrayscalePgmBlob(prep.gray, prep.w, prep.h),
        xOffset: 0,
        yOffset: 0,
      });
    }

    if (strips.length === 1 && !schedulerReady) {
      const worker = await getPrimaryWorker();
      void getOcrScheduler().catch(() => {});
      const res = await worker.recognize(strips[0].blob, {}, OCR_OUTPUT_OPTIONS);
      const { lines, fullText } = parseStripTsvsToLines([
        { xOffset: strips[0].xOffset, yOffset: strips[0].yOffset, tsv: res.data.tsv || '' },
      ]);
      return parseSu53Lines(lines, fullText);
    }

    const scheduler = await getOcrScheduler();
    const results = await Promise.all(
      strips.map((st) => scheduler.addJob('recognize', st.blob, {}, OCR_OUTPUT_OPTIONS))
    );
    const { lines, fullText } = parseStripTsvsToLines(
      results.map((res, idx) => ({
        xOffset: strips[idx].xOffset,
        yOffset: strips[idx].yOffset,
        tsv: res.data.tsv || '',
      }))
    );
    return parseSu53Lines(lines, fullText);
  }

  // Estágio 1: Faixa superior (cabeçalho do usuário + título da tabela ALV) em largura total
  let targetS0End =
    prep.minY + Math.min(Math.round(cropH * 0.46), Math.round(350 * prep.effectiveScale));

  // Se houver uma faixa de cabeçalho colorida invertida (ex.: cabeçalho azul ALV #6780B8), encerra Faixa 0 na folga logo após ela
  let snappedToHeaderBand = false;
  const bandSearchMinY = prep.minY + Math.round(cropH * 0.14);
  for (let y = targetS0End - 20; y >= bandSearchMinY; y--) {
    if (prep.isInvertedRow[y] === 1) {
      targetS0End = Math.min(targetS0End, y + Math.round(4 * prep.effectiveScale));
      snappedToHeaderBand = true;
      break;
    }
  }

  let s0End = Math.min(prep.maxY - 60, targetS0End);
  const searchWin = snappedToHeaderBand
    ? Math.max(12, Math.round(14 * prep.effectiveScale))
    : Math.min(120, Math.floor(cropH * 0.12));
  for (let d = 0; d <= searchWin; d++) {
    if (targetS0End + d < prep.maxY - 60 && prep.rowInkCount[targetS0End + d] <= 2) {
      s0End = targetS0End + d;
      break;
    }
    if (!snappedToHeaderBand && targetS0End - d > prep.minY + 180 && prep.rowInkCount[targetS0End - d] <= 2) {
      s0End = targetS0End - d;
      break;
    }
  }

  const s0Strip =
    sliceStripFromGray(prep, prep.minY, s0End, 0) ?? {
      blob: encodeGrayscalePgmBlob(prep.gray, prep.w, prep.h),
      xOffset: 0,
      yOffset: 0,
    };

  let s0Tsv = '';
  if (!schedulerReady) {
    // Executa Faixa 0 imediatamente no worker primário enquanto o restante do pool aquece em paralelo
    const schedulerWarmup = getOcrScheduler().catch(() => null);
    const primary = await getPrimaryWorker();
    const s0Res = await primary.recognize(s0Strip.blob, {}, OCR_OUTPUT_OPTIONS);
    s0Tsv = s0Res.data.tsv || '';
    await schedulerWarmup;
  } else {
    const scheduler = await getOcrScheduler();
    const s0Res = await scheduler.addJob('recognize', s0Strip.blob, {}, OCR_OUTPUT_OPTIONS);
    s0Tsv = s0Res.data.tsv || '';
  }

  const s0Parsed = parseStripTsvsToLines([
    { xOffset: s0Strip.xOffset, yOffset: s0Strip.yOffset, tsv: s0Tsv },
  ]);

  // Estágio 2: Recorta colunas redundantes à esquerda da coluna "Objeto" nas faixas seguintes
  const tailCropLeftX = detectTailCropLeftX(s0Parsed.lines, prep, s0End);
  const tailCuts = findCleanHorizontalCuts(prep, s0End, prep.maxY + 1, desiredTailStrips);
  const tailStrips: OcrStrip[] = [];
  for (let s = 0; s < tailCuts.length - 1; s++) {
    const st = sliceStripFromGray(prep, tailCuts[s], tailCuts[s + 1], tailCropLeftX);
    if (st) tailStrips.push(st);
  }

  if (tailStrips.length === 0) {
    return parseSu53Lines(s0Parsed.lines, s0Parsed.fullText);
  }

  const scheduler = await getOcrScheduler();
  const tailResults = await Promise.all(
    tailStrips.map((st) => scheduler.addJob('recognize', st.blob, {}, OCR_OUTPUT_OPTIONS))
  );

  const { lines, fullText } = parseStripTsvsToLines([
    { xOffset: s0Strip.xOffset, yOffset: s0Strip.yOffset, tsv: s0Tsv },
    ...tailResults.map((res, idx) => ({
      xOffset: tailStrips[idx].xOffset,
      yOffset: tailStrips[idx].yOffset,
      tsv: res.data.tsv || '',
    })),
  ]);

  return parseSu53Lines(lines, fullText);
}

async function prepareImageFileGray(imageFile: LoadedFile): Promise<PreparedOcrImage> {
  const src =
    imageFile.previewUrl ||
    (imageFile.base64
      ? `data:${imageFile.mimeType || 'image/png'};base64,${imageFile.base64}`
      : '');

  if (!src) {
    throw new Error(`A imagem "${imageFile.name}" não possui conteúdo legível.`);
  }

  const img = await loadImageElement(src);
  return prepareImageElementToGray(img);
}

/**
 * Executa OCR direto sobre um frame RGBA já extraído/renderizado (ex.: página de PDF),
 * evitando compressão PNG, decodificação de imagem e re-escalonamento duplicado.
 */
export async function extractSU53FromRgbaFrame(
  frame: OcrRgbaFrame
): Promise<OcrSU53Extraction> {
  const poolSize = getOcrPoolSize();
  const desiredTailStrips =
    frame.height >= 1600
      ? Math.min(5, Math.max(poolSize, Math.ceil(frame.height / 450)))
      : poolSize;

  const prep = preprocessRgbaToGray(
    frame.data,
    frame.width,
    frame.height,
    frame.sourceScale ?? 1.5
  );

  return recognizePreparedImage(prep, desiredTailStrips);
}

export async function extractSU53DataFromImages(
  imageFiles: LoadedFile[]
): Promise<OcrSU53Extraction[]> {
  if (imageFiles.length === 0) return [];

  const poolSize = getOcrPoolSize();
  const tailStripsPerImage =
    imageFiles.length === 1
      ? poolSize
      : Math.max(2, Math.ceil(poolSize / imageFiles.length));

  const warmupPromise = schedulerReady ? null : getPrimaryWorker().catch(() => null);
  const preparedImages = await Promise.all(
    imageFiles.map((file) => prepareImageFileGray(file))
  );
  if (warmupPromise) await warmupPromise;

  return Promise.all(
    preparedImages.map((prep) => recognizePreparedImage(prep, tailStripsPerImage))
  );
}
