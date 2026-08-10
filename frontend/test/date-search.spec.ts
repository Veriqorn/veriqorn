import { describe, expect, it } from 'vitest'

import { normalizeDateInputToSearchValue, searchValueToDateInput } from '@/lib/date-search'

describe('date search helpers', () => {
  it('expands date-only input to UTC day boundaries', () => {
    expect(normalizeDateInputToSearchValue('2026-04-19', 'start')).toBe('2026-04-19T00:00:00.000Z')
    expect(normalizeDateInputToSearchValue('2026-04-19', 'end')).toBe('2026-04-19T23:59:59.999Z')
  })

  it('passes through non-date search values and drops empty input', () => {
    expect(normalizeDateInputToSearchValue(' last-24h ', 'start')).toBe('last-24h')
    expect(normalizeDateInputToSearchValue('   ', 'end')).toBeUndefined()
  })

  it('converts ISO timestamps back to date input values', () => {
    expect(searchValueToDateInput('2026-04-19T13:45:00.000Z')).toBe('2026-04-19')
    expect(searchValueToDateInput('2026-04-19')).toBe('2026-04-19')
    expect(searchValueToDateInput('not-a-date')).toBe('')
  })
})
