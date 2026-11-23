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
