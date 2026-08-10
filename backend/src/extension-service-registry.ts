/**
 * Core-owned registry for services contributed by explicit extensions.
 *
 * The registry transports opaque values only: Core neither imports nor knows
 * the implementation types of Enterprise services. Compatibility adapters can
 * request a documented service by extension ID while the real route migration
 * is in progress.
 */
export class ExtensionServiceRegistry {
  private readonly servicesByExtension = new Map<string, Readonly<Record<string, unknown>>>()

  register(extensionId: string, services: Record<string, unknown>): void {
    if (this.servicesByExtension.has(extensionId)) {
      throw new Error(`Extension services for '${extensionId}' are already registered`)
    }
    this.servicesByExtension.set(extensionId, Object.freeze({ ...services }))
  }

  unregister(extensionId: string): void {
    this.servicesByExtension.delete(extensionId)
  }

  get<T = unknown>(extensionId: string, serviceId: string): T | undefined {
    return this.servicesByExtension.get(extensionId)?.[serviceId] as T | undefined
  }

  listExtensionIds(): string[] {
    return [...this.servicesByExtension.keys()].sort()
  }
}
