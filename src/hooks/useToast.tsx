import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
  /** Promise-based replacement for window.confirm(). */
  confirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const TOAST_MS = 5000;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      // Monotonic id without Date.now collisions when several fire at once.
      const id = Math.floor(Math.random() * 1e9);
      setToasts(prev => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  const confirm = useCallback(
    (opts: {
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
    }) =>
      new Promise<boolean>(resolve => {
        setConfirmReq({
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? 'Confirm',
          danger: opts.danger ?? false,
          resolve,
        });
      }),
    [],
  );

  const settle = (ok: boolean) => {
    confirmReq?.resolve(ok);
    setConfirmReq(null);
  };

  const api = useMemo<ToastApi>(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Toast stack */}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 w-80 p-4 rounded-2xl border shadow-2xl backdrop-blur-sm animate-in slide-in-from-right-4 fade-in duration-300 ${
              t.kind === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
                : t.kind === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                : 'bg-grabix-surface dark:bg-grabix-input-dark border-grabix-border dark:border-grabix-border-dark text-black dark:text-grabix-white'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {t.kind === 'success' ? (
                <CheckCircle2 size={16} />
              ) : t.kind === 'error' ? (
                <AlertCircle size={16} />
              ) : (
                <Info size={16} className="text-grabix-purple" />
              )}
            </div>
            <p className="flex-1 text-xs leading-relaxed break-words">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmReq && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-grabix-bg dark:bg-grabix-bg-dark rounded-3xl border border-grabix-border dark:border-grabix-border-dark shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-7 space-y-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  confirmReq.danger
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-grabix-purple/10 text-grabix-purple'
                }`}
              >
                <AlertCircle size={24} />
              </div>
              <h3 className="text-lg font-bold text-black dark:text-white">
                {confirmReq.title}
              </h3>
              <p className="text-xs text-grabix-muted leading-relaxed">
                {confirmReq.message}
              </p>
            </div>
            <div className="px-7 py-5 bg-grabix-surface dark:bg-black/20 border-t border-grabix-border dark:border-grabix-border-dark flex items-center justify-end gap-3">
              <button
                onClick={() => settle(false)}
                className="px-5 py-2.5 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark text-grabix-muted hover:text-black dark:hover:text-white text-xs font-bold transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={() => settle(true)}
                className={`px-5 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-lg active:scale-[0.98] ${
                  confirmReq.danger
                    ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                    : 'bg-grabix-purple hover:bg-grabix-purple-hover shadow-grabix-purple/20'
                }`}
              >
                {confirmReq.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};
