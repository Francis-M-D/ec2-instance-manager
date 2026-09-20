import { createContext, useCallback, useContext, useState, ReactNode } from 'react'

interface ToastMsg {
  id: number
  text: string
  kind: 'success' | 'error' | 'info'
}

interface ToastContextValue {
  push: (text: string, kind?: ToastMsg['kind']) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const KIND_STYLES: Record<ToastMsg['kind'], string> = {
  success: 'bg-emerald-600',
  error: 'bg-rose-600',
  info: 'bg-slate-800',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  const push = useCallback((text: string, kind: ToastMsg['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${KIND_STYLES[t.kind]}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
