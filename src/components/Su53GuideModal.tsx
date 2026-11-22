import { useEffect } from 'react';
import { BookOpen, FileCode2, FileText, Image as ImageIcon, ShieldAlert, X } from 'lucide-react';

interface Su53GuideModalProps {
  isOpen: boolean;
  criticalItems: string[];
  onClose: () => void;
  onOpenCriticalRules?: () => void;
}

export function Su53GuideModal({
  isOpen,
  criticalItems,
  onClose,
  onOpenCriticalRules,
}: Su53GuideModalProps) {
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
      aria-labelledby="guia-su53-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sap-50 border border-sap-100 text-sap-600 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="guia-su53-title" className="text-base font-semibold text-slate-900">
                Guia Rápido — Extração SAP SU53
              </h2>
              <p className="text-xs text-slate-500">
                Boas práticas para exportar relatórios HTML, PDF ou capturar telas com máxima precisão.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar guia"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-sap-600" aria-hidden="true" />
              <span>1. Exportar relatório HTML pelo SAP GUI</span>
            </h3>
            <p className="text-xs sm:text-sm leading-relaxed">
              Na transação <span className="font-mono font-semibold text-slate-800">SU53</span>, acesse o menu{' '}
              <span className="font-medium text-slate-800">Lista → Gravar/Enviar → Arquivo local</span> e escolha o formato{' '}
              <span className="font-mono font-semibold text-slate-800">HTML</span>. Você pode enviar vários arquivos de uma só vez para consolidação automática por usuário e sem duplicidades.
            </p>
          </div>

          <div className="border-t border-slate-200 pt-5 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-sap-600" aria-hidden="true" />
              <span>2. Capturas de tela (Print + OCR local)</span>
            </h3>
            <p className="text-xs sm:text-sm leading-relaxed">
              Caso tenha apenas o print da tela da SU53, copie a imagem e pressione{' '}
              <kbd className="font-mono text-xs px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded">Ctrl+V</kbd>{' '}
              em qualquer ponto da janela ou selecione arquivos <span className="font-mono text-xs">.PNG / .JPG / .WEBP</span>. O OCR roda 100% no seu navegador com dicionário local e alinhamento geométrico das colunas <span className="font-mono text-xs">Objeto · Campo · Valor</span>.
            </p>
          </div>

          <div className="border-t border-slate-200 pt-5 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-sap-600" aria-hidden="true" />
              <span>3. Documentos PDF (texto ou print embutido)</span>
            </h3>
            <p className="text-xs sm:text-sm leading-relaxed">
              Anexos <span className="font-mono text-xs font-semibold text-slate-800">.PDF</span> de chamados são lidos diretamente no navegador: se o PDF contiver texto selecionável, a leitura é exata e instantânea; se for apenas uma imagem/print colado no PDF, cada página é convertida automaticamente para o OCR local.
            </p>
          </div>

          <div className="border-t border-slate-200 pt-5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600" aria-hidden="true" />
                <span>4. Transações e objetos críticos monitorados ({criticalItems.length})</span>
              </h3>
              {onOpenCriticalRules && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCriticalRules();
                  }}
                  className="text-xs font-semibold text-sap-600 hover:text-sap-700 hover:underline underline-offset-2"
                >
                  Personalizar lista
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Qualquer ocorrência abaixo gera alerta automático e permite filtragem imediata no log consolidado:
            </p>
            <p className="font-mono text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              {criticalItems.length > 0 ? criticalItems.join(' · ') : 'Nenhum item configurado no momento.'}
            </p>
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/70 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 py-1.5 bg-sap-500 hover:bg-sap-600 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
