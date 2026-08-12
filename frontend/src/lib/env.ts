type RuntimeConfig = {
  apiUrl?: string
  appName?: string
  appVersion?: string
  kbUrl?: string
}

const readEnv = (...values: Array<string | undefined>) => {
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) {
      return normalized
    }
  }

  return ''
}

const readRuntimeConfig = (): RuntimeConfig | null => {
  if (typeof window === 'undefined') {
    return null
  }

  return window.__VERIQORN_RUNTIME_CONFIG__ ?? null
}

const runtimeConfig = readRuntimeConfig()

export const env = {
  apiUrl: readEnv(runtimeConfig?.apiUrl, import.meta.env.VITE_API_URL, 'http://localhost:3001'),
  appName: readEnv(runtimeConfig?.appName, import.meta.env.VITE_APP_NAME, 'Veriqorn'),
  appVersion: readEnv(runtimeConfig?.appVersion, import.meta.env.VITE_APP_VERSION),
  kbUrl: readEnv(runtimeConfig?.kbUrl, import.meta.env.VITE_KB_URL, 'http://localhost:5174'),
}
