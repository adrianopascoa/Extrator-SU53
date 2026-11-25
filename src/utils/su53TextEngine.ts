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

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
  'VERIF',
  'VERIFICACAO',
  'VERIFICACOES',
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
  'PERFIL',
  'ARMAZMTO',
  'ARMAZENAMENTO',
  'BUFFER',
  'RESULTADO',
  'RESULT',
  'DADOS',
  'AUTORIZACAO',
  'AUTORIZ',
  'AUTHORIZATION',
  'AUTHORIZATIONS',
  'EXIBIR',
  'EXIBICAO',
  'DISPLAY',
  'ULTIMA',
  'LAST',
  'ATUAL',
  'CURRENT',
  'NOME',
  'NAME',
  'USER',
  'USUARIO',
  'USUARIOS',
  'BNAME',
  'BENUTZER',
  'SYSID',
  'MANDT',
  'SAP',
  'SU53',
  'LOG',
  'INT4',
  'ADIC',
  'ADICIONAL',
  'INFORMACAO',
  'FILTRAGEM',
  'ACESSO',
  'ENTIDADE',
  'CDS',
  'TIPO',
  'APLICACAO',
  'TRANSACAO',
  'TRANSACTION',
  'GRAVADA',
  'GRAVADAS',
  'PROCESSAR',
  'CONFIGURACOES',
  'AJUDA',
  'BRAZIL',
  'BRT',
  'BRST',
  'UTC',
  'GMT',
  'CET',
  'VAZIO',
  'EMPTY',
  'NENHUM',
  'NENHUMA',
  'NONE',
  'NULL',
  'OBJCT',
  'FIELDNAME',
  'TCODE',
  'TCD',
  'PROGRAM',
  'PROGRAMA',
  'REPORT',
  'DYNPRO',
  'STATUS',
  'SUBRC',
  'RETURN',
  'TEXT',
  'TEXTO',
  'MSG',
  'MENSAGEM',
  'MESSAGE',
  'INFO',
  'ERROR',
  'ERRO',
  'FAIL',
  'SIM',
  'YES',
  'ALL',
  'UNAME',
  'SY-UNAME',
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

