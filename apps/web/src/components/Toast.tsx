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
      {/* 폰 독 위. (#332) 390 미만은 + 가 독 위로 올라가 그 위(16 + 64 + 12 + 64 + 12)에 띄운다 */}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(168px+env(safe-area-inset-bottom))] dock:bottom-[calc(134px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 fold:bottom-6"
      >
        {toast && (
          <div
            key={toast.id}
            className="anim-sheet pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-md bg-ink px-4 py-3 text-surface"
          >
            <span className="flex-1 text-[14px] font-medium leading-5">{toast.message}</span>
            {toast.actionLabel && (
              <button
                type="button"
                className="shrink-0 rounded-sm px-2 py-1 text-[13px] font-bold text-surface underline underline-offset-2"
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
