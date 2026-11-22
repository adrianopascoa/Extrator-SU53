import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { ToastItem } from '../types/su53';

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-lg shadow-lg text-xs font-medium transition-all duration-150 ${
              isError
                ? 'bg-red-600 text-white border border-red-700'
                : 'bg-slate-900 text-white border border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {isError ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-100" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />
              )}
              <span className="leading-snug">{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="p-1 rounded hover:bg-white/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Fechar notificação"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
