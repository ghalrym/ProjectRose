import { createServer, Server } from 'http'
import type { AddressInfo } from 'net'
import { renderClosePage } from './closePage'

export interface LoopbackHandle {
  server: Server
  port: number
  codePromise: Promise<string>
}

export async function startLoopbackServer(expectedState: string): Promise<LoopbackHandle> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })

  let settled = false
  const settle = (fn: () => void): void => {
    if (settled) return
    settled = true
    fn()
  }

  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (u.pathname !== '/callback') {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('not found')
      return
    }

    const state = u.searchParams.get('state') ?? ''
    const code = u.searchParams.get('code') ?? ''
    const error = u.searchParams.get('error') ?? ''

    let pageError: string | null = null
    if (error) pageError = error
    else if (state !== expectedState) pageError = 'state_mismatch'
    else if (!code) pageError = 'missing_code'

    res.statusCode = pageError ? 400 : 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(renderClosePage(pageError))

    if (state !== expectedState) {
      settle(() => rejectCode(new Error('State mismatch — possible CSRF, aborting.')))
      return
    }
    if (error) {
      settle(() => rejectCode(new Error(`Authorization ${error}`)))
      return
    }
    if (!code) {
      settle(() => rejectCode(new Error('No code in callback.')))
      return
    }
    settle(() => resolveCode(code))
  })

  return new Promise<LoopbackHandle>((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      ok({ server, port: addr.port, codePromise })
    })
  })
}
