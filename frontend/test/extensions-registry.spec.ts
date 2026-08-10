import { describe, expect, test } from 'vitest'

import { isFrontendContributionEntitled, navigationContributions, parseFrontendExtensionManifest, resultDetailContributions, routeContributions, settingsContributions } from '@/extensions/registry'

describe('frontend extension registry', () => {
  test('uses the same entitlement decision for navigation and direct routes', () => {
    expect(isFrontendContributionEntitled(undefined, false)).toBe(true)
    expect(isFrontendContributionEntitled('ai.kb', false)).toBe(false)
    expect(isFrontendContributionEntitled('ai.kb', true)).toBe(true)
  })

  test('orders result-detail contributions without exposing extension internals', () => {
    const component = () => null
    const contributions = resultDetailContributions([{
      manifest: { id: 'example', requiresCore: '*', sdkApiVersion: 1, version: '1.0.0' },
      moduleUrl: 'http://localhost/extensions/example.js',
      resultDetails: [
        { component, id: 'later', label: 'Later', order: 20 },
        { component, id: 'first', label: 'First', order: 10 },
      ],
    }])
    expect(contributions.map((item) => item.id)).toEqual(['first', 'later'])
  })

  test('accepts a same-origin extension manifest and orders contributions', () => {
    expect(parseFrontendExtensionManifest({
      schemaVersion: 1,
      extensions: [{ id: 'enterprise-ai', version: '1.0.0', module: '/extensions/enterprise-ai.js', sdkApiVersion: 1, requiresCore: '*' }],
    })).toMatchObject({ extensions: [{ id: 'enterprise-ai' }] })

    const extensions = [{
      moduleUrl: 'http://localhost/extensions/enterprise-ai.js',
      manifest: { id: 'enterprise-ai', version: '1.0.0', sdkApiVersion: 1, requiresCore: '*' },
      navigation: [
        { id: 'ai', label: 'AI', href: '/extensions/enterprise-ai/ai', order: 20 },
        { id: 'kb', label: 'Knowledge Base', href: '/extensions/enterprise-ai/kb', order: 10 },
      ],
      settings: [{ id: 'ai-settings', title: 'AI settings', order: 5, component: () => null }],
    }]

    expect(navigationContributions(extensions)).toMatchObject([{ id: 'kb' }, { id: 'ai' }])
    expect(settingsContributions(extensions)).toMatchObject([{ id: 'ai-settings' }])
  })

  test('rejects a manifest that would load a remote module', () => {
    expect(() => parseFrontendExtensionManifest({
      schemaVersion: 1,
      extensions: [{ id: 'remote', version: '1.0.0', module: 'https://example.com/extension.js', sdkApiVersion: 1, requiresCore: '*' }],
    })).toThrow('Invalid frontend extension manifest entry')
  })

  test('rejects a navigation contribution outside the extension namespace', () => {
    expect(() => navigationContributions([{
      moduleUrl: 'http://localhost/extensions/example.js',
      manifest: { id: 'example', version: '1.0.0', sdkApiVersion: 1, requiresCore: '*' },
      navigation: [{ id: 'core-takeover', label: 'Takeover', href: '/settings' }],
    }])).toThrow('navigation must use the /extensions/ namespace')
  })

  test('rejects a route contribution outside the extension namespace', () => {
    expect(() => routeContributions([{
      moduleUrl: 'http://localhost/extensions/example.js',
      manifest: { id: 'example', version: '1.0.0', sdkApiVersion: 1, requiresCore: '*' },
      routes: [{ id: 'core-takeover', path: '/settings', component: () => null }],
    }])).toThrow('route path must use the /extensions/ namespace')
  })
})
