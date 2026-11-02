import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

const TOAST_DURATION_MS = 4000;

interface Toast {
  id: number;
  message: ReactNode;
  tone: "neutral" | "bad";
}

type ShowToast = (message: ReactNode, tone?: Toast["tone"]) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback<ShowToast>((message, tone = "neutral") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), TOAST_DURATION_MS);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-enter pointer-events-auto max-w-sm rounded-button border border-line bg-surface-raised px-4 py-3 text-ui shadow-pop ${
              toast.tone === "bad" ? "border-l-[3px] border-l-bad" : ""
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
