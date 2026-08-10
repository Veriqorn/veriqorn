import { extname, isAbsolute, join, normalize, relative } from 'node:path'

const distDir = join(import.meta.dir, 'dist')
const indexFile = Bun.file(join(distDir, 'index.html'))

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
])

const apiConnectSource = () => {
  const apiUrl = readRuntimeValue(Bun.env.VITE_API_URL, Bun.env.NEXT_PUBLIC_API_URL, 'http://localhost:3001')
  try {
    const apiOrigin = new URL(apiUrl).origin
    return apiOrigin === 'null' ? '' : ` ${apiOrigin}`
  } catch {
    return ''
  }
}

const securityHeaders = () => ({
  'Content-Security-Policy': `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:${apiConnectSource()}`,
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
})

const readRuntimeValue = (...values) => {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized) {
      return normalized
    }
  }

  return ''
}

const buildRuntimeConfig = () => ({
  apiUrl: readRuntimeValue(Bun.env.VITE_API_URL, Bun.env.NEXT_PUBLIC_API_URL, 'http://localhost:3001'),
  appName: readRuntimeValue(Bun.env.VITE_APP_NAME, 'Veriqorn'),
  kbUrl: readRuntimeValue(Bun.env.VITE_KB_URL, Bun.env.NEXT_PUBLIC_KB_URL, 'http://localhost:5174'),
})

const resolveFilePath = (pathname) => {
  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathname || '/')
  } catch {
    return null
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
  const resolvedPath = normalize(join(distDir, relativePath))

  const relativePathToDist = relative(distDir, resolvedPath)
  if (relativePathToDist.startsWith('..') || isAbsolute(relativePathToDist) || relativePathToDist.split(/[\\/]/).some((part) => part.startsWith('.'))) {
    return null
  }

  return resolvedPath
}

Bun.serve({
  hostname: '0.0.0.0',
  port: Number(Bun.env.PORT || 3000),
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/runtime-config.js') {
      return new Response(`window.__VERIQORN_RUNTIME_CONFIG__ = ${JSON.stringify(buildRuntimeConfig())};`, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/javascript; charset=utf-8',
          ...securityHeaders(),
        },
      })
    }

    const filePath = resolveFilePath(url.pathname)

    if (filePath) {
      const file = Bun.file(filePath)
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': file.type || contentTypes.get(extname(filePath)) || 'application/octet-stream',
            ...securityHeaders(),
          },
        })
      }
    }

    return new Response(indexFile, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...securityHeaders(),
      },
    })
  },
})

console.log(`frontend serving dist on http://0.0.0.0:${Number(Bun.env.PORT || 3000)}`)
