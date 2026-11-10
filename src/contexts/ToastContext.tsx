import React, { createContext, useContext, useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, title?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Global event bus for non-React services to trigger toasts
type ToastListener = (toast: ToastItem) => void;
const listeners: ToastListener[] = [];

export function emitGlobalToast(message: string, type: ToastType = 'info', title?: string) {
  const item: ToastItem = {
    id: 'toast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    type,
    title,
    message,
  };
  listeners.forEach((fn) => fn(item));
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (message: string, type: ToastType = 'info', title?: string) => {
    emitGlobalToast(message, type, title);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const handler: ToastListener = (item) => {
      setToasts((prev) => [...prev, item]);
      // Auto-dismiss after 5 seconds; track timer so unmount clears it.
      const timer = setTimeout(() => {
        timers.delete(item.id);
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 5000);
      timers.set(item.id, timer);
    };

    listeners.push(handler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, removeToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto p-4 rounded-xl border shadow-lg transition-all animate-in fade-in slide-in-from-top-2 duration-200 flex items-start gap-3 text-xs ${
              t.type === 'error'
                ? 'bg-rose-900/95 text-rose-100 border-rose-700'
                : t.type === 'success'
                ? 'bg-emerald-900/95 text-emerald-100 border-emerald-700'
                : t.type === 'warning'
                ? 'bg-amber-900/95 text-amber-100 border-amber-700'
                : 'bg-slate-900/95 text-slate-100 border-slate-700'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {t.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
              {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {t.type === 'warning' && <AlertCircle className="w-4 h-4 text-amber-400" />}
              {t.type === 'info' && <Info className="w-4 h-4 text-blue-400" />}
            </div>
            <div className="flex-1 space-y-0.5">
              {t.title && <div className="font-bold text-white text-[14px]">{t.title}</div>}
              <div className="leading-relaxed opacity-95">{t.message}</div>
            </div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="shrink-0 p-1 hover:bg-white/10 rounded-md transition-colors text-white/70 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: emitGlobalToast,
      removeToast: () => {},
    };
  }
  return ctx;
}
