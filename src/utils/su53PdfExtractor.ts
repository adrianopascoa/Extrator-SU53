import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { LoadedFile } from '../types/su53';
import {
  extractSU53DataFromImages,
  OcrLine,
  OcrSU53Extraction,
  OcrWord,
  parseSu53Lines,
} from './su53ImageOcr';

let workerConfigured = false;

function ensurePdfWorkerConfigured(): void {
  if (workerConfigured) return;
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${origin}/pdfjs/pdf.worker.min.mjs`;
  workerConfigured = true;
}

function isTextItem(item: unknown): item is TextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    'transform' in item
  );
}

/**
 * Converte TextItems da página PDF em linhas geométricas compatíveis com o parser ALV/Tree.
 * Divide itens com múltiplas palavras em OcrWords proporcionais para preservar colunas X.
 */
function buildLinesFromPdfTextItems(
  items: Array<TextItem | { type: string }>,
  pageHeight: number
): { lines: OcrLine[]; fullText: string } {
  const words: OcrWord[] = [];

  for (const item of items) {
    if (!isTextItem(item)) continue;
    const rawStr = item.str;
    if (!rawStr || !rawStr.trim()) continue;

    const tx = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
    const xStart = Number(tx[4]) || 0;
    const yBaseline = Number(tx[5]) || 0;
    const fontHeight = Math.max(8, Math.abs(Number(item.height)) || Math.abs(Number(tx[3])) || 10);
    const totalWidth = Math.max(4, Number(item.width) || rawStr.length * (fontHeight * 0.52));

    // Coordenadas top-down consistentes com TSV de imagem
    const yTop = Math.max(0, pageHeight - yBaseline - fontHeight);
    const yBottom = yTop + fontHeight;

    const totalLen = Math.max(1, rawStr.length);
    const tokenRegex = /\S+/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(rawStr)) !== null) {
      const token = match[0];
      const charIdx = match.index;
      const wx0 = xStart + (charIdx / totalLen) * totalWidth;
      const wx1 = xStart + ((charIdx + token.length) / totalLen) * totalWidth;
      words.push({
        text: token,
        x0: wx0,
        x1: Math.max(wx0 + 2, wx1),
        y0: yTop,
        y1: yBottom,
        h: fontHeight,
        confidence: 100,
      });
    }
  }

  if (words.length === 0) {
    return { lines: [], fullText: '' };
  }

  words.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1) || a.x0 - b.x0);

  const rowGroups: Array<{ midY: number; avgH: number; words: OcrWord[] }> = [];
  for (const wd of words) {
    const mid = (wd.y0 + wd.y1) / 2;
    const last = rowGroups[rowGroups.length - 1];
    if (last && Math.abs(mid - last.midY) <= Math.max(4, last.avgH * 0.55)) {
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

export async function extractSU53DataFromPdfs(
  pdfFiles: LoadedFile[]
): Promise<OcrSU53Extraction[]> {
  if (pdfFiles.length === 0) return [];
  ensurePdfWorkerConfigured();

  const extractions: OcrSU53Extraction[] = [];
  const pagesNeedingOcr: Array<{
    file: LoadedFile;
    fallbackUser?: string;
    fallbackSystem?: string;
    fallbackClient?: string;
  }> = [];

  for (const pdfFile of pdfFiles) {
    if (!pdfFile.pdfData) {
      throw new Error(`O arquivo PDF "${pdfFile.name}" não possui conteúdo legível.`);
    }

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfFile.pdfData.slice(0)),
      useWorkerFetch: false,
      maxImageSize: 24_000_000,
      disableFontFace: true,
    });

    const pdf = await loadingTask.promise;
    const MAX_PDF_PAGES = 50;
    let lastDocUser: string | undefined;
    let lastDocSystem: string | undefined;
    let lastDocClient: string | undefined;

    try {
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new Error(
          `O arquivo PDF "${pdfFile.name}" possui ${pdf.numPages} páginas e excede o limite de ${MAX_PDF_PAGES} páginas para processamento local.`
        );
      }
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();

        const { lines, fullText } = buildLinesFromPdfTextItems(
          textContent.items,
          baseViewport.height
        );

        const textParsed = parseSu53Lines(lines, fullText);
        if (textParsed.user) lastDocUser = textParsed.user;
        if (textParsed.system) lastDocSystem = textParsed.system;
        if (textParsed.client) lastDocClient = textParsed.client;

        if (textParsed.entries.length > 0) {
          extractions.push({
            user: textParsed.user ?? lastDocUser,
            system: textParsed.system ?? lastDocSystem,
            client: textParsed.client ?? lastDocClient,
            rowCount: textParsed.rowCount,
            entries: textParsed.entries,
          });
          page.cleanup();
          continue;
        }

        // Página com imagem/print embutido (sem camada de texto tabular suficiente): renderiza e envia ao OCR local
        const scale = Math.min(2.5, Math.max(1.8, 1800 / Math.max(1, baseViewport.width)));
        const renderViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(renderViewport.width));
        canvas.height = Math.max(1, Math.round(renderViewport.height));

        await page.render({
          canvas,
          viewport: renderViewport,
        }).promise;

        const dataUrl = canvas.toDataURL('image/png');
        pagesNeedingOcr.push({
          file: {
            id: `${pdfFile.id}-p${pageNum}`,
            name: `${pdfFile.name} (pág. ${pageNum})`,
            size: dataUrl.length,
            kind: 'image',
            mimeType: 'image/png',
            previewUrl: dataUrl,
          },
          fallbackUser: textParsed.user ?? lastDocUser,
          fallbackSystem: textParsed.system ?? lastDocSystem,
          fallbackClient: textParsed.client ?? lastDocClient,
        });

        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }
  }

  if (pagesNeedingOcr.length > 0) {
    const ocrResults = await extractSU53DataFromImages(
      pagesNeedingOcr.map((p) => p.file)
    );
    ocrResults.forEach((res, idx) => {
      const fallback = pagesNeedingOcr[idx];
      extractions.push({
        user: res.user ?? fallback.fallbackUser,
        system: res.system ?? fallback.fallbackSystem,
        client: res.client ?? fallback.fallbackClient,
        rowCount: res.rowCount,
        entries: res.entries,
      });
    });
  }

  return extractions;
}
