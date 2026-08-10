import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from '@/components/AppErrorBoundary'

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test render failure')
  }

  return createElement('div', null, 'Content rendered')
}

describe('AppErrorBoundary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  it('renders children when no error occurs', async () => {
    await act(async () => {
      root.render(
        createElement(
          AppErrorBoundary,
          null,
          createElement(ThrowingComponent, { shouldThrow: false }),
        ),
      )
    })

    expect(container.textContent).toContain('Content rendered')
  })

  it('renders the fallback UI when a child throws during render', async () => {
    await act(async () => {
      root.render(
        createElement(
          AppErrorBoundary,
          null,
          createElement(ThrowingComponent, { shouldThrow: true }),
        ),
      )
    })

    expect(container.textContent).toContain('Frontend-v2 bootstrap error')
    expect(container.textContent).toContain('Something broke during render.')
    expect(container.textContent).toContain('Test render failure')
    expect(container.textContent).toContain('Reset boundary')
    expect(container.textContent).toContain('Reload application')
  })
})
