"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastOptions = { actionLabel?: string; onAction?: () => void; duration?: number };
type ToastItem = { id: number; message: string } & ToastOptions;

const ToastContext = createContext<{ show: (message: string, opts?: ToastOptions) => void } | null>(
  null,
);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      if (timer.current) clearTimeout(timer.current);
      const item = { id: Date.now(), message, ...opts };
      setToast(item);
      timer.current = setTimeout(dismiss, opts.duration ?? (opts.actionLabel ? 5000 : 2800));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 flex justify-center px-5"
      >
        {toast && (
          <div
            key={toast.id}
            className="anim-sheet pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-lg bg-ink px-4 py-3 text-paper"
          >
            <span className="flex-1 text-[14px] leading-snug">{toast.message}</span>
            {toast.actionLabel && (
              <button
                type="button"
                className="shrink-0 rounded-sm px-2 py-1 text-[14px] font-bold text-member-4 underline-offset-2 hover:underline"
                onClick={() => {
                  toast.onAction?.();
                  dismiss();
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastProvider 안에서만 쓸 수 있어요");
  return ctx;
}
