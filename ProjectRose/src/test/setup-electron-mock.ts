import { vi } from 'vitest'

// Stub the `electron` module for unit tests.
//
// The renderer / main code reaches Electron APIs (BrowserWindow,
// ipcMain, ipcRenderer, app, dialog) at module-load time in several
// places, so any test that transitively imports those modules — even
// just for the type or for an unrelated symbol — fails with
// "Electron failed to install correctly" because the test runner has
// no Electron binary.
//
// The mock only needs to expose the shape of the API at module load.
// Tests that exercise specific Electron behaviours can override
// individual fields with `vi.mocked(...)` locally.
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
    removeHandler: () => {},
    removeAllListeners: () => {},
  },
  ipcRenderer: {
    invoke: () => Promise.resolve(),
    on: () => {},
    send: () => {},
    removeListener: () => {},
  },
  app: {
    getPath: (): string => '/tmp',
    getName: (): string => 'projectrose-test',
    getVersion: (): string => '0.0.0-test',
    on: () => {},
  },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
  shell: {
    openExternal: () => Promise.resolve(),
  },
}))

// `electron-log/main` resolves the Electron module at load time via
// `require('electron')`, which trips `getElectronPath()` in `npm ci
// --ignore-scripts` environments (no binary on disk) — the exact failure
// mode that breaks main-process tests in CI. Stub it out alongside
// `electron` itself so any module that imports a logger still loads.
vi.mock('electron-log/main', () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    verbose: () => {},
    silly: () => {},
    log: () => {},
  },
}))
