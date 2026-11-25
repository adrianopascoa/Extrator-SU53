import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { LoadedFile } from '../types/su53';
import {
  OcrLine,
  OcrSU53Extraction,
  OcrWord,
  parseSu53Lines,
} from './su53TextEngine';
import type { OcrRgbaFrame } from './su53ImageOcr';

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

const IMAGE_PAINT_OPS = new Set<number>([
  pdfjsLib.OPS.paintImageXObject,
  pdfjsLib.OPS.paintInlineImageXObject,
  pdfjsLib.OPS.paintImageXObjectRepeat,
  pdfjsLib.OPS.paintImageMaskXObject,
  pdfjsLib.OPS.paintImageMaskXObjectGroup,
  pdfjsLib.OPS.paintImageMaskXObjectRepeat,
  pdfjsLib.OPS.paintInlineImageXObjectGroup,
]);

function hasRasterImageOps(fnArray: ArrayLike<number>): boolean {
  for (let i = 0; i < fnArray.length; i++) {
    if (IMAGE_PAINT_OPS.has(fnArray[i])) {
      return true;
    }
  }
  return false;
}

type Matrix2D = [number, number, number, number, number, number];

function mulMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function findSingleUprightXObjectImageName(
  fnArray: ArrayLike<number>,
  argsArray: unknown[]
): string | null {
  let imageName: string | null = null;
  let ctm: Matrix2D = [1, 0, 0, 1, 0, 0];
  const stack: Matrix2D[] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === pdfjsLib.OPS.save) {
      stack.push(ctm);
    } else if (fn === pdfjsLib.OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === pdfjsLib.OPS.transform && Array.isArray(args) && args.length >= 6) {
      ctm = mulMatrix(ctm, [
        Number(args[0]) || 0,
        Number(args[1]) || 0,
        Number(args[2]) || 0,
        Number(args[3]) || 0,
        Number(args[4]) || 0,
        Number(args[5]) || 0,
      ]);
    } else if (fn === pdfjsLib.OPS.paintImageXObject) {
      if (imageName !== null) {
        return null;
      }
      if (!Array.isArray(args) || typeof args[0] !== 'string') {
        return null;
      }
      // Garante orientação reta sem rotação ou espelhamento
      if (
        ctm[0] <= 0 ||
        ctm[3] <= 0 ||
        Math.abs(ctm[1]) > 1e-3 ||
        Math.abs(ctm[2]) > 1e-3
      ) {
        return null;
      }
      imageName = args[0];
    } else if (IMAGE_PAINT_OPS.has(fn)) {
      return null;
    }
  }

  return imageName;
}

