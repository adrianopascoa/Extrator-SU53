import { createScheduler, createWorker, OEM, type Scheduler, type Worker } from 'tesseract.js';
import { LoadedFile } from '../types/su53';

export interface OcrExtractedEntry {
  objectName: string;
  fields: Array<{
    fieldName: string;
    values: string[];
  }>;
}

export interface OcrSU53Extraction {
  user?: string;
  system?: string;
  client?: string;
  rowCount: number;
  entries: OcrExtractedEntry[];
}

export interface OcrWord {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  h: number;
  confidence: number;
}

export interface OcrLine {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  words: OcrWord[];
}

interface HeaderColumn {
  kind: 'object' | 'field' | 'value';
  pairIndex: number;
  x0: number;
  x1: number;
}

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
      if (!secondaryWorkerPromise) {
        secondaryWorkerPromise = spawnConfiguredWorker().catch((err) => {
          secondaryWorkerPromise = null;
          throw err;
        });
      }
      const [w1, w2] = await Promise.all([getPrimaryWorker(), secondaryWorkerPromise]);
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

export const INVALID_USER_TOKENS = new Set([
  'SISTEMA',
  'SYSTEM',
  'MANDANTE',
  'CLIENT',
  'DATA',
  'DATE',
  'HORA',
  'TIME',
  'OBJETO',
  'OBJECT',
  'OBJETOS',
  'CAMPO',
  'FIELD',
  'VALOR',
  'VALUE',
  'VERIFICACAO',
  'VERIFICACOES',
  'VERIFICAÇÕES',
  'FALHADA',
  'FALHADAS',
  'FALHOU',
  'FAILED',
  'CHECK',
  'CHECKS',
  'DESDE',
  'SINCE',
  'INSTANCIA',
  'INSTANCE',
  'PARAM',
  'BUFFER',
  'RESULTADO',
  'RESULT',
  'DADOS',
  'AUTORIZACAO',
  'AUTORIZAÇÃO',
  'AUTORIZ',
  'AUTHORIZATION',
  'AUTHORIZATIONS',
  'EXIBIR',
  'EXIBICAO',
  'EXIBIÇÃO',
  'DISPLAY',
  'ULTIMA',
  'ÚLTIMA',
  'LAST',
  'ATUAL',
  'CURRENT',
  'NOME',
  'NAME',
  'USER',
  'USUARIO',
  'USUÁRIO',
  'BNAME',
  'SYSID',
  'MANDT',
  'SAP',
  'SU53',
  'LOG',
  'DE',
  'DO',
  'DA',
  'DOS',
  'DAS',
  'EM',
  'NO',
  'NA',
  'NOS',
  'NAS',
  'AO',
  'AOS',
  'PARA',
  'POR',
  'PELO',
  'PELA',
  'COM',
  'SEM',
  'NAO',
  'NÃO',
  'QUE',
  'FOR',
  'OF',
  'TO',
  'IN',
  'ON',
  'AT',
  'BY',
  'WITH',
  'FROM',
  'AND',
  'OR',
  'THE',
]);

function sanitizeUserCandidate(raw: string): string | undefined {
  const cleaned = raw.replace(/^[:\-.\s()]+|[:\-.\s(),;]+$/g, '').trim().toUpperCase();
  if (cleaned.length < 2 || cleaned.length > 20) return undefined;
  if (/^\d+$/.test(cleaned)) return undefined;
  if (INVALID_USER_TOKENS.has(cleaned)) return undefined;
  return cleaned;
}

