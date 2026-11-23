import {
  BatchExtractionResult,
  ExtractedField,
  ExtractedObject,
  LoadedFile,
} from '../types/su53';
import { DEFAULT_CRITICAL_ITEMS } from './criticalRules';
import {
  extractUserCandidateFromText,
  INVALID_USER_TOKENS,
  OcrSU53Extraction,
} from './su53TextEngine';

export const CRITICAL_ITEMS = new Set<string>(DEFAULT_CRITICAL_ITEMS);
export const UNIDENTIFIED_USER = 'Não identificado';

export function buildCriticalSet(customList?: string[]): Set<string> {
  if (!customList) return CRITICAL_ITEMS;
  return new Set(customList.map((item) => item.trim().toUpperCase()).filter(Boolean));
}

export function isCriticalToken(
  token: string | undefined | null,
  criticalSet: Set<string> = CRITICAL_ITEMS
): boolean {
  if (!token) return false;
  return criticalSet.has(token.trim().toUpperCase());
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

interface InternalFieldAccumulator {
  values: Set<string>;
  valuesByUser: Map<string, Set<string>>;
}

interface InternalObjectAccumulator {
  users: Set<string>;
  fields: Map<string, InternalFieldAccumulator>;
}

function addEntryValue(
  objectsMap: Map<string, InternalObjectAccumulator>,
  objName: string,
  fieldName: string,
  fieldVal: string,
  sourceUser: string
): void {
  if (!objectsMap.has(objName)) {
    objectsMap.set(objName, {
      users: new Set<string>(),
      fields: new Map<string, InternalFieldAccumulator>(),
    });
  }
  const objAcc = objectsMap.get(objName)!;
  objAcc.users.add(sourceUser);

  if (!objAcc.fields.has(fieldName)) {
    objAcc.fields.set(fieldName, {
      values: new Set<string>(),
      valuesByUser: new Map<string, Set<string>>(),
    });
  }
  const fieldAcc = objAcc.fields.get(fieldName)!;
  if (!fieldAcc.valuesByUser.has(sourceUser)) {
    fieldAcc.valuesByUser.set(sourceUser, new Set<string>());
  }
  if (fieldVal !== '') {
    fieldAcc.values.add(fieldVal);
    fieldAcc.valuesByUser.get(sourceUser)!.add(fieldVal);
  }
}

function extractSpacedTextFromHtml(doc: Document): string {
  if (!doc.body) return '';
  const blocks: string[] = [];
  const rows = Array.from(doc.body.querySelectorAll('tr'));
  if (rows.length > 0) {
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td')).map((c) =>
        (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
      );
      const line = cells.filter(Boolean).join('  ');
      if (line) blocks.push(line);
    }
  }
  const clone = doc.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style').forEach((el) => el.remove());
  const rawHtmlText = (clone.innerHTML || '')
    .replace(/<(br|\/tr|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/(td|th|span|font|b|strong|nobr)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[ \t]+/g, ' ');
  return `${blocks.join('\n')}\n${rawHtmlText}`;
}

function parseHTMLFilesIntoMaps(
  htmlFiles: LoadedFile[],
  objectsMap: Map<string, InternalObjectAccumulator>,
  identifiedUsersSet: Set<string>,
  systemsSet: Set<string>
): number {
  let totalRowsProcessed = 0;
  const parser = new DOMParser();

  htmlFiles.forEach((fileObj) => {
    const doc = parser.parseFromString(fileObj.content || '', 'text/html');
    const spacedText = extractSpacedTextFromHtml(doc);

    let fileUser = UNIDENTIFIED_USER;
    const detectedFromText = extractUserCandidateFromText(spacedText);
    if (detectedFromText) {
      fileUser = detectedFromText;
      identifiedUsersSet.add(detectedFromText);
    }

    const tables = doc.querySelectorAll('table');

    // Fallback em pares de células (ex: <td>Nome do usuário</td><td>JOAO.SILVA</td>)
    if (fileUser === UNIDENTIFIED_USER) {
      outer: for (const table of Array.from(tables)) {
        for (const row of Array.from(table.querySelectorAll('tr'))) {
          const cells = Array.from(row.querySelectorAll('th, td')).map((c) =>
            (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
          );
          for (let i = 0; i < cells.length - 1; i++) {
            if (
              /^(nome\s+(?:do\s+)?usu[áa]r(?:io|\.)?|usu[áa]r(?:io|\.)?|user(?:\s*(?:name|id))?|bname)\s*:?$/i.test(
                cells[i]
              )
            ) {
              const candidate = cells[i + 1].replace(/^[:\-\s]+|[:\-\s]+$/g, '').toUpperCase();
              if (
                candidate.length >= 2 &&
                candidate.length <= 20 &&
                !/^\d+$/.test(candidate) &&
                !INVALID_USER_TOKENS.has(candidate)
              ) {
                fileUser = candidate;
                identifiedUsersSet.add(candidate);
                break outer;
              }
            }
          }
        }
      }
    }

    const sysMatch = spacedText.match(/(?:Sistema|System|SYSID)\s*[:\-]?\s*([A-Z0-9]{3})\b/i);
    const cliMatch = spacedText.match(/(?:Mandante|Client|MANDT)\s*[:\-]?\s*(\d{3})\b/i);
    if (sysMatch || cliMatch) {
      const sysStr = sysMatch ? sysMatch[1].toUpperCase() : '';
      const cliStr = cliMatch ? cliMatch[1] : '';
      const combined = [sysStr, cliStr].filter(Boolean).join(' / ');
      if (combined) systemsSet.add(combined);
    }

    tables.forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tr'));
      let objColIdx = -1;
      let userColIdx = -1;
      let fieldValuePairs: Array<{ fieldIdx: number; valIdx: number }> = [];

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('th, td')).map((c) =>
          (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
        );

        if (cells.length === 0) continue;

        const foundObjIdx = cells.findIndex((c) => /^(objeto|object|objct)$/i.test(c));
        if (foundObjIdx !== -1) {
          objColIdx = foundObjIdx;
          userColIdx = cells.findIndex((c) =>
            /^(usu[áa]rio|usuario|user|bname)$/i.test(c)
          );
          fieldValuePairs = [];

          for (let i = objColIdx + 1; i < cells.length; i++) {
            if (/^(campo|field|fieldname)$/i.test(cells[i])) {
              let valIdx = -1;
              if (i + 1 < cells.length && /^(valor|value|val\.?)$/i.test(cells[i + 1])) {
                valIdx = i + 1;
              } else if (i + 1 < cells.length) {
                valIdx = i + 1;
              }
              if (valIdx !== -1) {
                fieldValuePairs.push({ fieldIdx: i, valIdx });
              }
            }
          }
          continue;
        }

        if (objColIdx !== -1 && cells.length > objColIdx) {
          const rawObj = (cells[objColIdx] || '').trim().toUpperCase();
          if (!rawObj || /^(objeto|object|total|soma|\*+)$/i.test(rawObj)) continue;
          if (!/^[A-Z0-9_\/]{2,30}$/.test(rawObj)) continue;

          let rowUser = fileUser;
          if (userColIdx !== -1 && cells[userColIdx]) {
            const candidate = cells[userColIdx].trim().toUpperCase();
            if (
              candidate.length >= 2 &&
              candidate.length <= 20 &&
              !INVALID_USER_TOKENS.has(candidate)
            ) {
              rowUser = candidate;
              identifiedUsersSet.add(candidate);
            }
          }

          let rowHadData = false;

          if (fieldValuePairs.length > 0) {
            for (const pair of fieldValuePairs) {
              const fieldName = (cells[pair.fieldIdx] || '').trim().toUpperCase();
              const fieldVal = (cells[pair.valIdx] || '').trim();

              if (!fieldName || /^(campo|field)$/i.test(fieldName)) continue;
              addEntryValue(objectsMap, rawObj, fieldName, fieldVal, rowUser);
              rowHadData = true;
            }
          } else {
            for (let i = objColIdx + 1; i < cells.length; i += 2) {
              if (i === userColIdx || i + 1 === userColIdx) continue;
              const fieldName = (cells[i] || '').trim().toUpperCase();
              const fieldVal = (cells[i + 1] || '').trim();
              if (!fieldName) continue;
              addEntryValue(objectsMap, rawObj, fieldName, fieldVal, rowUser);
              rowHadData = true;
            }
          }

          if (rowHadData) totalRowsProcessed++;
        }
      }
    });
  });

  return totalRowsProcessed;
}

