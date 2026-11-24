import { useEffect } from 'react';
import { Clock, Download, RotateCcw, Trash2, X } from 'lucide-react';
import { BatchExtractionResult } from '../types/su53';

export interface SavedExtractionSession {
  id: string;
  createdAt: string;
  fileNames: string[];
  result: BatchExtractionResult;
}

interface SessionHistoryModalProps {
  isOpen: boolean;
  sessions: SavedExtractionSession[];
  onClose: () => void;
  onRestoreSession: (session: SavedExtractionSession) => void;
  onDeleteSession: (id: string) => void;
  onClearHistory: () => void;
  onExportHistory: () => void;
}

export function SessionHistoryModal({
  isOpen,
  sessions,
  onClose,
  onRestoreSession,
  onDeleteSession,
  onClearHistory,
  onExportHistory,
}: SessionHistoryModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="historico-sessoes-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-slate-950/75 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-800/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="historico-sessoes-title" className="text-base font-semibold text-slate-900 dark:text-white">
                Histórico de Sessões Locais
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extrações recentes salvas localmente no navegador para reabertura rápida.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Nenhuma sessão salva ainda
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Após executar uma extração, o resultado consolidado ficará disponível aqui para consulta posterior.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="p-4 bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {session.result.metadata.user}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono text-slate-600 dark:text-slate-300">
                        {session.result.metadata.sys}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                      <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {new Date(session.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={session.fileNames.join(', ')}>
                      {session.result.metadata.objectCount} objeto(s) · {session.result.metadata.rowLabel} · {session.fileNames.join(', ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onRestoreSession(session)}
                      className="min-h-[36px] px-3 py-1.5 bg-sap-500 hover:bg-sap-600 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Abrir</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      aria-label="Excluir sessão do histórico"
                      className="min-h-[36px] p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/70 flex flex-wrap items-center justify-between gap-3">
          {sessions.length > 0 ? (
            <button
              type="button"
              onClick={onClearHistory}
              className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:underline underline-offset-2"
            >
              Limpar histórico local
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportHistory}
              disabled={sessions.length === 0}
              title="Baixar histórico completo como arquivo JSON para backup"
              className="min-h-[38px] px-4 py-1.5 bg-sap-500 hover:bg-sap-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-xs transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Exportar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] px-4 py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold rounded-lg transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