export function extractUserCandidateFromText(text: string): string | undefined {
  if (!text) return undefined;

  const titlePatterns = [
    /(?:Exibir|Exibi[çc][aã]o(?:\s+de)?)\s+dados\s+(?:de\s+)?autoriza[çc][aã]o\s+(?:de|do|p\/?\s*|para(?:\s+o)?)\s+usu[áaàâäeé]r(?:i[o0]|\.)?\s*[:\-]?\s*([A-Z0-9_\-\.]{2,20})/gi,
    /Display\s+Authorization\s+Data\s+for\s+User\s*[:\-]?\s*([A-Z0-9_\-\.]{2,20})/gi,
    /(?:verif\.?\s*autoriz\.?\s*falhada|Failed\s+Authorization\s+Check)\s*\(?\s*(?:usu[áaàâäeé]r(?:i[o0]|\.)?|User)\s*[:\-]?\s*([A-Z0-9_\-\.]{2,20})/gi,
  ];

  for (const regex of titlePatterns) {
    for (const match of text.matchAll(regex)) {
      if (match[1]) {
        const valid = sanitizeUserCandidate(match[1]);
        if (valid) return valid;
      }
    }
  }

  const labelRegex =
    /(?:Nome\s+(?:do\s+)?usu[áaàâäeé]r(?:i[o0]|\.)?|Usu[áaàâäeé]r(?:i[o0]|\.)|User(?:\s*(?:Name|ID))?|BNAME)\s*[:=\-]?\s*([A-Z0-9_\-\.]{2,20})/gi;

  for (const match of text.matchAll(labelRegex)) {
    if (match[1]) {
      const valid = sanitizeUserCandidate(match[1]);
      if (valid) return valid;
    }
  }

  return undefined;
}

function extractMetadataFromLines(lines: OcrLine[], fullText: string): {
  user?: string;
  system?: string;
  client?: string;
} {
  let user: string | undefined = extractUserCandidateFromText(fullText);
  let system: string | undefined;
  let client: string | undefined;

  for (const line of lines) {
    const text = line.text;

    if (!user) {
      user = extractUserCandidateFromText(text);
    }

    if (!system) {
      const sysMatch = text.match(/(?:Sistema|System|SYSID)\s*[:\-]?\s*([A-Z0-9]{3})\b/i);
      if (sysMatch?.[1]) {
        system = sysMatch[1].trim().toUpperCase();
      }
    }

    if (!client) {
      const cliMatch = text.match(/(?:Mandante|Client|MANDT)\s*[:\-]?\s*(\d{3})\b/i);
      if (cliMatch?.[1]) {
        client = cliMatch[1].trim();
      }
    }

    if (!system) {
      const instMatch = text.match(/[a-z0-9\-]+_([A-Z0-9]{3})_\d{2}\b/i);
      if (instMatch?.[1]) {
        system = instMatch[1].trim().toUpperCase();
      }
    }
  }

  return { user, system, client };
}

function parseHeaderColumns(headerLine: OcrLine): HeaderColumn[] {
  const words = headerLine.words;
  const objIdx = words.findIndex((w) => /^(objeto|object|objct)$/i.test(w.text));
  if (objIdx === -1) return [];

  const columns: HeaderColumn[] = [
    {
      kind: 'object',
      pairIndex: 0,
      x0: words[objIdx].x0,
      x1: words[objIdx].x1,
    },
  ];

  let nextPairIdx = 1;
  let lastFieldPairIdx = 0;

  for (let i = objIdx + 1; i < words.length; i++) {
    const raw = words[i].text.trim();
    const lower = raw.toLowerCase();

    const isFieldWord = /^(campo|field|fieldname|camno)(\d+[a-z]?)?$/i.test(lower);
    const isValueWord = /^(valor|value|val\.?|vator|vaor)(\d+[a-z]?)?$/i.test(lower);

    if (isFieldWord) {
      const startX0 = words[i].x0;
      let x1 = words[i].x1;
      let pairNum = nextPairIdx;

      const embeddedNum = lower.match(/(\d+)/);
      if (embeddedNum) {
        pairNum = parseInt(embeddedNum[1], 10);
      } else if (i + 1 < words.length && /^(\d{1,2}|[5s])$/i.test(words[i + 1].text)) {
        const parsedNext = words[i + 1].text.replace(/s/i, '5');
        pairNum = parseInt(parsedNext, 10) || nextPairIdx;
        x1 = words[i + 1].x1;
        i++;
      }

      lastFieldPairIdx = pairNum;
      nextPairIdx = Math.max(nextPairIdx + 1, pairNum + 1);
      columns.push({ kind: 'field', pairIndex: pairNum, x0: startX0, x1 });
      continue;
    }

    if (isValueWord) {
      const startX0 = words[i].x0;
      let x1 = words[i].x1;
      let pairNum = lastFieldPairIdx || nextPairIdx;

      const embeddedNum = lower.match(/(\d+)/);
      if (embeddedNum) {
        pairNum = parseInt(embeddedNum[1], 10);
      } else if (i + 1 < words.length && /^(\d{1,2}|[5s])$/i.test(words[i + 1].text)) {
        const parsedNext = words[i + 1].text.replace(/s/i, '5');
        pairNum = parseInt(parsedNext, 10) || pairNum;
        x1 = words[i + 1].x1;
        i++;
      }

      columns.push({ kind: 'value', pairIndex: pairNum, x0: startX0, x1 });
    }
  }

  return columns.sort((a, b) => a.x0 - b.x0);
}

function parseAlvTableRows(
  lines: OcrLine[],
  headerLineIdx: number,
  columns: HeaderColumn[]
): { entries: OcrExtractedEntry[]; rowCount: number } {
  const entries: OcrExtractedEntry[] = [];
  let rowCount = 0;

  const colBounds = columns.map((col, idx) => {
    const prevCol = idx > 0 ? columns[idx - 1] : null;
    const nextCol = idx + 1 < columns.length ? columns[idx + 1] : null;
    const startX = prevCol
      ? col.x0 - Math.min(20, Math.max(8, (col.x0 - prevCol.x1) * 0.45))
      : col.x0 - 20;
    const endX = nextCol
      ? nextCol.x0 - Math.min(20, Math.max(8, (nextCol.x0 - col.x1) * 0.45))
      : Number.MAX_SAFE_INTEGER;
    return { col, startX, endX };
  });

  const headerBottom = lines[headerLineIdx].y1;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.y0 < headerBottom - 4) continue;

    const colTokens = new Map<number, string[]>();
    for (const wd of line.words) {
      if (wd.x0 < colBounds[0].startX) continue;

      let matchedIdx = colBounds.findIndex((b) => wd.x0 >= b.startX && wd.x0 < b.endX);
      if (matchedIdx === -1) {
        for (let c = colBounds.length - 1; c >= 0; c--) {
          if (wd.x0 >= colBounds[c].startX) {
            matchedIdx = c;
            break;
          }
        }
      }

      if (matchedIdx !== -1) {
        const col = colBounds[matchedIdx].col;
        const nextBound = matchedIdx + 1 < colBounds.length ? colBounds[matchedIdx + 1] : null;

        if (
          col.kind === 'field' &&
          nextBound?.col.kind === 'value' &&
          wd.x1 > nextBound.startX - 4
        ) {
          const splitMatch = wd.text.match(/^([A-Z0-9_\/]{2,20}?)\.{2,}(.+)$/i);
          if (splitMatch) {
            const fieldArr = colTokens.get(matchedIdx) ?? [];
            fieldArr.push(splitMatch[1]);
            colTokens.set(matchedIdx, fieldArr);

            const valArr = colTokens.get(matchedIdx + 1) ?? [];
            valArr.push(splitMatch[2]);
            colTokens.set(matchedIdx + 1, valArr);
            continue;
          }
        }

        const arr = colTokens.get(matchedIdx) ?? [];
        arr.push(wd.text);
        colTokens.set(matchedIdx, arr);
      }
    }

    const rawObj = (colTokens.get(0) ?? []).join('').trim().toUpperCase();
    if (!rawObj || !/^[A-Z0-9_\/]{2,30}$/.test(rawObj)) continue;
    if (/^(OBJETO|OBJECT|TOTAL|SOMA)$/.test(rawObj)) continue;

    const fieldsList: Array<{ fieldName: string; values: string[] }> = [];

    for (let c = 1; c < colBounds.length; c++) {
      const current = colBounds[c].col;
      if (current.kind !== 'field') continue;

      let fieldName = (colTokens.get(c) ?? []).join('').trim().toUpperCase();
      if (!fieldName) continue;

      let valueText = '';
      if (c + 1 < colBounds.length && colBounds[c + 1].col.kind === 'value') {
        valueText = (colTokens.get(c + 1) ?? []).join(' ').trim();
      }

      const mergedMatch = fieldName.match(/^([A-Z0-9_\/]{2,20}?)\.{2,}(.+)$/);
      if (mergedMatch) {
        fieldName = mergedMatch[1];
        if (!valueText) valueText = mergedMatch[2].trim();
      }

      fieldName = fieldName.replace(/\.+$/, '').trim();
      if (!fieldName || !/^[A-Z0-9_\/]{2,30}$/.test(fieldName)) continue;

      fieldsList.push({
        fieldName,
        values: valueText ? [valueText] : [],
      });
    }

    if (fieldsList.length > 0) {
      entries.push({ objectName: rawObj, fields: fieldsList });
      rowCount++;
    }
  }

  return { entries, rowCount };
}

