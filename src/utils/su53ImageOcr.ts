import { createScheduler, createWorker, OEM, type Scheduler, type Worker } from 'tesseract.js';
import { LoadedFile } from '../types/su53';
import {
  OcrLine,
  OcrSU53Extraction,
  OcrWord,
  parseSu53Lines,
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
} from './su53TextEngine';

function getLocalOriginPrefix(): string {
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
}

let primaryWorkerPromise: Promise<Worker> | null = null;
let secondaryWorkerPromise: Promise<Worker> | null = null;
let schedulerPromise: Promise<Scheduler> | null = null;

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
    }
  );
  await worker.setParameters({
    user_defined_dpi: '300',
    preserve_interword_spaces: '1',
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

function getBatchScheduler(): Promise<Scheduler> {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const scheduler = createScheduler();
      // Aguarda o worker primário baixar/gravar o eng.traineddata.gz no cache local antes de criar o segundo worker
      const w1 = await getPrimaryWorker();
      if (!secondaryWorkerPromise) {
        secondaryWorkerPromise = spawnConfiguredWorker().catch((err) => {
          secondaryWorkerPromise = null;
          throw err;
        });
      }
      const w2 = await secondaryWorkerPromise;
      scheduler.addWorker(w1);
      scheduler.addWorker(w2);
      return scheduler;
    })().catch((err) => {
      schedulerPromise = null;
      throw err;
    });
  }
  return schedulerPromise;
}

/**
 * Pré-aquece o motor OCR local em segundo plano assim que uma imagem entra na fila,
 * eliminando o tempo de inicialização quando o usuário clicar em Executar.
 */
export function warmUpOcrWorker(): void {
  void getPrimaryWorker().catch(() => {
    // Falhas transitórias serão tratadas no momento da extração
  });
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
 * Pré-processamento rápido de capturas SAP GUI:
 * - Escala adaptativa (2x para prints padrão, reduzida proporcionalmente em telas 4K/Retina)
 * - Detecção automática de tema escuro SAP
 * - Contraste alto preservando anti-aliasing das fontes pequenas
 * - Remoção de linhas horizontais/verticais de grade
 * - Auto-recorte das margens vazias antes do envio ao OCR
 */
function preprocessImageToPgmBlob(img: HTMLImageElement): Blob {
  const maxPixels = 6_000_000;
  const maxDimW = 3600;
  const maxDimH = 2400;

  let scale = img.width > 2400 ? 1.5 : 2;
  if (img.width * scale > maxDimW) scale = maxDimW / img.width;
  if (img.height * scale > maxDimH) scale = Math.min(scale, maxDimH / img.height);
  if (img.width * img.height * scale * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (img.width * img.height));
  }
  scale = Math.max(1, scale);

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
  const totalPixels = w * h;
  const gray = new Uint8Array(totalPixels);

  // Detecta tema escuro pela mediana amostrada
  const sampleStep = Math.max(1, Math.floor(totalPixels / 4000));
  const samples: number[] = [];
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const lum = (77 * data[idx] + 150 * data[idx + 1] + 29 * data[idx + 2]) >> 8;
    gray[i] = lum;
    if (i % sampleStep === 0) samples.push(lum);
  }
  samples.sort((a, b) => a - b);
  const medianLum = samples[samples.length >> 1] ?? 200;
  const isDarkTheme = medianLum < 110;

  // Contraste linear rápido
  for (let i = 0; i < totalPixels; i++) {
    const v = isDarkTheme ? 255 - gray[i] : gray[i];
    if (v >= 175) {
      gray[i] = 255;
    } else if (v <= 45) {
      gray[i] = 0;
    } else {
      gray[i] = (((v - 45) * 255) / 130) | 0;
    }
  }

  // Remoção de bordas de grade horizontais e verticais
  const minHorizRun = Math.max(30, Math.round(28 * scale));
  const minVertRun = Math.max(20, Math.round(14 * scale));
  const toErase = new Uint8Array(totalPixels);

  for (let y = 0; y < h; y++) {
    let run = 0;
    const rowOffset = y * w;
    for (let x = 0; x <= w; x++) {
      if (x < w && gray[rowOffset + x] < 215) {
        run++;
      } else {
        if (run >= minHorizRun) {
          for (let k = x - run; k < x; k++) toErase[rowOffset + k] = 1;
        }
        run = 0;
      }
    }
  }

  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && gray[y * w + x] < 215) {
        run++;
      } else {
        if (run >= minVertRun) {
          for (let k = y - run; k < y; k++) toErase[k * w + x] = 1;
        }
        run = 0;
      }
    }
  }

  // Aplica remoção das linhas e calcula bounding box útil para auto-recorte
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const idx = rowOffset + x;
      if (toErase[idx]) {
        gray[idx] = 255;
      } else if (gray[idx] < 230) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    return encodeGrayscalePgmBlob(gray, w, h);
  }

  const pad = 12;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  if (cropW >= w - 16 && cropH >= h - 16) {
    return encodeGrayscalePgmBlob(gray, w, h);
  }

  const cropped = new Uint8Array(cropW * cropH);
  for (let y = 0; y < cropH; y++) {
    const srcStart = (minY + y) * w + minX;
    cropped.set(gray.subarray(srcStart, srcStart + cropW), y * cropW);
  }

  return encodeGrayscalePgmBlob(cropped, cropW, cropH);
}