interface PdfDecodedImageObj {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

function resolvePdfImageObject(
  page: PDFPageProxy,
  objName: string
): Promise<PdfDecodedImageObj | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      if (page.objs.has(objName)) {
        clearTimeout(timer);
        resolve((page.objs.get(objName) as PdfDecodedImageObj) ?? null);
        return;
      }
      page.objs.get(objName, (data: unknown) => {
        clearTimeout(timer);
        resolve((data as PdfDecodedImageObj) ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function tryExtractDirectXObjectFrame(
  imgObj: PdfDecodedImageObj,
  computeScale: (origW: number, origH: number) => number
): OcrRgbaFrame | null {
  const origW = Number(imgObj.width) || 0;
  const origH = Number(imgObj.height) || 0;
  if (origW < 300 || origH < 150) return null;

  const scale = computeScale(origW, origH);
  const targetW = Math.max(1, Math.round(origW * scale));
  const targetH = Math.max(1, Math.round(origH * scale));

  if (imgObj.bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgObj.bitmap, 0, 0, targetW, targetH);
    const frameData = ctx.getImageData(0, 0, targetW, targetH).data;
    canvas.width = 0;
    canvas.height = 0;
    return {
      width: targetW,
      height: targetH,
      data: frameData,
      sourceScale: scale,
    };
  }

  if (!imgObj.data) return null;
  const srcData = imgObj.data;
  const totalPixels = origW * origH;
  const rgba = new Uint8ClampedArray(totalPixels * 4);

  if (imgObj.kind === 3 || srcData.length === totalPixels * 4) {
    rgba.set(srcData.subarray(0, totalPixels * 4));
  } else if (imgObj.kind === 2 || srcData.length === totalPixels * 3) {
    for (let i = 0, s = 0, d = 0; i < totalPixels; i++, s += 3, d += 4) {
      rgba[d] = srcData[s];
      rgba[d + 1] = srcData[s + 1];
      rgba[d + 2] = srcData[s + 2];
      rgba[d + 3] = 255;
    }
  } else if (imgObj.kind === 1 && srcData.length === totalPixels) {
    for (let i = 0, d = 0; i < totalPixels; i++, d += 4) {
      const v = srcData[i];
      rgba[d] = v;
      rgba[d + 1] = v;
      rgba[d + 2] = v;
      rgba[d + 3] = 255;
    }
  } else {
    return null;
  }

  if (Math.abs(scale - 1) < 1e-3) {
    return {
      width: origW,
      height: origH,
      data: rgba,
      sourceScale: 1,
    };
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = origW;
  srcCanvas.height = origH;
  const srcCtx = srcCanvas.getContext('2d');
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = targetW;
  dstCanvas.height = targetH;
  const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });

  if (!srcCtx || !dstCtx) {
    srcCanvas.width = 0;
    srcCanvas.height = 0;
    dstCanvas.width = 0;
    dstCanvas.height = 0;
    return null;
  }

  srcCtx.putImageData(new ImageData(rgba, origW, origH), 0, 0);
  dstCtx.fillStyle = '#ffffff';
  dstCtx.fillRect(0, 0, targetW, targetH);
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = 'high';
  dstCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);

  const frameData = dstCtx.getImageData(0, 0, targetW, targetH).data;
  srcCanvas.width = 0;
  srcCanvas.height = 0;
  dstCanvas.width = 0;
  dstCanvas.height = 0;

  return {
    width: targetW,
    height: targetH,
    data: frameData,
    sourceScale: scale,
  };
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

async function processSinglePdfDocument(pdfFile: LoadedFile): Promise<OcrSU53Extraction[]> {
  if (!pdfFile.pdfData) {
    throw new Error(`O arquivo PDF "${pdfFile.name}" não possui conteúdo legível.`);
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfFile.pdfData.slice(0)),
    useWorkerFetch: false,
    maxImageSize: 24_000_000,
    disableFontFace: true,
  });

