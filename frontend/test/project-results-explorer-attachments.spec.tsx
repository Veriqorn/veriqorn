import { createElement, useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AttachmentList,
  buildAttachmentDownloadUrl,
  inferAttachmentPreviewKind,
} from '../src/routes/project-results-explorer'
import type { TestAttachment, TestResult } from '../src/types'

const attachment = (patch: Partial<TestAttachment>): TestAttachment => ({
  id: patch.id ?? 'attachment-1',
  name: patch.name ?? 'attachment.txt',
  source: patch.source ?? patch.name ?? 'attachment.txt',
  type: patch.type ?? 'text/plain',
  ...patch,
})

const resultWithAttachment = (item: TestAttachment): TestResult => ({
  duration: 100,
  history: [],
  id: 'result-1',
  labels: [],
  name: 'checkout renders attachments',
  retries: [],
  status: 'failed',
  steps: [
    {
      attachments: [item],
      childSteps: [],
      id: 'step-1',
      name: 'capture evidence',
      status: 'failed',
    },
  ],
  totalAttachments: 1,
  uuid: 'result-1',
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('project result attachment previews', () => {
  let container: HTMLDivElement
  let root: Root
  let originalFetch: typeof fetch

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    document.body.innerHTML = ''
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('recognizes legacy previewable attachment formats', () => {
    expect(inferAttachmentPreviewKind(attachment({ name: 'screenshot.png', type: 'image/png' }))).toBe('image')
    expect(inferAttachmentPreviewKind(attachment({ name: 'recording.webm', type: 'video/webm' }))).toBe('video')
    expect(inferAttachmentPreviewKind(attachment({ name: 'report.html', type: 'text/html' }))).toBe('html')
    expect(inferAttachmentPreviewKind(attachment({ name: 'console.log', type: 'text/plain' }))).toBe('text')
    expect(inferAttachmentPreviewKind(attachment({ name: 'payload.json', type: 'application/json' }))).toBe('text')
    expect(inferAttachmentPreviewKind(attachment({ name: 'archive.bin', type: 'application/octet-stream' }))).toBeNull()
  })

  it('opens a text attachment preview through the run attachment endpoint', async () => {
    const requestUrls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      requestUrls.push(String(input))
      return new Response('line 1\nline 2', {
        headers: { 'Content-Type': 'text/plain' },
        status: 200,
      })
    }) as unknown as typeof fetch

    const AttachmentHarness = () => {
      const [inlinePreviews, setInlinePreviews] = useState<Record<string, { attachment: TestAttachment; kind: 'text'; loading: boolean; text: string } | null>>({})
      const result = resultWithAttachment(attachment({
        id: 'log-1',
        name: 'console.log',
        source: 'console.log',
        type: 'text/plain',
      }))

      return createElement(AttachmentList, {
        inlinePreviews,
        launchId: '55',
        onOpenAttachmentPreview: vi.fn(),
        onToggleInlineAttachmentPreview: async (item: TestAttachment) => {
          const response = await fetch(buildAttachmentDownloadUrl('default', '55', item.id))
          const text = await response.text()
          setInlinePreviews((current) => ({
            ...current,
            [item.id]: current[item.id]
              ? null
              : {
                  attachment: item,
                  kind: 'text',
                  loading: false,
                  text,
                },
          }))
        },
        projectId: 'default',
        result,
      })
    }

    await act(async () => {
      root.render(createElement(AttachmentHarness))
    })

    const previewButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Preview')
    expect(previewButton).toBeTruthy()

    await act(async () => {
      previewButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })
    await act(async () => {
      await flush()
    })

    expect(requestUrls).toEqual(['http://localhost:3001/api/v1/projects/default/runs/55/attachments/log-1'])
    expect(container.textContent).toContain('line 1')
    expect(container.textContent).toContain('line 2')
  })
})
