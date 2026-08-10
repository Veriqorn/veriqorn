import { AlertCircle, CheckCircle2, CircleX, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

type ToastTone = 'error' | 'info' | 'success'

interface ToastRecord {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void
}

const toneConfig = {
  error: {
    Icon: CircleX,
    accentClassName: 'text-destructive',
    label: 'Error',
    panelClassName: 'border-destructive/20 bg-card/96',
  },
  info: {
    Icon: AlertCircle,
    accentClassName: 'text-primary',
    label: 'Info',
    panelClassName: 'border-border/90 bg-card/96',
  },
  success: {
    Icon: CheckCircle2,
    accentClassName: 'text-success',
    label: 'Success',
    panelClassName: 'border-success/20 bg-card/96',
  },
} satisfies Record<
  ToastTone,
  {
    Icon: typeof CheckCircle2
    accentClassName: string
    label: string
    panelClassName: string
  }
>

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const idRef = useRef(0)
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      idRef.current += 1
      const nextToast = { id: idRef.current, message, tone }
      setToasts((current) => [...current, nextToast])

      window.setTimeout(() => {
        dismissToast(nextToast.id)
      }, 4000)
    },
    [dismissToast],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-atomic="true" aria-live="polite" className="pointer-events-none fixed right-5 top-5 z-50 flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => {
          const tone = toneConfig[toast.tone]

          return (
            <div
              className={cn(
                'pointer-events-auto overflow-hidden rounded-[1.35rem] border px-4 py-3 text-sm text-foreground shadow-[0_18px_40px_rgba(18,25,40,0.14)] backdrop-blur-xl',
                tone.panelClassName,
              )}
              key={toast.id}
            >
              <div className="flex items-start gap-3">
                <tone.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone.accentClassName)} />
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{tone.label}</p>
                  <p className="mt-2 leading-6 text-foreground">{toast.message}</p>
                </div>
                <button
                  aria-label="Dismiss notification"
                  className="rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  onClick={() => dismissToast(toast.id)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider.')
  }

  return context
}