  const pdf: PDFDocumentProxy = await loadingTask.promise;
  const MAX_PDF_PAGES = 50;
  const docMeta = {
    user: undefined as string | undefined,
    system: undefined as string | undefined,
    client: undefined as string | undefined,
  };

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `O arquivo PDF "${pdfFile.name}" possui ${pdf.numPages} páginas e excede o limite de ${MAX_PDF_PAGES} páginas para processamento local.`
      );
    }

    const pageExtractions: OcrSU53Extraction[] = [];
    const ocrPages: Array<{ pageNum: number; isPureImageOnly: boolean }> = [];

    // Fase 1: Extração paralela da camada de texto digital em lotes de 6 páginas
    const TEXT_BATCH_SIZE = 6;
    for (let startPage = 1; startPage <= pdf.numPages; startPage += TEXT_BATCH_SIZE) {
      const endPage = Math.min(pdf.numPages, startPage + TEXT_BATCH_SIZE - 1);
      const pageNums = Array.from(
        { length: endPage - startPage + 1 },
        (_, idx) => startPage + idx
      );

      const batchResults = await Promise.all(
        pageNums.map(async (pageNum) => {
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const textContent = await page.getTextContent();
          const { lines, fullText } = buildLinesFromPdfTextItems(
            textContent.items,
            baseViewport.height
          );
          const textParsed = parseSu53Lines(lines, fullText);

          let needsOcr = false;
          let isPureImageOnly = false;
          if (textParsed.entries.length === 0) {
            const nonWsLen = fullText.replace(/\s+/g, '').length;
            if (nonWsLen < 40 || /\uFFFD/.test(fullText)) {
              needsOcr = true;
              isPureImageOnly = nonWsLen === 0;
            } else {
              try {
                const opList = await page.getOperatorList();
                needsOcr = hasRasterImageOps(opList.fnArray);
              } catch {
                needsOcr = true;
              }
            }
          }

          page.cleanup();
          return { pageNum, textParsed, needsOcr, isPureImageOnly };
        })
      );

      for (const item of batchResults) {
        if (item.textParsed.user && !docMeta.user) docMeta.user = item.textParsed.user;
        if (item.textParsed.system && !docMeta.system) docMeta.system = item.textParsed.system;
        if (item.textParsed.client && !docMeta.client) docMeta.client = item.textParsed.client;

        if (item.textParsed.entries.length > 0) {
          pageExtractions.push(item.textParsed);
        } else if (item.needsOcr) {
          ocrPages.push({ pageNum: item.pageNum, isPureImageOnly: item.isPureImageOnly });
        }
      }
    }

    // Fase 2: Extração direta de XObject de imagem (quando aplicável) ou rasterização em canvas + OCR paralelo
    if (ocrPages.length > 0) {
      const ocrModulePromise = import('./su53ImageOcr');
      const {
        computeTargetOcrScale,
        extractSU53FromRgbaFrame,
        warmUpOcrWorker,
      } = await ocrModulePromise;
      warmUpOcrWorker();

      const ocrPromises: Array<Promise<OcrSU53Extraction>> = [];
      for (const { pageNum, isPureImageOnly } of ocrPages) {
        const page = await pdf.getPage(pageNum);
        let directFrame: OcrRgbaFrame | null = null;

        if (isPureImageOnly) {
          try {
            const opList = await page.getOperatorList();
            const singleImgName = findSingleUprightXObjectImageName(
              opList.fnArray,
              opList.argsArray
            );
            if (singleImgName) {
              const imgObj = await resolvePdfImageObject(page, singleImgName);
              if (imgObj) {
                directFrame = tryExtractDirectXObjectFrame(imgObj, computeTargetOcrScale);
              }
            }
          } catch {
            directFrame = null;
          }
        }

        if (directFrame) {
          page.cleanup();
          ocrPromises.push(extractSU53FromRgbaFrame(directFrame));
          continue;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        let scale = Math.min(2.2, Math.max(1.5, 1900 / Math.max(1, baseViewport.width)));
        if (baseViewport.width * scale > 2800) scale = 2800 / baseViewport.width;
        if (baseViewport.height * scale > 2400) {
          scale = Math.min(scale, 2400 / baseViewport.height);
        }
        scale = Math.max(1, scale);

        const renderViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(renderViewport.width));
        canvas.height = Math.max(1, Math.round(renderViewport.height));

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
          continue;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas,
          viewport: renderViewport,
        }).promise;

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();

        ocrPromises.push(
          extractSU53FromRgbaFrame({
            width: imgData.width,
            height: imgData.height,
            data: imgData.data,
            sourceScale: scale,
          })
        );
      }

      const ocrResults = await Promise.all(ocrPromises);
      for (const res of ocrResults) {
        if (res.user && !docMeta.user) docMeta.user = res.user;
        if (res.system && !docMeta.system) docMeta.system = res.system;
        if (res.client && !docMeta.client) docMeta.client = res.client;
        pageExtractions.push(res);
      }
    }

    return pageExtractions.map((extraction) => ({
      ...extraction,
      user: extraction.user ?? docMeta.user,
      system: extraction.system ?? docMeta.system,
      client: extraction.client ?? docMeta.client,
    }));
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractSU53DataFromPdfs(
  pdfFiles: LoadedFile[]
): Promise<OcrSU53Extraction[]> {
  if (pdfFiles.length === 0) return [];
  ensurePdfWorkerConfigured();

  const perFileResults = await Promise.all(
    pdfFiles.map((pdfFile) => processSinglePdfDocument(pdfFile))
  );
  return perFileResults.flat();
}