function parseTreeFallback(lines: OcrLine[]): { entries: OcrExtractedEntry[]; rowCount: number } {
  const entries: OcrExtractedEntry[] = [];
  let currentEntry: OcrExtractedEntry | null = null;
  let rowCount = 0;

  for (const line of lines) {
    const text = line.text.trim();

    const objLineMatch = text.match(
      /(?:Objeto(?:\s+de\s+autoriza[çc][aã]o)?|Authorization\s+Object|Object)\s*[:\-]?\s*([A-Z][A-Z0-9_\/]{2,29})\b/i
    );
    if (objLineMatch?.[1]) {
      const objName = objLineMatch[1].trim().toUpperCase();
      currentEntry = { objectName: objName, fields: [] };
      entries.push(currentEntry);
      rowCount++;
      continue;
    }

    if (currentEntry) {
      const kvMatch = text.match(
        /^(?:Campo|Field)?\s*([A-Z][A-Z0-9_\/]{1,19})\s*(?:=|:|\s)\s*(.+)$/i
      );
      if (kvMatch?.[1] && kvMatch?.[2]) {
        const fName = kvMatch[1].trim().toUpperCase();
        const fVal = kvMatch[2].trim();
        if (!INVALID_USER_TOKENS.has(fName) && fVal) {
          currentEntry.fields.push({ fieldName: fName, values: [fVal] });
        }
      }
    }
  }

  return { entries, rowCount };
}

export function parseSu53Lines(lines: OcrLine[], fullText: string): OcrSU53Extraction {
  const meta = extractMetadataFromLines(lines, fullText);

  let bestHeaderIdx = -1;
  let bestColumns: HeaderColumn[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].text.toLowerCase();
    if (
      /\b(objeto|object|objct)\b/.test(lineLower) &&
      /\b(campo|field|valor|value)\b/.test(lineLower)
    ) {
      const cols = parseHeaderColumns(lines[i]);
      if (cols.length > bestColumns.length) {
        bestHeaderIdx = i;
        bestColumns = cols;
      }
    }
  }

  let parsed =
    bestHeaderIdx !== -1 && bestColumns.length >= 2
      ? parseAlvTableRows(lines, bestHeaderIdx, bestColumns)
      : { entries: [], rowCount: 0 };

  if (parsed.entries.length === 0) {
    parsed = parseTreeFallback(lines);
  }

  return {
    user: meta.user,
    system: meta.system,
    client: meta.client,
    rowCount: parsed.rowCount,
    entries: parsed.entries,
  };
}

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
