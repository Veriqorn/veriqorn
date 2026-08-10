import { describe, expect, it } from 'vitest'

import { normalizeResultsResponse } from '@/lib/queries'

describe('results normalization', () => {
  it('drops missing allure ids instead of failing schema validation', () => {
    const response = normalizeResultsResponse({
      items: [
        {
          allureId: null,
          diagnostics: null,
          duration: 12,
          history: [],
          id: 'result-1',
          labels: [],
          name: 'Example test',
          retries: [],
          status: 'passed',
          steps: [],
          totalAttachments: 0,
        },
      ],
      meta: {
        brokenCount: 0,
        failedCount: 0,
        generatedAt: '2026-05-05T00:00:00.000Z',
        passedCount: 1,
        runId: '214',
        skippedCount: 0,
        totalAttachments: 0,
        totalResults: 1,
      },
      total: 1,
    })

    expect(response.items[0]?.allureId).toBeUndefined()
  })
})
