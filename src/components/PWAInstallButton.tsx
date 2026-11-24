import { useState } from 'react';
import { MonitorDown, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        title="Instalar o Extrator SU53 como aplicativo desktop para uso offline"
        className="min-h-[38px] px-3.5 py-1.5 bg-sap-500 hover:bg-sap-600 text-white shadow-2xs text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
      >
        <MonitorDown className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Instalar App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[38px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 shadow-2xs text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
        >
          <MonitorDown className="w-3.5 h-3.5 text-sap-600" aria-hidden="true" />
          <span>Instalar App</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-sm w-full p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  id="ios-install-title"
                  className="text-base font-semibold text-slate-900"
                >
                  Instalar no iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Fechar instruções"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs sm:text-sm text-slate-600 space-y-2 list-decimal list-inside">
                <li>
                  Toque no botão{' '}
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                    <Share className="w-3.5 h-3.5 text-sap-600" aria-hidden="true" />
                    Compartilhar
                  </span>{' '}
                  na barra do Safari.
                </li>
                <li>
                  Role as opções e toque em{' '}
                  <strong className="text-slate-800">Adicionar à Tela de Início</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[38px] px-4 py-2 bg-sap-500 hover:bg-sap-600 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
