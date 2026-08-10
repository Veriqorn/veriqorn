import { describe, expect, test } from 'bun:test'

import { ExtensionServiceRegistry } from '../src/extension-service-registry'

describe('extension service registry', () => {
  test('keeps registered services immutable and rejects duplicate extension registration', () => {
    const registry = new ExtensionServiceRegistry()
    const source = { answer: 42 }
    registry.register('enterprise-ai', source)
    source.answer = 7

    expect(registry.get<number>('enterprise-ai', 'answer')).toBe(42)
    expect(registry.listExtensionIds()).toEqual(['enterprise-ai'])
    expect(() => registry.register('enterprise-ai', { answer: 99 })).toThrow("already registered")
  })

  test('allows lifecycle cleanup before a replacement registration', () => {
    const registry = new ExtensionServiceRegistry()
    registry.register('diagnostics', { version: 1 })
    registry.unregister('diagnostics')
    registry.register('diagnostics', { version: 2 })

    expect(registry.get<number>('diagnostics', 'version')).toBe(2)
  })
})
