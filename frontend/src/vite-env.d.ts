/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_APP_NAME?: string
  readonly VITE_KB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __VERIQORN_RUNTIME_CONFIG__?: {
    apiUrl?: string
    appName?: string
    kbUrl?: string
  }
}
