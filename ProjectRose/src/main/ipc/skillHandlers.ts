import { ipcMain, dialog, BrowserWindow } from 'electron'
import { copyFile, mkdir } from 'fs/promises'
import { basename, join } from 'path'
import { IPC } from '../../shared/ipcChannels'
import { listSkills } from '../services/skillService'
import { prPath } from '../lib/projectPaths'

// Stays hand-written because the upload dialog must anchor to the calling
// BrowserWindow via event.sender. The other skills methods (list, delete)
// are declared via the typed manifest in services/skillService.ipc.ts.
export function registerSkillHandlers(): void {
  ipcMain.handle(IPC.SKILLS_UPLOAD, async (event, rootPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false }
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown Skills', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    const src = result.filePaths[0]
    const destDir = prPath(rootPath, 'skills')
    await mkdir(destDir, { recursive: true })
    await copyFile(src, join(destDir, basename(src)))
    return { ok: true, skills: await listSkills(rootPath) }
  })
}
