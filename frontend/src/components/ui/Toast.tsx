import { CheckCircle2, AlertCircle, CircleX, X } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

export type ToastType = 'success' | 'error' | 'info'

interface ToastProps {
  message: string
  type: ToastType
  onClose: () => void
}

const icons = {
  success: CheckCircle2,
  error: CircleX,
  info: AlertCircle,
} satisfies Record<ToastType, typeof CheckCircle2>

export function Toast({ message, type, onClose }: ToastProps) {
  const Icon = icons[type]

  useEffect(() => {
    const timer = window.setTimeout(onClose, 4200)
    return () => window.clearTimeout(timer)
  }, [onClose])

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[100] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur',
        type === 'success' && 'border-success/30 bg-success/10 text-success',
        type === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        type === 'info' && 'border-primary/30 bg-primary/10 text-primary',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 text-sm text-foreground">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full p-1 text-muted-foreground transition hover:bg-background/70 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
