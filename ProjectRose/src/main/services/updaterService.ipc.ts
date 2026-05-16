import { defineIpc, method } from '../../shared/ipc/defineIpc'

// Request/response only. The five event-broadcast channels
// (UPDATER_AVAILABLE / UPDATER_NOT_AVAILABLE / UPDATER_PROGRESS /
// UPDATER_DOWNLOADED / UPDATER_ERROR) stay as IPC-enum entries because they
// are emitted from main via webContents.send and the manifest covers
// ipcRenderer.invoke round-trips only.
export const updaterIpc = defineIpc('updater', {
  check: method<[], void>(),
  download: method<[], void>(),
  install: method<[], void>(),
  skipVersion: method<[version: string], void>()
})