function normalizeTokenForMatch(raw: string): string {
  return stripDiacritics(raw)
    .replace(/^[[\](){}:;.,\-_=|"'`~]+|[[\](){}:;.,\-_=|"'`~]+$/g, '')
    .trim()
    .toLowerCase();
}

export function isOcrUsuarioWord(tokenLower: string): boolean {
  if (!tokenLower) return false;
  if (
    tokenLower === 'usuario' ||
    tokenLower === 'usurio' ||
    tokenLower === 'user' ||
    tokenLower === 'bname' ||
    tokenLower === 'uname' ||
    tokenLower === 'sy-uname' ||
    tokenLower === 'benutzer' ||
    tokenLower === 'benutzername'
  ) {
    return true;
  }
  // Variações comuns do OCR Tesseract 'eng' para "usuário" (ex.: usudrio, usuano, usudrlo, usuar1o, usuar.)
  return /^usu(?:[aeio0d]r(?:[i1l]?[o0]?|\.?)|[ae]n[o0]|r[i1l][o0])$/.test(
    tokenLower
  );
}

function isUserLabelLineText(lineText: string): boolean {
  const norm = stripDiacritics(lineText).trim();
  if (!norm) return false;
  if (/buffer\s+d[eo]\s+usu/i.test(norm)) return false;
  if (/verif(?:icacao)?\s+para\s+usu/i.test(norm)) return false;
  return (
    /\bn[o0]me\s*(?:d[eo]\s*)?(?:usu[a-z0-9.]{2,8}|usr\.?)\b/i.test(norm) ||
    /\b(?:sap\s+)?user(?:\s*(?:name|id|account))?\b/i.test(norm) ||
    /\b(?:bname|sy-?uname|uname|benutzer(?:name)?)\b/i.test(norm) ||
    /\b(?:usu[a-z0-9.]{2,8})\b/i.test(norm)
  );
}

export function sanitizeUserCandidate(raw: string): string | undefined {
  const cleaned = stripDiacritics(raw)
    .replace(/^[[\](){}:;.\-_\s"'`~|›»>]+|[[\](){}:;.,\-_\s"'`~|›»>]+$/g, '')
    .trim()
    .toUpperCase();
  if (cleaned.length < 2 || cleaned.length > 20) return undefined;
  if (!/^[A-Z0-9][A-Z0-9_.\-]{1,19}$/.test(cleaned)) return undefined;
  if (!/[A-Z]/.test(cleaned)) return undefined;
  if (/^\d+$/.test(cleaned)) return undefined;
  if (INVALID_USER_TOKENS.has(cleaned)) return undefined;
  // Ignora identificadores de instância SAP (ex.: vhhyhecpai02_ECP_00) ou fusos horários (UTC-3, GMT+0)
  if (/^[A-Z0-9\-]+_[A-Z0-9]{3}_\d{2}$/.test(cleaned)) return undefined;
  if (/^(?:UTC|GMT|BRT|BRST)(?:[+-]\d{1,2})?$/.test(cleaned)) return undefined;
  // Rejeita palavras que são variações OCR de "usuário" ou rótulos de cabeçalho
  const lower = cleaned.toLowerCase();
  if (isOcrUsuarioWord(lower)) return undefined;
  if (/^verif|^autoriz|^exibir|^gravad|^falhad|^param/.test(lower)) return undefined;
  return cleaned;
}

export function extractUserCandidateFromText(text: string): string | undefined {
  if (!text) return undefined;

  const rawLines = stripDiacritics(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Pass 1a: Padrões por linha para títulos de janela e rótulos diretos (sem cruzar linhas indevidamente)
  const lineTitlePatterns = [
    /(?:Exibir|Exibicao|Display|Anzeige)\b[^\n]{0,60}?\b(?:usu[a-z0-9.]{2,8}|user|benutzer)\s*[:=\-|›»>]?\s*([A-Z0-9_\-.]{2,20})\b/gi,
    /(?:verif\.?\s*autoriz\.?\s*falhada|Failed\s+Authorization\s+Check)\s*\(?\s*(?:usu[a-z0-9.]{2,8}|User)\s*[:=\-]?\s*([A-Z0-9_\-.]{2,20})\b/gi,
  ];

  for (const line of rawLines) {
    for (const regex of lineTitlePatterns) {
      regex.lastIndex = 0;
      for (const match of line.matchAll(regex)) {
        if (match[1]) {
          const valid = sanitizeUserCandidate(match[1]);
          if (valid) return valid;
        }
      }
    }
  }

  const normalized = rawLines.join(' ');

  // Pass 1b: Regex direta de alta confiança para "Nome do usuário" / "User Name" / "BNAME" / "UNAME"
  const highConfidenceRegexes = [
    /(?:n[o0]me\s+(?:d[eo]\s+)?usu[a-z0-9.]{2,8}|n[o0]me\s+usu[a-z0-9.]{2,8}|(?:sap\s+)?user\s*(?:name|id|account)|bname|sy-?uname|uname|benutzer(?:name)?)\s*[:=\-|›»>\s]*([A-Z0-9_\-.]{2,20})/gi,
  ];

  for (const regex of highConfidenceRegexes) {
    for (const match of normalized.matchAll(regex)) {
      if (match[1]) {
        const valid = sanitizeUserCandidate(match[1]);
        if (valid) return valid;
      }
    }
  }

  // Varredura por tokens para variações com palavras grudadas ou espaçamento irregular
  const tokens = normalized.split(/\s+/);

  // Pass 1c (tokens): "Nome [do] <usuarioWord> <USER>"
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = normalizeTokenForMatch(tokens[i]);
    const next1 = normalizeTokenForMatch(tokens[i + 1] ?? '');
    const next2 = normalizeTokenForMatch(tokens[i + 2] ?? '');

    let valIdx = -1;
    if ((t === 'nome' || t === 'n0me') && (next1 === 'do' || next1 === 'de') && isOcrUsuarioWord(next2)) {
      valIdx = i + 3;
    } else if ((t === 'nome' || t === 'n0me') && isOcrUsuarioWord(next1)) {
      valIdx = i + 2;
    } else if (
      (t === 'nome' || t === 'n0me') &&
      (next1.startsWith('do') || next1.startsWith('de')) &&
      isOcrUsuarioWord(next1.slice(2))
    ) {
      valIdx = i + 2;
    } else if (
      (t.startsWith('nomedo') || t.startsWith('nomede')) &&
      isOcrUsuarioWord(t.slice(6))
    ) {
      valIdx = i + 1;
    } else if (t === 'user' && (next1 === 'name' || next1 === 'id' || next1 === 'account')) {
      valIdx = i + 2;
    }

    if (valIdx !== -1) {
      for (let k = valIdx; k <= Math.min(tokens.length - 1, valIdx + 2); k++) {
        const valid = sanitizeUserCandidate(tokens[k]);
        if (valid) return valid;
      }
    }
  }

  // Pass 2 (linhas adjacentes + contexto do bloco textual):
  // Quando a label aparece em uma linha mas o usuário está em linha adjacente (ex.: exportações colunares, OCR com quebra ou PDF multi-bloco)
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!isUserLabelLineText(line)) continue;

    // Checa se a própria linha já traz um token válido após a label (incluindo "Usuário: VALOR" ou "User   VALOR")
    const afterLabelMatch = line.match(
      /(?:n[o0]me\s*(?:d[eo]\s*)?(?:usu[a-z0-9.]{2,8}|usr\.?)|(?:sap\s+)?user(?:\s*(?:name|id|account))?|bname|sy-?uname|uname|benutzer(?:name)?|usu[a-z0-9.]{2,8})\s*[:=\-|›»>\s]+(.+)$/i
    );
    if (afterLabelMatch?.[1]) {
      const tailTokens = afterLabelMatch[1].split(/\s+/).slice(0, 3);
      for (const tok of tailTokens) {
        const valid = sanitizeUserCandidate(tok);
        if (valid) return valid;
      }
    }

    // Analisa linhas adjacentes (+1, +2, +3 e -1) e janela do bloco de cabeçalho
    const candidateIndices = [i + 1, i + 2, i + 3, i - 1, i + 4, i + 5].filter(
      (idx) => idx >= 0 && idx < rawLines.length
    );
    for (const adjIdx of candidateIndices) {
      const adjLine = rawLines[adjIdx];
      // Interrompe se já entramos na tabela ALV de objetos
      if (/\b(?:objeto|object|objct)\b/i.test(adjLine) && /\b(?:campo|field|valor|value)\b/i.test(adjLine)) {
        break;
      }
      // Pula linhas que são puramente rótulos/valores de outros metadados conhecidos (Sistema, Mandante, Data, Hora, Instância)
      if (/^(?:sistema|system|sysid|mandante|client|mandt|data|date|hora|time|instancia|instance|param)/i.test(adjLine)) {
        continue;
      }
      const adjTokens = adjLine.split(/\s+/);
      // Prioriza linhas curtas (1-2 tokens, típico de célula/coluna isolada em PDF ou print quebrado)
      if (adjTokens.length <= 2) {
        for (const tok of adjTokens) {
          const valid = sanitizeUserCandidate(tok);
          if (valid) return valid;
        }
      }
    }
  }

  // Pass 3 (fallback final por tokens isolados): "Usuário <USER>" / "User <USER>", ignorando "Buffer do usuário" e "Verificação para usuário"
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = normalizeTokenForMatch(tokens[i]);
    const prev1 = i >= 1 ? normalizeTokenForMatch(tokens[i - 1]) : '';
    const prev2 = i >= 2 ? normalizeTokenForMatch(tokens[i - 2]) : '';

    if (
      (prev2 === 'buffer' && (prev1 === 'do' || prev1 === 'de')) ||
      (prev1 === 'para' && /^verif/.test(prev2))
    ) {
      continue;
    }

    if (isOcrUsuarioWord(t)) {
      for (let k = i + 1; k <= Math.min(tokens.length - 1, i + 2); k++) {
        const valid = sanitizeUserCandidate(tokens[k]);
        if (valid) return valid;
      }
    }
  }

  return undefined;
}

function findUserInLines(lines: OcrLine[], pass: 1 | 2): string | undefined {
  for (const line of lines) {
    const words = line.words || [];
    for (let j = 0; j < words.length; j++) {
      const wLower = normalizeTokenForMatch(words[j].text);
      const next1 = j + 1 < words.length ? normalizeTokenForMatch(words[j + 1].text) : '';
      const next2 = j + 2 < words.length ? normalizeTokenForMatch(words[j + 2].text) : '';
      let targetIdx = -1;

      if (pass === 1) {
        if ((wLower === 'nome' || wLower === 'n0me') && (next1 === 'do' || next1 === 'de') && isOcrUsuarioWord(next2)) {
          targetIdx = j + 3;
        } else if ((wLower === 'nome' || wLower === 'n0me') && isOcrUsuarioWord(next1)) {
          targetIdx = j + 2;
        } else if (
          (wLower === 'nome' || wLower === 'n0me') &&
          (next1.startsWith('do') || next1.startsWith('de')) &&
          isOcrUsuarioWord(next1.slice(2))
        ) {
          targetIdx = j + 2;
        } else if (
          (wLower.startsWith('nomedo') || wLower.startsWith('nomede')) &&
          isOcrUsuarioWord(wLower.slice(6))
        ) {
          targetIdx = j + 1;
        } else if (wLower === 'user' && (next1 === 'name' || next1 === 'id' || next1 === 'account')) {
          targetIdx = j + 2;
        } else if (wLower === 'bname' || wLower === 'uname' || wLower === 'sy-uname' || wLower === 'benutzer' || wLower === 'benutzername') {
          targetIdx = j + 1;
        } else if (
          /^autoriz/.test(wLower) &&
          (next1 === 'de' || next1 === 'do') &&
          isOcrUsuarioWord(next2)
        ) {
          targetIdx = j + 3;
        }
      } else {
        const prev1 = j >= 1 ? normalizeTokenForMatch(words[j - 1].text) : '';
        const prev2 = j >= 2 ? normalizeTokenForMatch(words[j - 2].text) : '';
        if (
          (prev2 === 'buffer' && (prev1 === 'do' || prev1 === 'de')) ||
          (prev1 === 'para' && /^verif/.test(prev2))
        ) {
          continue;
        }
        if (isOcrUsuarioWord(wLower)) {
          targetIdx = j + 1;
        }
      }

      if (targetIdx !== -1) {
        for (let k = targetIdx; k < Math.min(words.length, targetIdx + 3); k++) {
          const valid = sanitizeUserCandidate(words[k].text);
          if (valid) return valid;
        }
      }
    }
  }
  return undefined;
}

/**
 * Fallback espacial e contextual sobre linhas OCR/PDF:
 * Quando a label (ex.: "Nome do usuário") aparece em uma linha mas o valor está
 * deslocado em linhas adjacentes ou em outra coluna do bloco de cabeçalho.
 */
function findUserInAdjacentLinesAndBlock(
  lines: OcrLine[],
  knownSystem?: string
): string | undefined {
  let tableStartIdx = lines.findIndex((l) => {
    const lower = stripDiacritics(l.text).toLowerCase();
    return /\b(objeto|object|objct)\b/.test(lower) && /\b(campo|field|valor|value)\b/.test(lower);
  });
  if (tableStartIdx === -1) tableStartIdx = lines.length;

  const headerLines = lines.slice(0, tableStartIdx);
  if (headerLines.length === 0) return undefined;

  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    if (!isUserLabelLineText(line.text)) continue;

    // Encontra a posição X do término da label na linha
    let labelEndX = line.x0;
    for (const wd of line.words) {
      const norm = normalizeTokenForMatch(wd.text);
      if (
        isOcrUsuarioWord(norm) ||
        norm === 'nome' ||
        norm === 'n0me' ||
        norm.startsWith('nomedo')
      ) {
        labelEndX = Math.max(labelEndX, wd.x1);
      }
    }

    // Verifica linhas adjacentes (+1, +2, -1, +3, +4) priorizando palavras próximas à coluna de valor
    const offsets = [1, 2, -1, 3, 4];
    for (const off of offsets) {
      const idx = i + off;
      if (idx < 0 || idx >= headerLines.length) continue;
      const adj = headerLines[idx];

      // 1) Palavras à direita da label (mesma coluna de valor em prints com leve desalinhamento vertical)
      for (const wd of adj.words) {
        if (wd.x0 >= labelEndX - 12) {
          const valid = sanitizeUserCandidate(wd.text);
          if (valid && valid !== knownSystem) return valid;
        }
      }

      // 2) Linha curta isolada (ex.: célula única em fluxo PDF colunar)
      if (adj.words.length <= 2) {
        for (const wd of adj.words) {
          const valid = sanitizeUserCandidate(wd.text);
          if (valid && valid !== knownSystem) return valid;
        }
      }
    }
  }

  return undefined;
}

function extractMetadataFromLines(lines: OcrLine[], fullText: string): {
  user?: string;
  system?: string;
  client?: string;
} {
  let system: string | undefined;
  let client: string | undefined;

  for (const line of lines) {
    const text = line.text;

    if (!system) {
      const sysMatch = text.match(
        /(?:Sistema|System|SYSID)\s*[:\-|[\](){}\s]*([A-Z0-9]{3})\b/i
      );
      if (sysMatch?.[1]) {
        system = sysMatch[1].trim().toUpperCase();
      }
    }

    if (!client) {
      const cliMatch = text.match(
        /(?:Mandante|Client|MANDT)\s*[:\-|[\](){}\s]*(\d{3})\b/i
      );
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

  let user = findUserInLines(lines, 1);
  if (!user) {
    user = extractUserCandidateFromText(fullText);
  }
  if (!user) {
    user = findUserInAdjacentLinesAndBlock(lines, system);
  }
  if (!user) {
    user = findUserInLines(lines, 2);
  }

  if (!user) {
    for (const line of lines) {
      user = extractUserCandidateFromText(line.text);
      if (user) break;
    }
  }

  return { user, system, client };
}

function cleanTableToken(raw: string): string {
  return raw.replace(/^[|[\](){}<>]+|[|[\](){}<>]+$/g, '').trim();
}

function cleanHeaderToken(raw: string): string {
  return raw
    .replace(/^[,.;:"'!~`|[\](){}<>]+|[,.;:"'!~`|[\](){}<>]+$/g, '')
    .trim();
}

function isObjectHeaderToken(raw: string): boolean {
  const cleaned = stripDiacritics(cleanHeaderToken(raw)).toLowerCase();
  return /^(?:[o0]b[ij1l]?[e3]t[o0a]|ob[ij]ect|objct|obiete|onieta|obieto|obdjeto|objelo|ojeto)$/.test(
    cleaned
  );
}

function isFieldHeaderToken(raw: string): boolean {
  const cleaned = stripDiacritics(cleanHeaderToken(raw)).toLowerCase();
  return /^(?:[ck]amp[o0a]|carmp[o0a]|camp[o0][1il]?|cam[o0]|lampa|camno|field|fieldname)(\d+[a-z]?)?$/.test(
    cleaned
  );
}

function isValueHeaderToken(raw: string): boolean {
  const cleaned = stripDiacritics(cleanHeaderToken(raw)).toLowerCase();
  return /^(?:[vi1ln]?[a4][lt][o0e]r|vakor|nalor|talor|vator|vaor|ivator|value|val\.?)(\d+[a-z]?)?$/.test(
    cleaned
  );
}

function expandHeaderWords(words: OcrWord[]): OcrWord[] {
  const expanded: OcrWord[] = [];
  for (const wd of words) {
    if (/[|!'/]/.test(wd.text) && /[a-zA-Z]/.test(wd.text)) {
      const totalLen = Math.max(1, wd.text.length);
      const totalW = Math.max(1, wd.x1 - wd.x0);
      const regex = /[^|!'/]+/g;
      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = regex.exec(wd.text)) !== null) {
        const part = match[0].trim();
        if (!part) continue;
        const px0 = wd.x0 + (match.index / totalLen) * totalW;
        const px1 = wd.x0 + ((match.index + part.length) / totalLen) * totalW;
        expanded.push({
          ...wd,
          text: part,
          x0: px0,
          x1: Math.max(px0 + 2, px1),
        });
        count++;
      }
      if (count > 0) continue;
    }
    expanded.push(wd);
  }
  return expanded;
}

function parseHeaderColumns(headerLine: OcrLine): HeaderColumn[] {
  const words = expandHeaderWords(headerLine.words);
  let objIdx = words.findIndex((w) => isObjectHeaderToken(w.text));

  // Se "Objeto" sofreu OCR severo, mas há colunas "Campo"/"Valor", ancora na coluna imediatamente à esquerda do primeiro "Campo"
  if (objIdx === -1) {
    const firstFieldIdx = words.findIndex((w) => isFieldHeaderToken(w.text));
    if (firstFieldIdx > 0) {
      for (let idx = firstFieldIdx - 1; idx >= 0; idx--) {
        const cand = stripDiacritics(cleanHeaderToken(words[idx].text)).toLowerCase();
        if (!cand || /^\d+$/.test(cand)) continue;
        if (
          /^(?:cds|entidade|acesso|filtragem|adicional|informacao|resultado|usuario|aplicacao)$/.test(
            cand
          )
        ) {
          break;
        }
        if (words[firstFieldIdx].x0 - words[idx].x1 < 260) {
          objIdx = idx;
        }
        break;
      }
    }
  }

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
    const raw = cleanHeaderToken(words[i].text);
    const lower = stripDiacritics(raw).toLowerCase();

    const isFieldWord = isFieldHeaderToken(raw);
    const isValueWord = isValueHeaderToken(raw);

    if (isFieldWord) {
      const startX0 = words[i].x0;
      let x1 = words[i].x1;
      let pairNum = nextPairIdx;

      const embeddedNum = lower.match(/(\d+)/);
      if (embeddedNum) {
        pairNum = parseInt(embeddedNum[1], 10);
      } else if (/^camp[o0][il]$/i.test(lower) && nextPairIdx === 1) {
        pairNum = 1;
      } else if (
        i + 1 < words.length &&
        /^(\d{1,2}|[5sil])$/i.test(cleanHeaderToken(words[i + 1].text))
      ) {
        const parsedNext = cleanHeaderToken(words[i + 1].text)
          .replace(/s/i, '5')
          .replace(/^[il]$/i, '1');
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
      } else if (
        i + 1 < words.length &&
        /^(\d{1,2}|[5sil])$/i.test(cleanHeaderToken(words[i + 1].text))
      ) {
        const parsedNext = cleanHeaderToken(words[i + 1].text)
          .replace(/s/i, '5')
          .replace(/^[il]$/i, '1');
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
      ? col.x0 - Math.min(24, Math.max(8, (col.x0 - prevCol.x1) * 0.45))
      : col.x0 - 24;
    const endX = nextCol
      ? nextCol.x0 - Math.min(24, Math.max(8, (nextCol.x0 - col.x1) * 0.45))
      : Number.MAX_SAFE_INTEGER;
    return { col, startX, endX };
  });

  const headerBottom = lines[headerLineIdx].y1;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.y0 < headerBottom - 4) continue;

    const colTokens = new Map<number, string[]>();
    for (const wd of line.words) {
      const cleanedWord = cleanTableToken(wd.text);
      if (!cleanedWord) continue;
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
          const splitMatch = cleanedWord.match(/^([A-Z0-9_\/]{2,20}?)\.{2,}(.+)$/i);
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
        arr.push(cleanedWord);
        colTokens.set(matchedIdx, arr);
      }
    }

    const rawObj = cleanTableToken((colTokens.get(0) ?? []).join('')).toUpperCase();
    if (!rawObj || !/^[A-Z0-9_\/]{2,30}$/.test(rawObj)) continue;
    if (/^(OBJETO|OBJECT|TOTAL|SOMA)$/.test(rawObj)) continue;

    const fieldsList: Array<{ fieldName: string; values: string[] }> = [];

    for (let c = 1; c < colBounds.length; c++) {
      const current = colBounds[c].col;
      if (current.kind !== 'field') continue;

      let fieldName = cleanTableToken((colTokens.get(c) ?? []).join('')).toUpperCase();
      if (!fieldName) continue;

      let valueText = '';
      if (c + 1 < colBounds.length && colBounds[c + 1].col.kind === 'value') {
        valueText = cleanTableToken((colTokens.get(c + 1) ?? []).join(' '));
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

/**
 * Fallback tabular sem cabeçalho confiável (ex.: cabeçalho azul #6780B8 ou recorte sem linha de título):
 * Detecta linhas de log SU53 (data/hora/instância/RC ou objeto SAP + pares Campo/Valor),
 * alinha pela coluna X dominante de Objeto e extrai todos os pares Campo/Valor à direita.
 */
function parseAlvRowsFallback(
  lines: OcrLine[],
  minHeaderBottomY = -1
): { entries: OcrExtractedEntry[]; rowCount: number } {
  interface CandidateRow {
    objWord: OcrWord;
    objName: string;
    tailWords: OcrWord[];
  }

  const candidateRows: CandidateRow[] = [];

  for (const line of lines) {
    if (minHeaderBottomY >= 0 && line.y0 < minHeaderBottomY - 4) continue;
    const words = line.words
      .map((wd) => ({ ...wd, text: cleanTableToken(wd.text) }))
      .filter((wd) => wd.text.length > 0);
    if (words.length < 3) continue;

    // Pula linhas que são claramente cabeçalho de metadados (Nome do usuário, Sistema, Data, Instância)
    const lineNorm = stripDiacritics(line.text).toLowerCase();
    if (
      /^(?:analise|nome\s+d[eo]\s+usu|sistema\b|data\s+\d{2}\.|instancia\b)/.test(
        lineNorm
      )
    ) {
      continue;
    }

    // Procura âncora de código de retorno (RC: 4, 12, 0) ou início de linha com YYYYMMDD / HH:MM:SS
    const hasSu53RowPrefix =
      /^(?:\d{8}|\d{2}\.\d{2}\.\d{4})\b/.test(words[0].text) ||
      /^\d{1,2}$/.test(words[0].text);

    // Encontra o índice onde terminam os metadados da esquerda (data, hora, instância, transação, RC, flag X)
    let searchStart = 0;
    for (let i = 0; i < words.length; i++) {
      const t = words[i].text;
      if (
        /^\d{8}$/.test(t) ||
        /^\d{2}:\d{2}:\d{2}/.test(t) ||
        /_[A-Z0-9]{3}_\d{2}$/i.test(t) ||
        /^transac/i.test(stripDiacritics(t))
      ) {
        searchStart = i + 1;
      }
    }

    // Avança além do nome da transação/programa, RC numérico (\d{1,2}) e eventual flag 'X'
    let rcIdx = -1;
    for (let i = searchStart; i < Math.min(words.length - 2, searchStart + 4); i++) {
      if (/^(?:0|4|8|12|16)$/.test(words[i].text)) {
        rcIdx = i;
        break;
      }
    }
    if (rcIdx !== -1) {
      searchStart = rcIdx + 1;
    } else if (!hasSu53RowPrefix) {
      continue;
    }

    // Pula texto de resultado ("Verificacao de autorizacao sem exito") ou flag 'X'
    while (searchStart < words.length) {
      const tokNorm = stripDiacritics(words[searchStart].text).toLowerCase();
      if (
        tokNorm === 'x' ||
        /^(?:verif|veif|de|autoriz|sem|exito|falha)/.test(tokNorm)
      ) {
        searchStart++;
        continue;
      }
      break;
    }

    if (searchStart + 2 >= words.length) continue;

    // Se houver uma Entidade CDS (ex.: SHSM_M_MEKKH) seguida de outro objeto SAP válido e pares Campo/Valor
    let objIdx = searchStart;
    const firstCand = words[objIdx].text.toUpperCase();
    const secondCand = words[objIdx + 1]?.text.toUpperCase() ?? '';
    if (
      /^SHSM_/i.test(firstCand) &&
      /^[A-Z][A-Z0-9_\/]{2,29}$/.test(secondCand) &&
      objIdx + 3 < words.length
    ) {
      objIdx++;
    }

    const objName = words[objIdx].text.toUpperCase();
    if (!/^[A-Z][A-Z0-9_\/]{2,29}$/.test(objName)) continue;
    if (INVALID_USER_TOKENS.has(objName)) continue;

    const tailWords = words.slice(objIdx + 1);
    if (tailWords.length < 2) continue;

    candidateRows.push({
      objWord: words[objIdx],
      objName,
      tailWords,
    });
  }

  if (candidateRows.length === 0) {
    return { entries: [], rowCount: 0 };
  }

  // Determina a posição X dominante da coluna Objeto para evitar capturar Entidade CDS como Objeto
  const sortedX0 = candidateRows
    .map((r) => r.objWord.x0)
    .sort((a, b) => a - b);
  const medianObjX0 = sortedX0[sortedX0.length >> 1];

  const entries: OcrExtractedEntry[] = [];
  let rowCount = 0;

  for (const row of candidateRows) {
    let workingTail = row.tailWords;
    let objName = row.objName;

    // Se o token capturado ficou muito à esquerda da coluna Objeto (ex.: CDS não filtrada) e o próximo token alinha com medianObjX0
    if (
      row.objWord.x0 < medianObjX0 - 40 &&
      workingTail.length >= 3 &&
      Math.abs(workingTail[0].x0 - medianObjX0) <= 40 &&
      /^[A-Z][A-Z0-9_\/]{2,29}$/.test(workingTail[0].text.toUpperCase())
    ) {
      objName = workingTail[0].text.toUpperCase();
      workingTail = workingTail.slice(1);
    }

    const fields: Array<{ fieldName: string; values: string[] }> = [];
    for (let k = 0; k < workingTail.length; k += 2) {
      let fieldName = workingTail[k].text.toUpperCase();
      let val = workingTail[k + 1]?.text ?? '';

      const mergedMatch = fieldName.match(/^([A-Z0-9_\/]{2,20}?)\.{2,}(.+)$/);
      if (mergedMatch) {
        fieldName = mergedMatch[1];
        if (!val) val = mergedMatch[2].trim();
        k--;
      }

      fieldName = fieldName.replace(/\.+$/, '').trim();
      if (!fieldName || !/^[A-Z0-9_\/]{2,30}$/.test(fieldName)) continue;
      if (INVALID_USER_TOKENS.has(fieldName)) continue;

      fields.push({
        fieldName,
        values: val ? [val] : [],
      });
    }

    if (fields.length > 0) {
      entries.push({ objectName: objName, fields });
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
    const lineLower = stripDiacritics(lines[i].text).toLowerCase();
    const hasFieldOrValHint =
      /(?:campo|campa|carmpo|camno|lampa|field|valor|vakor|nalor|talor|vator|valer|value)/i.test(
        lineLower
      );
    const hasObjHint =
      /(?:objeto|object|objct|obiete|onieta|obieto|obdjeto|objelo)/i.test(lineLower);

    if (hasFieldOrValHint && (hasObjHint || lines[i].words.length >= 4)) {
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

  // Se o cabeçalho não detectou pares suficientes (ex.: apenas Campo 1 e Valor 1, truncando Campo 2+) ou falhou,
  // executa o fallback espacial de linhas ALV para comparar e usar a extração mais completa.
  if (parsed.entries.length === 0 || bestColumns.length <= 3) {
    const minY = bestHeaderIdx !== -1 ? lines[bestHeaderIdx].y1 : -1;
    const fallbackAlv = parseAlvRowsFallback(lines, minY);
    const parsedFieldCount = parsed.entries.reduce((acc, e) => acc + e.fields.length, 0);
    const fallbackFieldCount = fallbackAlv.entries.reduce((acc, e) => acc + e.fields.length, 0);
    if (
      fallbackAlv.entries.length > parsed.entries.length ||
      fallbackFieldCount > parsedFieldCount
    ) {
      parsed = fallbackAlv;
    }
  }

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
