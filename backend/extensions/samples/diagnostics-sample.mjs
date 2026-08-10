/**
 * Internal reference extension for the v1 backend SDK.
 *
 * It is deliberately not listed in backend/extensions/manifest.json. Operators
 * can enable it with diagnostics-sample.manifest.json when validating an
 * extension-enabled deployment.
 */
export const extension = {
  manifest: {
    id: 'diagnostics-sample',
    version: '1.0.0',
    sdkApiVersion: 1,
    requiresCore: '*',
    displayName: 'Diagnostics sample',
    requiredEntitlements: ['diagnostics.sample'],
  },

  registerServices: async (context) => {
    const startedAt = new Date().toISOString()
    context.logger.info('Diagnostics sample initialized', { startedAt })
    return {
      getStatus: async () => ({
        extension: context.extension.id,
        startedAt,
        entitlementAvailable: await context.entitlements.has('diagnostics.sample'),
      }),
    }
  },

  registerRoutes: ({ entitlements, services }) => (app) => app
    .get('/extensions/diagnostics-sample/health', async () => ({
      status: 'healthy',
      ...(await services.getStatus()),
    }))
    .post('/extensions/diagnostics-sample/protected-action', async () => {
      await entitlements.assert('diagnostics.sample')
      return { accepted: true }
    }),

  health: async () => ({ status: 'healthy', message: 'Reference extension is loaded.' }),
}
