import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

interface PageActionsState {
  slot: HTMLElement | null
  setSlot: (element: HTMLElement | null) => void
  registerActive: () => () => void
  activeCount: number
}

const PageActionsContext = createContext<null | PageActionsState>(null)

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [activeCount, setActiveCount] = useState(0)

  const registerActive = useCallback(() => {
    setActiveCount((count) => count + 1)
    return () => setActiveCount((count) => Math.max(0, count - 1))
  }, [])

  const value = useMemo(() => ({ slot, setSlot, registerActive, activeCount }), [slot, registerActive, activeCount])
  return <PageActionsContext.Provider value={value}>{children}</PageActionsContext.Provider>
}

function usePageActionsContext(): PageActionsState {
  const value = useContext(PageActionsContext)
  if (!value) throw new Error('PageActions hooks must be used inside PageActionsProvider')
  return value
}

export function PageActionsSlot({ fallback }: { fallback?: ReactNode }) {
  const { activeCount, setSlot } = usePageActionsContext()
  return (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end" ref={setSlot}>
      {activeCount === 0 ? fallback : null}
    </div>
  )
}

export function PageActions({ children }: { children: ReactNode }) {
  const { registerActive, slot } = usePageActionsContext()

  useEffect(() => registerActive(), [registerActive])

  if (!slot) return null
  return createPortal(children, slot)
}
