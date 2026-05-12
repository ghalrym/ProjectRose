/**
 * MainEventBus: small helper for sending events from main → renderer without
 * the caller needing to know about BrowserWindow.
 *
 * Today we just pick the first window — the renderer is a single-window app.
 * If that changes, route here.
 *
 * The `electron` import is deferred so this module can be loaded under
 * vitest (which has no Electron runtime). Tests inject a fake via
 * `_setGetWindowsForTest`.
 */
type WindowLike = { webContents: { send(channel: string, payload: unknown): void } }

let _getWindowsOverride: (() => WindowLike[]) | null = null

/** Test seam — production code never calls this. */
export function _setGetWindowsForTest(p: (() => WindowLike[]) | null): void {
  _getWindowsOverride = p
}

export function emitToRenderer(channel: string, payload: unknown): void {
  const windows = _getWindowsOverride
    ? _getWindowsOverride()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    : (require('electron') as typeof import('electron')).BrowserWindow.getAllWindows()
  windows[0]?.webContents.send(channel, payload)
}