function mergeStructuredExtractionsIntoMaps(
  responses: OcrSU53Extraction[],
  objectsMap: Map<string, InternalObjectAccumulator>,
  identifiedUsersSet: Set<string>,
  systemsSet: Set<string>
): number {
  let totalRows = 0;

  responses.forEach((data) => {
    let sourceUser = UNIDENTIFIED_USER;
    if (data.user && data.user.trim()) {
      sourceUser = data.user.trim().toUpperCase();
      identifiedUsersSet.add(sourceUser);
    }

    const sysStr = data.system ? data.system.trim().toUpperCase() : '';
    const cliStr = data.client ? data.client.trim() : '';
    const combinedSys = [sysStr, cliStr].filter(Boolean).join(' / ');
    if (combinedSys) {
      systemsSet.add(combinedSys);
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    entries.forEach((entry) => {
      const rawObj = (entry.objectName || '').trim().toUpperCase();
      if (!rawObj) return;

      const fields = Array.isArray(entry.fields) ? entry.fields : [];
      fields.forEach((field) => {
        const fieldName = (field.fieldName || '').trim().toUpperCase();
        if (!fieldName) return;

        const values = Array.isArray(field.values) ? field.values : [];
        if (values.length === 0) {
          addEntryValue(objectsMap, rawObj, fieldName, '', sourceUser);
        } else {
          values.forEach((v) => {
            const cleanVal = String(v ?? '').trim();
            addEntryValue(objectsMap, rawObj, fieldName, cleanVal, sourceUser);
          });
        }
      });
    });

    totalRows +=
      typeof data.rowCount === 'number' && data.rowCount > 0
        ? data.rowCount
        : entries.length;
  });

  return totalRows;
}

export async function extractSU53FromBatch(
  filesArray: LoadedFile[],
  criticalItems?: string[]
): Promise<BatchExtractionResult> {
  const criticalSet = buildCriticalSet(criticalItems);
  const objectsMap = new Map<string, InternalObjectAccumulator>();
  const identifiedUsersSet = new Set<string>();
  const systemsSet = new Set<string>();
  let totalRowsProcessed = 0;

  const htmlFiles = filesArray.filter((f) => f.kind === 'html');
  const imageFiles = filesArray.filter((f) => f.kind === 'image');
  const pdfFiles = filesArray.filter((f) => f.kind === 'pdf');

  if (htmlFiles.length > 0) {
    totalRowsProcessed += parseHTMLFilesIntoMaps(
      htmlFiles,
      objectsMap,
      identifiedUsersSet,
      systemsSet
    );
  }

  if (imageFiles.length > 0) {
    const { extractSU53DataFromImages } = await import('./su53ImageOcr');
    const imageResponses = await extractSU53DataFromImages(imageFiles);
    totalRowsProcessed += mergeStructuredExtractionsIntoMaps(
      imageResponses,
      objectsMap,
      identifiedUsersSet,
      systemsSet
    );
  }

  if (pdfFiles.length > 0) {
    const { extractSU53DataFromPdfs } = await import('./su53PdfExtractor');
    const pdfResponses = await extractSU53DataFromPdfs(pdfFiles);
    totalRowsProcessed += mergeStructuredExtractionsIntoMaps(
      pdfResponses,
      objectsMap,
      identifiedUsersSet,
      systemsSet
    );
  }

  if (objectsMap.size === 0) {
    throw new Error(
      'Nenhum objeto de autorização da SU53 foi encontrado nos arquivos selecionados.'
    );
  }

  const detectedCriticalsSet = new Set<string>();
  const allSeenUsersSet = new Set<string>();
  const objects: ExtractedObject[] = [];

  for (const [objName, acc] of objectsMap.entries()) {
    const isCriticalName = isCriticalToken(objName, criticalSet);
    if (isCriticalName) {
      detectedCriticalsSet.add(objName);
    }

    const objUsers = Array.from(acc.users);
    objUsers.forEach((u) => allSeenUsersSet.add(u));

    let hasCriticalValue = false;
    const fields: ExtractedField[] = Array.from(acc.fields.entries()).map(
      ([fieldName, fieldAcc]) => {
        const values = Array.from(fieldAcc.values);
        values.forEach((val) => {
          if (isCriticalToken(val, criticalSet)) {
            hasCriticalValue = true;
            detectedCriticalsSet.add(val.trim().toUpperCase());
          }
        });

        const valuesByUser: Record<string, string[]> = Object.create(null) as Record<
          string,
          string[]
        >;
        for (const [u, uSet] of fieldAcc.valuesByUser.entries()) {
          if (u === '__proto__' || u === 'constructor' || u === 'prototype') continue;
          valuesByUser[u] = Array.from(uSet);
        }

        return { name: fieldName, values, valuesByUser };
      }
    );

    objects.push({
      name: objName,
      fields,
      users: objUsers,
      isCriticalName,
      hasCriticalContent: isCriticalName || hasCriticalValue,
    });
  }

  const distinctUsers =
    identifiedUsersSet.size > 0
      ? Array.from(allSeenUsersSet)
      : [];

  return {
    objects,
    metadata: {
      user:
        identifiedUsersSet.size > 0
          ? Array.from(identifiedUsersSet).join(', ')
          : UNIDENTIFIED_USER,
      users: distinctUsers,
      sys: systemsSet.size > 0 ? Array.from(systemsSet).join(', ') : 'Não identificado',
      objectCount: objects.length,
      fileCount: filesArray.length,
      rowCount: totalRowsProcessed,
      rowLabel: `${filesArray.length} arq. / ${totalRowsProcessed} lin.`,
    },
    detectedCriticals: Array.from(detectedCriticalsSet),
  };
}

/**
 * Recalcula flags e lista de itens críticos após edição manual ou alteração da lista de regras críticas.
 */
export function reapplyCriticalRules(
  result: BatchExtractionResult,
  criticalItems?: string[]
): BatchExtractionResult {
  const criticalSet = buildCriticalSet(criticalItems);
  const detectedCriticalsSet = new Set<string>();
  const usersSet = new Set<string>();

  const updatedObjects: ExtractedObject[] = result.objects.map((obj) => {
    const objUsers = Array.isArray(obj.users) ? obj.users : [];
    objUsers.forEach((u) => {
      if (u && u !== UNIDENTIFIED_USER) usersSet.add(u);
    });

    const isCriticalName = isCriticalToken(obj.name, criticalSet);
    if (isCriticalName) {
      detectedCriticalsSet.add(obj.name.trim().toUpperCase());
    }

    let hasCriticalValue = false;
    const updatedFields = obj.fields.map((field) => {
      field.values.forEach((val) => {
        if (isCriticalToken(val, criticalSet)) {
          hasCriticalValue = true;
          detectedCriticalsSet.add(val.trim().toUpperCase());
        }
      });
      return field;
    });

    return {
      ...obj,
      users: objUsers,
      fields: updatedFields,
      isCriticalName,
      hasCriticalContent: isCriticalName || hasCriticalValue,
    };
  });

  const allSeenUsers = Array.from(
    new Set(
      updatedObjects.flatMap((o) => (Array.isArray(o.users) ? o.users : []))
    )
  );

  return {
    ...result,
    objects: updatedObjects,
    metadata: {
      ...result.metadata,
      user:
        usersSet.size > 0
          ? Array.from(usersSet).join(', ')
          : result.metadata.user || UNIDENTIFIED_USER,
      users:
        usersSet.size > 0
          ? allSeenUsers
          : result.metadata.users || [],
      objectCount: updatedObjects.length,
    },
    detectedCriticals: Array.from(detectedCriticalsSet),
  };
}

/**
 * Projeta os objetos para um único usuário selecionado (mantendo apenas seus campos e valores).
 */
export function projectObjectsForUser(
  objects: ExtractedObject[],
  selectedUser: string,
  criticalSet: Set<string> = CRITICAL_ITEMS
): ExtractedObject[] {
  if (!selectedUser || selectedUser === 'ALL') return objects;

  const projected: ExtractedObject[] = [];

  for (const obj of objects) {
    const objUsers = Array.isArray(obj.users) ? obj.users : [];
    if (!objUsers.includes(selectedUser)) continue;

    const userFields: ExtractedField[] = [];
    let hasCriticalValue = false;

    for (const field of obj.fields) {
      if (
        field.valuesByUser &&
        Object.prototype.hasOwnProperty.call(field.valuesByUser, selectedUser)
      ) {
        const userVals = field.valuesByUser[selectedUser] || [];
        userVals.forEach((v) => {
          if (isCriticalToken(v, criticalSet)) hasCriticalValue = true;
        });
        userFields.push({
          ...field,
          values: userVals,
        });
      } else if (!field.valuesByUser) {
        field.values.forEach((v) => {
          if (isCriticalToken(v, criticalSet)) hasCriticalValue = true;
        });
        userFields.push(field);
      }
    }

    if (userFields.length === 0 && obj.fields.length > 0) continue;

    projected.push({
      ...obj,
      users: [selectedUser],
      fields: userFields,
      hasCriticalContent: obj.isCriticalName || hasCriticalValue,
    });
  }

  return projected;
}

export function filterExtractedObjects(
  objects: ExtractedObject[],
  filterQuery: string,
  restrictToCritical: boolean
): ExtractedObject[] {
  const query = filterQuery.trim().toUpperCase();
  return objects.filter((obj) => {
    if (restrictToCritical && !obj.hasCriticalContent) return false;
    if (!query) return true;
    if (obj.name.includes(query)) return true;
    if (Array.isArray(obj.users) && obj.users.some((u) => u.toUpperCase().includes(query))) {
      return true;
    }
    return obj.fields.some(
      (f) =>
        f.name.includes(query) ||
        f.values.some((v) => v.toUpperCase().includes(query))
    );
  });
}

export function formatPlainSU53Output(filteredObjects: ExtractedObject[]): string {
  if (filteredObjects.length === 0) return '';

  return filteredObjects
    .map((obj) => {
      const lines = [obj.name];
      obj.fields.forEach((field) => {
        const formattedVals = field.values.length > 0 ? field.values.join(', ') : '(vazio)';
        lines.push(`  ${field.name}: ${formattedVals}`);
      });
      return lines.join('\n');
    })
    .join('\n\n');
}

export function parsePlainSU53OutputToObjects(
  plainText: string,
  previousObjects: ExtractedObject[],
  criticalSet: Set<string> = CRITICAL_ITEMS,
  defaultUser?: string
): ExtractedObject[] {
  const prevMap = new Map<string, ExtractedObject>();
  previousObjects.forEach((obj) => prevMap.set(obj.name, obj));

  const parsedMap = new Map<
    string,
    {
      fieldsMap: Map<string, Set<string>>;
    }
  >();

  let currentObjectName: string | null = null;
  const lines = plainText.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmedRight = rawLine.replace(/\s+$/, '');
    const trimmed = trimmedRight.trim();
    if (!trimmed) continue;

    const fieldMatch = trimmedRight.match(/^\s*([^:\s][^:]*?)\s*:\s*(.*)$/);
    if (fieldMatch && ( /^\s+/.test(rawLine) || currentObjectName !== null )) {
      // Verifica se parece uma linha de campo (não um cabeçalho de objeto sem ':')
      const fieldName = fieldMatch[1].trim().toUpperCase();
      const rawValues = fieldMatch[2].trim();
      if (currentObjectName && fieldName) {
        const objEntry = parsedMap.get(currentObjectName)!;
        if (!objEntry.fieldsMap.has(fieldName)) {
          objEntry.fieldsMap.set(fieldName, new Set());
        }
        const valSet = objEntry.fieldsMap.get(fieldName)!;
        if (rawValues && rawValues.toLowerCase() !== '(vazio)') {
          rawValues
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
            .forEach((v) => valSet.add(v));
        }
        continue;
      }
    }

    // Linha de cabeçalho de objeto (remove eventual sufixo [CRÍTICO] ou (USER))
    const cleanedObj = trimmed
      .replace(/\[CR[ÍI]TICO\]/gi, '')
      .replace(/\([^)]*\)\s*$/, '')
      .trim()
      .toUpperCase();

    if (!cleanedObj) continue;
    currentObjectName = cleanedObj;
    if (!parsedMap.has(cleanedObj)) {
      parsedMap.set(cleanedObj, { fieldsMap: new Map() });
    }
  }

  const nextObjects: ExtractedObject[] = [];
  for (const [objName, data] of parsedMap.entries()) {
    const prevObj = prevMap.get(objName);
    const users =
      prevObj && Array.isArray(prevObj.users) && prevObj.users.length > 0
        ? [...prevObj.users]
        : defaultUser && defaultUser !== 'ALL'
        ? [defaultUser]
        : [];

    const isCriticalName = isCriticalToken(objName, criticalSet);
    let hasCriticalValue = false;

    const fields: ExtractedField[] = Array.from(data.fieldsMap.entries()).map(
      ([fieldName, valsSet]) => {
        const values = Array.from(valsSet);
        values.forEach((v) => {
          if (isCriticalToken(v, criticalSet)) hasCriticalValue = true;
        });

        const prevField = prevObj?.fields.find((f) => f.name === fieldName);
        let valuesByUser: Record<string, string[]> | undefined;
        if (defaultUser && defaultUser !== 'ALL') {
          valuesByUser = {
            ...(prevField?.valuesByUser || {}),
            [defaultUser]: values,
          };
        } else if (prevField?.valuesByUser) {
          valuesByUser = Object.fromEntries(
            Object.keys(prevField.valuesByUser).map((u) => [u, values])
          );
        }

        return {
          name: fieldName,
          values,
          valuesByUser,
        };
      }
    );

    nextObjects.push({
      name: objName,
      fields,
      users,
      isCriticalName,
      hasCriticalContent: isCriticalName || hasCriticalValue,
    });
  }

  return nextObjects;
}

