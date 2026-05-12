/**
 * MainEventBus: small helper for sending events from main → renderer without
 * the caller needing to know about BrowserWindow.
 *
 * Today we just pick the first window — the renderer is a single-window app.
 * If that changes, route here.
 *
 * The `electron` import is deferred so this module can be loaded under
 * vitest (which has no Electron runtime). Production callers hit the cached
 * `require` on first emit.
 */
export function emitToRenderer(channel: string, payload: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BrowserWindow } = require('electron') as typeof import('electron')
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(channel, payload)
}
