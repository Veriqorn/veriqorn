const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function normalizeDateInputToSearchValue(value: string, boundary: 'end' | 'start'): string | undefined {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    return undefined
  }

  if (!DATE_ONLY_PATTERN.test(normalizedValue)) {
    return normalizedValue
  }

  const [year, month, day] = normalizedValue.split('-').map((part) => Number.parseInt(part, 10))
  const date =
    boundary === 'start'
      ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function searchValueToDateInput(value?: string) {
  const normalizedValue = value?.trim()
  if (!normalizedValue) {
    return ''
  }

  if (DATE_ONLY_PATTERN.test(normalizedValue)) {
    return normalizedValue
  }

  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toISOString().slice(0, 10)
}