/**
 * Reconstrói linhas visuais diretamente do TSV plano do Tesseract,
 * agrupando palavras pela faixa vertical (Y) para unir colunas de blocos distintos.
 */
function parseTsvToLines(tsv: string): { lines: OcrLine[]; fullText: string } {
  const rawLines = tsv.split('\n');
  const words: OcrWord[] = [];

  for (let i = 1; i < rawLines.length; i++) {
    const cols = rawLines[i].split('\t');
    if (cols.length < 12 || cols[0] !== '5') continue;

    const text = cols.slice(11).join('\t').trim();
    if (!text) continue;
    // Descarta artefatos puros de borda/pontuação com baixa confiança
    if (/^[~|¦`'"\\]+$/.test(text)) continue;

    const x0 = Number(cols[6]);
    const y0 = Number(cols[7]);
    const wd = Number(cols[8]);
    const ht = Number(cols[9]);
    const confidence = Number(cols[10]);

    if (!Number.isFinite(x0) || !Number.isFinite(y0) || wd <= 0 || ht <= 0) continue;

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

// Helpers de parsing movidos para ./su53TextEngine para otimização de bundle

function parseSu53Tsv(tsv: string): OcrSU53Extraction {
  const { lines, fullText } = parseTsvToLines(tsv);
  return parseSu53Lines(lines, fullText);
}

async function prepareImageBlob(imageFile: LoadedFile): Promise<Blob> {
  const src =
    imageFile.previewUrl ||
    (imageFile.base64
      ? `data:${imageFile.mimeType || 'image/png'};base64,${imageFile.base64}`
      : '');

  if (!src) {
    throw new Error(`A imagem "${imageFile.name}" não possui conteúdo legível.`);
  }

  const img = await loadImageElement(src);
  return preprocessImageToPgmBlob(img);
}

export async function extractSU53DataFromImages(
  imageFiles: LoadedFile[]
): Promise<OcrSU53Extraction[]> {
  if (imageFiles.length === 0) return [];

  const ocrOutputOptions = { text: false, tsv: true, blocks: false };

  if (imageFiles.length === 1) {
    if (schedulerPromise) {
      const [blob, scheduler] = await Promise.all([
        prepareImageBlob(imageFiles[0]),
        getBatchScheduler(),
      ]);
      const res = await scheduler.addJob('recognize', blob, {}, ocrOutputOptions);
      return [parseSu53Tsv(res.data.tsv || '')];
    }

    const [blob, worker] = await Promise.all([
      prepareImageBlob(imageFiles[0]),
      getPrimaryWorker(),
    ]);
    const res = await worker.recognize(blob, {}, ocrOutputOptions);
    return [parseSu53Tsv(res.data.tsv || '')];
  }

  const [blobs, scheduler] = await Promise.all([
    Promise.all(imageFiles.map((file) => prepareImageBlob(file))),
    getBatchScheduler(),
  ]);

  const results = await Promise.all(
    blobs.map((blob) => scheduler.addJob('recognize', blob, {}, ocrOutputOptions))
  );

  return results.map((res) => parseSu53Tsv(res.data.tsv || ''));
}
