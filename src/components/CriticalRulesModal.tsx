import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, ShieldAlert, Trash2, X } from 'lucide-react';
import {
  DEFAULT_CRITICAL_ITEMS,
  parseCriticalTokensInput,
} from '../utils/criticalRules';

interface CriticalRulesModalProps {
  isOpen: boolean;
  criticalItems: string[];
  onClose: () => void;
  onUpdateItems: (nextItems: string[]) => void;
}

export function CriticalRulesModal({
  isOpen,
  criticalItems,
  onClose,
  onUpdateItems,
}: CriticalRulesModalProps) {
  const [newTokenInput, setNewTokenInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAddTokens = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseCriticalTokensInput(newTokenInput);
    if (parsed.length === 0) return;
    const merged = Array.from(new Set([...parsed, ...criticalItems]));
    onUpdateItems(merged);
    setNewTokenInput('');
  };

  const handleRemoveToken = (token: string) => {
    onUpdateItems(criticalItems.filter((item) => item !== token));
  };

  const handleRestoreDefaults = () => {
    onUpdateItems([...DEFAULT_CRITICAL_ITEMS]);
  };

  const normalizedSearch = searchTerm.trim().toUpperCase();
  const visibleItems = normalizedSearch
    ? criticalItems.filter((item) => item.includes(normalizedSearch))
    : criticalItems;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="regras-criticas-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-slate-950/75 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-800/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900/70 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="regras-criticas-title" className="text-base font-semibold text-slate-900 dark:text-white">
                Objetos e Transações Críticas ({criticalItems.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Personalize a lista corporativa monitorada. As regras são salvas localmente no navegador.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configuração de regras críticas"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Formulário de adição */}
          <form onSubmit={handleAddTokens} className="space-y-2">
            <label
              htmlFor="new-critical-token"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              Adicionar objeto ou transação crítica
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="new-critical-token"
                type="text"
                value={newTokenInput}
                onChange={(e) => setNewTokenInput(e.target.value)}
                placeholder="Ex: S_TABU_NAM, S_RFC, SM30, SE38 (separe por vírgula ou espaço)"
                className="flex-1 min-h-[40px] px-3 py-2 text-xs sm:text-sm font-mono uppercase bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:border-sap-500 focus:ring-2 focus:ring-sap-500/20"
              />
              <button
                type="submit"
                disabled={parseCriticalTokensInput(newTokenInput).length === 0}
                className="min-h-[40px] px-4 py-2 bg-sap-500 hover:bg-sap-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Adicionar</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Dica: você pode colar múltiplos códigos separados por vírgula, ponto e vírgula ou espaço.
            </p>
          </form>

          {/* Filtro rápido da lista */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Itens ativos no monitoramento ({visibleItems.length})
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar na lista..."
                aria-label="Buscar objeto ou transação na lista crítica"
                className="min-h-[34px] px-3 py-1 text-xs font-mono bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-sap-500"
              />
            </div>

            {visibleItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl">
                {criticalItems.length === 0
                  ? 'Nenhum item crítico configurado. Adicione novos itens acima ou restaure o padrão.'
                  : 'Nenhum item encontrado para o filtro digitado.'}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap gap-2">
                {visibleItems.map((token) => {
                  const isDefault = DEFAULT_CRITICAL_ITEMS.includes(token);
                  return (
                    <span
                      key={token}
                      className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md text-xs font-mono font-semibold border ${
                        isDefault
                          ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                          : 'bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border-red-200 dark:border-red-900/70'
                      }`}
                    >
                      <span>{token}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveToken(token)}
                        aria-label={`Remover ${token} da lista crítica`}
                        title={`Remover ${token}`}
                        className="p-0.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100/70 dark:hover:bg-red-950/80 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/70 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRestoreDefaults}
              className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-sap-700 dark:hover:text-sky-400 inline-flex items-center gap-1.5 hover:underline underline-offset-2"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Restaurar padrão ({DEFAULT_CRITICAL_ITEMS.length})</span>
            </button>
            {criticalItems.length > 0 && (
              <button
                type="button"
                onClick={() => onUpdateItems([])}
                className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 inline-flex items-center gap-1 hover:underline underline-offset-2"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Limpar tudo</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 py-1.5 bg-sap-500 hover:bg-sap-600 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
