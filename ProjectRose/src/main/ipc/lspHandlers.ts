import { ipcMain, BrowserWindow } from 'electron'
import { basename } from 'path'
import { IPC } from '../../shared/ipcChannels'
import { startLsp, registerLspIpcHandlers } from '../services/lspManager'
import { logInteraction } from '../services/interactionLog'

export function registerLspHandlers(): void {
  registerLspIpcHandlers()

  ipcMain.handle(IPC.INDEXING_PROJECT, async (event, rootPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    // Tap closest to a committed project open. Log only the folder basename —
    // the full path can include the user's name and is more sensitive than the
    // agent needs for "what did the user just do".
    logInteraction('project.opened', basename(rootPath))

    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.INDEXING_PROGRESS, {
        phase: 'checking',
        total: 0,
        completed: 0,
        message: 'Starting language servers...'
      })
    }

    const result = await startLsp(rootPath)

    const ready = (result.py ? 'Python' : '') + (result.py && result.ts ? ' & ' : '') + (result.ts ? 'TypeScript' : '')
    const message = ready ? `${ready} language server ready` : 'Language servers unavailable'
    const phase = ready ? 'done' : 'error'

    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.INDEXING_PROGRESS, {
        phase,
        total: 1,
        completed: 1,
        message
      })
    }

    return { indexed: 0, total: 0 }
  })
}
