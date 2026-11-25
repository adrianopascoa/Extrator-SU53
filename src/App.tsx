import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Clock, Moon, ShieldCheck, SlidersHorizontal, Sun } from 'lucide-react';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ResultWorkspace } from './components/ResultWorkspace';
import type { SavedExtractionSession } from './components/SessionHistoryModal';
import { ToastStack } from './components/ToastStack';
import { UploadQueueSection } from './components/UploadQueueSection';
import {
  BatchExtractionResult,
  ExtractedField,
  ExtractedObject,
  LoadedFile,
  OutputViewMode,
  ToastItem,
} from './types/su53';
import { loadCriticalItems, saveCriticalItems } from './utils/criticalRules';

const CriticalRulesModal = lazy(() =>
  import('./components/CriticalRulesModal').then((m) => ({
    default: m.CriticalRulesModal,
  }))
);
const SessionHistoryModal = lazy(() =>
  import('./components/SessionHistoryModal').then((m) => ({
    default: m.SessionHistoryModal,
  }))
);
const Su53GuideModal = lazy(() =>
  import('./components/Su53GuideModal').then((m) => ({
    default: m.Su53GuideModal,
  }))
);
import {
  buildCriticalSet,
  extractSU53FromBatch,
  filterExtractedObjects,
  parsePlainSU53OutputToObjects,
  projectObjectsForUser,
  reapplyCriticalRules,
  UNIDENTIFIED_USER,
} from './utils/su53Parser';

const VALID_HTML_EXTS = ['.html', '.htm'];
const VALID_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
const VALID_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/gif',
]);
const VALID_PDF_EXTS = ['.pdf'];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const HISTORY_STORAGE_KEY = 'sap_su53_local_sessions_v1';
const THEME_STORAGE_KEY = 'sap_su53_theme_v1';
const MAX_SAVED_SESSIONS = 8;

type ThemeMode = 'light' | 'dark';

function loadInitialTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (document.documentElement.classList.contains('dark')) return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

function detectFileKind(file: File): 'html' | 'image' | 'pdf' | null {
  const lowerName = file.name.toLowerCase();
  const normalizedType = file.type.toLowerCase();
  if (
    VALID_HTML_EXTS.some((ext) => lowerName.endsWith(ext)) ||
    normalizedType === 'text/html'
  ) {
    return 'html';
  }
  if (
    normalizedType === 'application/pdf' ||
    VALID_PDF_EXTS.some((ext) => lowerName.endsWith(ext))
  ) {
    return 'pdf';
  }
  if (
    VALID_IMAGE_MIME_TYPES.has(normalizedType) ||
    (!normalizedType && VALID_IMAGE_EXTS.some((ext) => lowerName.endsWith(ext)))
  ) {
    return 'image';
  }
  return null;
}

function inferImageMimeType(file: File): string {
  const normalizedType = file.type.toLowerCase();
  if (VALID_IMAGE_MIME_TYPES.has(normalizedType)) {
    return normalizedType === 'image/jpg' ? 'image/jpeg' : normalizedType;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

function isValidSavedSession(entry: unknown): entry is SavedExtractionSession {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as Partial<SavedExtractionSession>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    !Array.isArray(candidate.fileNames) ||
    !candidate.result ||
    typeof candidate.result !== 'object'
  ) {
    return false;
  }
  const res = candidate.result as Partial<BatchExtractionResult>;
  return (
    Array.isArray(res.objects) &&
    Array.isArray(res.detectedCriticals) &&
    !!res.metadata &&
    typeof res.metadata === 'object'
  );
}

function loadSavedSessions(): SavedExtractionSession[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSavedSession).slice(0, MAX_SAVED_SESSIONS);
  } catch {
    return [];
  }
}

function decodeHtmlArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  // Lê os primeiros 4 KB em latin1 para checar declaração <meta charset=...>
  const headProbe = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, 4096));
  const metaMatch = headProbe.match(
    /<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)\s*["']?/i
  );
  const declaredCharset = metaMatch?.[1]?.trim().toLowerCase();

  if (
    declaredCharset &&
    declaredCharset !== 'utf-8' &&
    declaredCharset !== 'utf8'
  ) {
    try {
      return new TextDecoder(declaredCharset).decode(bytes);
    } catch {
      // Continua para tentativa UTF-8 estrito + fallback ISO-8859-1
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
}

export default function App() {
  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractionResult, setExtractionResult] =
    useState<BatchExtractionResult | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [filterQuery, setFilterQuery] = useState('');
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [viewMode, setViewMode] = useState<OutputViewMode>('console');
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [activeNav, setActiveNav] = useState<'importacao' | 'resumo' | 'log-consolidado'>('importacao');
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCriticalRulesOpen, setIsCriticalRulesOpen] = useState(false);
  const [criticalItems, setCriticalItems] = useState<string[]>(() => loadCriticalItems());
  const [sessions, setSessions] = useState<SavedExtractionSession[]>(() => loadSavedSessions());
  const [theme, setTheme] = useState<ThemeMode>(() => loadInitialTheme());
  const resultsAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', isDark ? '#0f172a' : '#0070f2');
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignora erro caso localStorage esteja bloqueado
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const persistSessions = useCallback((next: SavedExtractionSession[]) => {
    setSessions(next);
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignora erro caso localStorage esteja bloqueado/cheio
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, message, type }]);
      window.setTimeout(() => {
        dismissToast(id);
      }, 3500);
    },
    [dismissToast]
  );

  const upsertQueueFile = useCallback((entry: LoadedFile) => {
    setLoadedFiles((prev) => {
      const existsIdx = prev.findIndex(
        (f) => f.name === entry.name && f.size === entry.size && f.kind === entry.kind
      );
      if (existsIdx !== -1) {
        const updated = [...prev];
        updated[existsIdx] = entry;
        return updated;
      }
      return [...prev, entry];
    });
  }, []);

  const handleAddFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      let validCount = 0;
      let invalidCount = 0;
      let oversizedCount = 0;

      files.forEach((file) => {
        const kind = detectFileKind(file);
        if (!kind) {
          invalidCount++;
          return;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          oversizedCount++;
          return;
        }

        validCount++;
        const reader = new FileReader();

        if (kind === 'html') {
          reader.onload = (e) => {
            const buffer =
              e.target?.result instanceof ArrayBuffer ? e.target.result : null;
            const content = buffer ? decodeHtmlArrayBuffer(buffer) : '';
            upsertQueueFile({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              name: file.name,
              size: file.size,
              kind: 'html',
              content,
            });
          };
          reader.onerror = () => {
            showToast(`Erro ao ler o arquivo "${file.name}".`, 'error');
          };
          reader.readAsArrayBuffer(file);
        } else if (kind === 'pdf') {
          void import('./utils/su53PdfExtractor');
          void import('./utils/su53ImageOcr').then((m) => m.warmUpOcrWorker());
          reader.onload = (e) => {
            const pdfData =
              e.target?.result instanceof ArrayBuffer ? e.target.result : undefined;
            if (!pdfData) {
              showToast(`Erro ao ler o PDF "${file.name}".`, 'error');
              return;
            }
            upsertQueueFile({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              name: file.name,
              size: file.size,
              kind: 'pdf',
              pdfData,
            });
          };
          reader.onerror = () => {
            showToast(`Erro ao ler o PDF "${file.name}".`, 'error');
          };
          reader.readAsArrayBuffer(file);
        } else {
          void import('./utils/su53ImageOcr').then((m) => m.warmUpOcrWorker());
          reader.onload = (e) => {
            const dataUrl =
              typeof e.target?.result === 'string' ? e.target.result : '';
            const originalMime = inferImageMimeType(file);
            const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
            upsertQueueFile({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              name: file.name,
              size: file.size,
              kind: 'image',
              mimeType: originalMime,
              base64: rawBase64,
              previewUrl: dataUrl,
            });
          };
          reader.onerror = () => {
            showToast(`Erro ao ler a imagem "${file.name}".`, 'error');
          };
          reader.readAsDataURL(file);
        }
      });

      if (oversizedCount > 0 && validCount === 0 && invalidCount === 0) {
        showToast('Arquivo excede o limite de 25 MB por item para processamento local.', 'error');
      } else if (invalidCount > 0 && validCount === 0) {
        showToast(
          'Por favor, selecione arquivos HTML (.HTML/.HTM), PDF (.PDF) ou imagens (.PNG, .JPG, .WEBP).',
          'error'
        );
      } else if (invalidCount > 0 || oversizedCount > 0) {
        showToast(
          `${validCount} arquivo(s) adicionado(s). ${invalidCount + oversizedCount} arquivo(s) ignorado(s) por formato inválido ou tamanho acima de 25 MB.`
        );
      } else if (validCount > 0) {
        showToast(`${validCount} arquivo(s) adicionado(s) à fila.`);
      }
    },
    [showToast, upsertQueueFile]
  );

  // Permite colar capturas de tela (Ctrl+V) diretamente na janela
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedImages: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const ext = item.type.split('/')[1] || 'png';
            const timestamp = new Date()
              .toISOString()
              .replace(/[:.]/g, '-')
              .slice(0, 19);
            const namedFile = new File(
              [blob],
              `print_su53_${timestamp}.${ext}`,
              { type: item.type }
            );
            pastedImages.push(namedFile);
          }
        }
      }

      if (pastedImages.length > 0) {
        e.preventDefault();
        handleAddFiles(pastedImages);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleAddFiles]);

  const handleRemoveFile = useCallback((id: string) => {
    setLoadedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleClearAll = useCallback(() => {
    setLoadedFiles([]);
    setExtractionResult(null);
    setSelectedUser('ALL');
    setFilterQuery('');
    setOnlyCritical(false);
    setHasManualEdits(false);
    setActiveNav('importacao');
  }, []);

  const runExtractionOnFiles = useCallback(
    async (filesToProcess: LoadedFile[]) => {
      if (filesToProcess.length === 0) {
        showToast('Por favor, carregue pelo menos um arquivo HTML, PDF ou imagem.', 'error');
        return;
      }

      setIsProcessing(true);
      try {
        const result = await extractSU53FromBatch(filesToProcess, criticalItems);
        setExtractionResult(result);
        setSelectedUser('ALL');
        setFilterQuery('');
        setOnlyCritical(false);
        setHasManualEdits(false);
        setActiveNav('log-consolidado');

        const newSession: SavedExtractionSession = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date().toISOString(),
          fileNames: filesToProcess.map((f) => f.name),
          result,
        };
        persistSessions([newSession, ...sessions].slice(0, MAX_SAVED_SESSIONS));

        const msgLote =
          filesToProcess.length > 1
            ? ` a partir de ${filesToProcess.length} arquivos`
            : '';
        showToast(
          `${result.metadata.objectCount} objeto(s) consolidado(s)${msgLote}.`
        );

        window.requestAnimationFrame(() => {
          resultsAnchorRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Erro ao processar os arquivos selecionados.';
        showToast(message, 'error');
      } finally {
        setIsProcessing(false);
      }
    },
    [criticalItems, persistSessions, sessions, showToast]
  );

  const handleExecute = useCallback(() => {
    void runExtractionOnFiles(loadedFiles);
  }, [loadedFiles, runExtractionOnFiles]);

  const handleUpdateCriticalItems = useCallback(
    (nextItems: string[]) => {
      const saved = saveCriticalItems(nextItems);
      setCriticalItems(saved);
      setExtractionResult((prev) =>
        prev ? reapplyCriticalRules(prev, saved) : prev
      );
    },
    []
  );

  // Handlers de revisão/edição inline pós-OCR
  const handleUpdateObjectName = useCallback(
    (oldName: string, newName: string) => {
      const cleanedNew = newName.trim().toUpperCase();
      if (!cleanedNew || cleanedNew === oldName) return;

      setExtractionResult((prev) => {
        if (!prev) return prev;
        const sourceObj = prev.objects.find((o) => o.name === oldName);
        if (!sourceObj) return prev;

        const targetObj = prev.objects.find((o) => o.name === cleanedNew);
        let nextObjects: ExtractedObject[];

        if (targetObj) {
          // Mescla campos e usuários caso o nome editado coincida com outro objeto existente
          const mergedFieldsMap = new Map<string, ExtractedField>();
          targetObj.fields.forEach((f) =>
            mergedFieldsMap.set(f.name, {
              ...f,
              values: [...f.values],
              valuesByUser: f.valuesByUser ? { ...f.valuesByUser } : undefined,
            })
          );

          sourceObj.fields.forEach((f) => {
            const existing = mergedFieldsMap.get(f.name);
            if (!existing) {
              mergedFieldsMap.set(f.name, {
                ...f,
                values: [...f.values],
                valuesByUser: f.valuesByUser ? { ...f.valuesByUser } : undefined,
              });
            } else {
              existing.values = Array.from(new Set([...existing.values, ...f.values]));
              if (existing.valuesByUser || f.valuesByUser) {
                const combinedByUser: Record<string, string[]> = {
                  ...(existing.valuesByUser || {}),
                };
                if (f.valuesByUser) {
                  for (const [u, vals] of Object.entries(f.valuesByUser)) {
                    combinedByUser[u] = Array.from(
                      new Set([...(combinedByUser[u] || []), ...vals])
                    );
                  }
                }
                existing.valuesByUser = combinedByUser;
              }
            }
          });

          const mergedUsers = Array.from(
            new Set([...(targetObj.users || []), ...(sourceObj.users || [])])
          );

          nextObjects = prev.objects
            .filter((o) => o.name !== oldName)
            .map((o) =>
              o.name === cleanedNew
                ? {
                    ...o,
                    users: mergedUsers,
                    fields: Array.from(mergedFieldsMap.values()),
                  }
                : o
            );
        } else {
          nextObjects = prev.objects.map((o) =>
            o.name === oldName ? { ...o, name: cleanedNew } : o
          );
        }

        return reapplyCriticalRules({ ...prev, objects: nextObjects }, criticalItems);
      });

      setHasManualEdits(true);
      showToast(`Objeto atualizado para ${cleanedNew}.`);
    },
    [criticalItems, showToast]
  );

  const handleUpdateObjectUsers = useCallback(
    (objectName: string, newUsers: string[]) => {
      const cleanedUsers = Array.from(
        new Set(
          newUsers
            .map((u) => {
              const trimmed = u.trim();
              if (!trimmed) return '';
              return trimmed.toLowerCase() === UNIDENTIFIED_USER.toLowerCase()
                ? UNIDENTIFIED_USER
                : trimmed.toUpperCase();
            })
            .filter(Boolean)
        )
      );
      if (cleanedUsers.length === 0) return;

      setExtractionResult((prev) => {
        if (!prev) return prev;
        const nextObjects = prev.objects.map((obj) => {
          if (obj.name !== objectName) return obj;
          const updatedFields = obj.fields.map((f) => {
            const nextByUser: Record<string, string[]> = {};
            cleanedUsers.forEach((u) => {
              nextByUser[u] =
                f.valuesByUser && Array.isArray(f.valuesByUser[u])
                  ? f.valuesByUser[u]
                  : [...f.values];
            });
            return {
              ...f,
              valuesByUser: nextByUser,
            };
          });
          return {
            ...obj,
            users: cleanedUsers,
            fields: updatedFields,
          };
        });

        return reapplyCriticalRules({ ...prev, objects: nextObjects }, criticalItems);
      });

      setHasManualEdits(true);
      showToast(`Usuário(s) de ${objectName} atualizado(s).`);
    },
    [criticalItems, showToast]
  );

  const handleUpdateFieldName = useCallback(
    (objectName: string, oldFieldName: string, newFieldName: string) => {
      const cleanedNew = newFieldName.trim().toUpperCase();
      if (!cleanedNew || cleanedNew === oldFieldName) return;

      setExtractionResult((prev) => {
        if (!prev) return prev;
        const nextObjects = prev.objects.map((obj) => {
          if (obj.name !== objectName) return obj;

          const sourceField = obj.fields.find((f) => f.name === oldFieldName);
          if (!sourceField) return obj;

          const targetField = obj.fields.find((f) => f.name === cleanedNew);
          if (targetField) {
            const mergedFields = obj.fields
              .filter((f) => f.name !== oldFieldName)
              .map((f) =>
                f.name === cleanedNew
                  ? {
                      ...f,
                      values: Array.from(new Set([...f.values, ...sourceField.values])),
                    }
                  : f
              );
            return { ...obj, fields: mergedFields };
          }

          return {
            ...obj,
            fields: obj.fields.map((f) =>
              f.name === oldFieldName ? { ...f, name: cleanedNew } : f
            ),
          };
        });

        return reapplyCriticalRules({ ...prev, objects: nextObjects }, criticalItems);
      });

      setHasManualEdits(true);
      showToast(`Campo atualizado para ${cleanedNew}.`);
    },
    [criticalItems, showToast]
  );

  const handleUpdateFieldValues = useCallback(
    (objectName: string, fieldName: string, newValues: string[]) => {
      setExtractionResult((prev) => {
        if (!prev) return prev;
        const nextObjects = prev.objects.map((obj) => {
          if (obj.name !== objectName) return obj;
          return {
            ...obj,
            fields: obj.fields.map((f) => {
              if (f.name !== fieldName) return f;

              if (selectedUser !== 'ALL' && f.valuesByUser) {
                const nextByUser = {
                  ...f.valuesByUser,
                  [selectedUser]: newValues,
                };
                const unionValues = Array.from(
                  new Set(Object.values(nextByUser).flat())
                );
                return {
                  ...f,
                  values: unionValues,
                  valuesByUser: nextByUser,
                };
              }

              // Atualização global: sincroniza valuesByUser para manter consistência ao filtrar
              const nextByUser: Record<string, string[]> | undefined = f.valuesByUser
                ? Object.fromEntries(
                    Object.keys(f.valuesByUser).map((u) => [u, newValues])
                  )
                : undefined;

              return {
                ...f,
                values: newValues,
                valuesByUser: nextByUser,
              };
            }),
          };
        });

        return reapplyCriticalRules({ ...prev, objects: nextObjects }, criticalItems);
      });

      setHasManualEdits(true);
      showToast(`Valores de ${objectName} (${fieldName}) atualizados.`);
    },
    [criticalItems, selectedUser, showToast]
  );

  const handleDeleteField = useCallback(
    (objectName: string, fieldName: string) => {
      setExtractionResult((prev) => {
        if (!prev) return prev;
        const nextObjects = prev.objects
          .map((obj) => {
            if (obj.name !== objectName) return obj;
            return {
              ...obj,
              fields: obj.fields.filter((f) => f.name !== fieldName),
            };
          })
          .filter((obj) => obj.fields.length > 0);

        return reapplyCriticalRules({ ...prev, objects: nextObjects }, criticalItems);
      });

      setHasManualEdits(true);
      showToast(`Linha ${objectName} · ${fieldName} removida.`);
    },
    [criticalItems, showToast]
  );

  const handleApplyConsoleEdit = useCallback(
    (plainText: string, scopedUser: string) => {
      const criticalSet = buildCriticalSet(criticalItems);
      setExtractionResult((prev) => {
        if (!prev) return prev;
        const parsedObjects = parsePlainSU53OutputToObjects(
          plainText,
          prev.objects,
          criticalSet,
          scopedUser
        );

        const isFullUnfiltered =
          scopedUser === 'ALL' && !filterQuery.trim() && !onlyCritical;

        let nextObjects: ExtractedObject[];
        if (isFullUnfiltered) {
          nextObjects = parsedObjects;
        } else {
          const userScoped = projectObjectsForUser(
            prev.objects,
            scopedUser,
            criticalSet
          );
          const visibleBeforeEdit = filterExtractedObjects(
            userScoped,
            filterQuery,
            onlyCritical
          );
          const visibleNames = new Set(visibleBeforeEdit.map((o) => o.name));
          const parsedByName = new Map(parsedObjects.map((o) => [o.name, o]));

          const preserved = prev.objects.filter((o) => {
            if (!visibleNames.has(o.name)) return true;
            // Se era multi-usuário e editou só um usuário, mantém os dados dos outros usuários
            if (scopedUser !== 'ALL' && o.users.length > 1) return true;
            return false;
          });

          const mergedPreserved = preserved.map((obj) => {
            if (scopedUser !== 'ALL' && visibleNames.has(obj.name)) {
              const editedForUser = parsedByName.get(obj.name);
              if (!editedForUser) {
                const remainingUsers = obj.users.filter((u) => u !== scopedUser);
                const updatedFields = obj.fields
                  .map((f) => {
                    if (!f.valuesByUser) return f;
                    const rest = { ...f.valuesByUser };
                    delete rest[scopedUser];
                    return {
                      ...f,
                      valuesByUser: rest,
                      values: Array.from(new Set(Object.values(rest).flat())),
                    };
                  })
                  .filter((f) => f.values.length > 0 || !f.valuesByUser);
                return { ...obj, users: remainingUsers, fields: updatedFields };
              }
              parsedByName.delete(obj.name);
              const fieldsMap = new Map<string, ExtractedField>();
              obj.fields.forEach((f) => {
                const restByUser = f.valuesByUser ? { ...f.valuesByUser } : {};
                delete restByUser[scopedUser];
                fieldsMap.set(f.name, {
                  ...f,
                  valuesByUser: restByUser,
                  values: Array.from(new Set(Object.values(restByUser).flat())),
                });
              });
              editedForUser.fields.forEach((ef) => {
                const existing = fieldsMap.get(ef.name);
                if (existing) {
                  const nextByUser = {
                    ...(existing.valuesByUser || {}),
                    [scopedUser]: ef.values,
                  };
                  fieldsMap.set(ef.name, {
                    ...existing,
                    valuesByUser: nextByUser,
                    values: Array.from(new Set(Object.values(nextByUser).flat())),
                  });
                } else {
                  fieldsMap.set(ef.name, ef);
                }
              });
              return {
                ...obj,
                fields: Array.from(fieldsMap.values()).filter(
                  (f) => f.values.length > 0
                ),
              };
            }
            return obj;
          });

          nextObjects = [...mergedPreserved, ...Array.from(parsedByName.values())];
        }

        return reapplyCriticalRules({ ...prev, objects: nextObjects }, criticalItems);
      });

      setHasManualEdits(true);
      showToast('Texto do console atualizado.');
    },
    [criticalItems, filterQuery, onlyCritical, showToast]
  );

  const handleCopy = useCallback(
    async (plainText: string) => {
      if (!plainText) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(plainText);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = plainText;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        showToast('Log copiado para a área de transferência.');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = plainText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Log copiado para a área de transferência.');
      }
    },
    [showToast]
  );

  const handleDownload = useCallback(
    (plainText: string) => {
      if (!plainText) return;
      const userSuffix = selectedUser !== 'ALL' ? `_${selectedUser}` : '';
      const downloadName =
        loadedFiles.length === 1
          ? `${loadedFiles[0].name.replace(/\.[^/.]+$/, '')}${userSuffix}_extraido.txt`
          : loadedFiles.length > 1
          ? `su53_lote_${loadedFiles.length}_arquivos${userSuffix}.txt`
          : `log_su53_consolidado${userSuffix}.txt`;

      const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Download do arquivo .TXT iniciado.');
    },
    [loadedFiles, selectedUser, showToast]
  );

  const handleExportExcel = useCallback(
    async (filteredObjects: ExtractedObject[]) => {
      if (!extractionResult || filteredObjects.length === 0) return;

      const userSuffix = selectedUser !== 'ALL' ? `_${selectedUser}` : '';
      const downloadName =
        loadedFiles.length === 1
          ? `${loadedFiles[0].name.replace(/\.[^/.]+$/, '')}${userSuffix}_extraido.xlsx`
          : loadedFiles.length > 1
          ? `su53_lote_${loadedFiles.length}_arquivos${userSuffix}.xlsx`
          : `log_su53_consolidado${userSuffix}.xlsx`;

      try {
        const { buildAndDownloadSU53Excel } = await import(
          './utils/su53ExcelExport'
        );
        buildAndDownloadSU53Excel(
          filteredObjects,
          extractionResult.metadata,
          extractionResult.detectedCriticals,
          downloadName,
          criticalItems,
          selectedUser
        );
        showToast('Planilha Excel (.XLSX) gerada e download iniciado.');
      } catch {
        showToast('Erro ao gerar a planilha Excel.', 'error');
      }
    },
    [criticalItems, extractionResult, loadedFiles, selectedUser, showToast]
  );

  const handleRestoreSession = useCallback(
    (session: SavedExtractionSession) => {
      setExtractionResult(reapplyCriticalRules(session.result, criticalItems));
      setSelectedUser('ALL');
      setFilterQuery('');
      setOnlyCritical(false);
      setHasManualEdits(false);
      setIsHistoryOpen(false);
      setActiveNav('log-consolidado');
      showToast('Sessão restaurada com sucesso.');
      window.requestAnimationFrame(() => {
        resultsAnchorRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    },
    [criticalItems, showToast]
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      persistSessions(sessions.filter((s) => s.id !== id));
    },
    [persistSessions, sessions]
  );

  const handleClearHistory = useCallback(() => {
    persistSessions([]);
    showToast('Histórico local limpo.');
  }, [persistSessions, showToast]);

  const handleExportHistory = useCallback(() => {
    if (sessions.length === 0) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      sessionCount: sessions.length,
      sessions,
    };
    const dateStamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `su53_historico_backup_${dateStamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast('Backup do histórico exportado com sucesso.');
  }, [sessions, showToast]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 transition-colors duration-200">
      {/* Top Bar — Contrato de 3 zonas limpo */}
      <header className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200/90 dark:border-slate-800 sticky top-0 z-20 transition-colors duration-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 sm:gap-8">
          <a
            href="#top"
            onClick={() => setActiveNav('importacao')}
            className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            <img
              src="/assets/aistudio/SAP_Logo_-_Colored_-_32x32_3644d71f.png"
              alt="SAP"
              className="h-8 w-8 object-contain shrink-0"
            />
            <span>
              Extrator <span className="text-sap-600 dark:text-sky-400">SU53</span>
            </span>
          </a>

          <nav
            aria-label="Navegação principal"
            className="hidden md:flex items-center p-1 bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            <a
              href="#importacao"
              onClick={() => setActiveNav('importacao')}
              className={`px-3.5 py-1.5 rounded-full transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'importacao'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                  : 'hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Importação
            </a>
            <a
              href="#resumo"
              onClick={() => setActiveNav('resumo')}
              className={`px-3.5 py-1.5 rounded-full transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'resumo'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                  : 'hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Resumo
            </a>
            <a
              href="#log-consolidado"
              onClick={() => setActiveNav('log-consolidado')}
              className={`px-3.5 py-1.5 rounded-full transition-colors whitespace-nowrap shrink-0 ${
                activeNav === 'log-consolidado'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                  : 'hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Log Consolidado
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              title={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              aria-pressed={theme === 'dark'}
              className="min-h-[38px] px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700 shadow-2xs text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
            >
              {theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {theme === 'dark' ? 'Claro' : 'Escuro'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsGuideOpen(true)}
              className="min-h-[38px] px-3.5 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700 shadow-2xs text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
            >
              <BookOpen className="w-3.5 h-3.5 text-sap-600 dark:text-sky-400" aria-hidden="true" />
              <span>Guia SU53</span>
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main
        id="top"
        className="flex-grow max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-1">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-sap-700 dark:text-sky-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-sap-600 dark:text-sky-400" aria-hidden="true" />
                <span>Enterprise Security &amp; Audit</span>
              </span>
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
              Consolidador de Logs de Autorização SU53
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>HTML GUI, PDF &amp; Prints de Tela</span>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
              <span>Auditoria de Objetos Críticos</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-end shrink-0">
            <button
              type="button"
              onClick={() => setIsCriticalRulesOpen(true)}
              className="min-h-[40px] px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-800 shadow-2xs text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <span>Regras Críticas ({criticalItems.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="min-h-[40px] px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-800 shadow-2xs text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
            >
              <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <span>
                Histórico de Sessões{sessions.length > 0 ? ` (${sessions.length})` : ''}
              </span>
            </button>
          </div>
        </div>

        <UploadQueueSection
          loadedFiles={loadedFiles}
          isProcessing={isProcessing}
          onAddFiles={handleAddFiles}
          onRemoveFile={handleRemoveFile}
          onClearAll={handleClearAll}
          onExecute={handleExecute}
        />

        <div ref={resultsAnchorRef} className="scroll-mt-20">
          <ResultWorkspace
            result={extractionResult}
            criticalItems={criticalItems}
            selectedUser={selectedUser}
            filterQuery={filterQuery}
            onlyCritical={onlyCritical}
            viewMode={viewMode}
            hasManualEdits={hasManualEdits}
            onSelectedUserChange={setSelectedUser}
            onFilterQueryChange={setFilterQuery}
            onToggleOnlyCritical={() => setOnlyCritical((prev) => !prev)}
            onViewModeChange={setViewMode}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onExportExcel={handleExportExcel}
            onOpenCriticalRules={() => setIsCriticalRulesOpen(true)}
            onUpdateObjectName={handleUpdateObjectName}
            onUpdateObjectUsers={handleUpdateObjectUsers}
            onUpdateFieldName={handleUpdateFieldName}
            onUpdateFieldValues={handleUpdateFieldValues}
            onDeleteField={handleDeleteField}
            onApplyConsoleEdit={handleApplyConsoleEdit}
          />
        </div>
      </main>

      {/* Rodapé */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-5 mt-auto transition-colors duration-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Ferramenta para Analistas SAP Basis &amp; Segurança</span>
          <span>Processamento 100% local no navegador (HTML, PDF e OCR offline sem uso de API externa)</span>
        </div>
      </footer>

      <Suspense fallback={null}>
        {isGuideOpen && (
          <Su53GuideModal
            isOpen={isGuideOpen}
            criticalItems={criticalItems}
            onClose={() => setIsGuideOpen(false)}
            onOpenCriticalRules={() => setIsCriticalRulesOpen(true)}
          />
        )}
        {isCriticalRulesOpen && (
          <CriticalRulesModal
            isOpen={isCriticalRulesOpen}
            criticalItems={criticalItems}
            onClose={() => setIsCriticalRulesOpen(false)}
            onUpdateItems={handleUpdateCriticalItems}
          />
        )}
        {isHistoryOpen && (
          <SessionHistoryModal
            isOpen={isHistoryOpen}
            sessions={sessions}
            onClose={() => setIsHistoryOpen(false)}
            onRestoreSession={handleRestoreSession}
            onDeleteSession={handleDeleteSession}
            onClearHistory={handleClearHistory}
            onExportHistory={handleExportHistory}
          />
        )}
      </Suspense>

      <OfflineIndicator />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
