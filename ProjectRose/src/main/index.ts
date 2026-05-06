import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow, setQuitting } from './window'
import { createTray, destroyTray } from './tray'
import { registerAllHandlers } from './ipc'
import { attachDisplayMediaHandler } from './ipc/screenHandlers'
import { buildAppMenu } from './menu'
import { disposeAllTerminals } from './services/terminalService'
import { stopLsp } from './services/lspManager'
import { initAutoUpdater } from './services/updaterService'
// Ensure single instance
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, _commandLine) => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.projectrose.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerAllHandlers()
  attachDisplayMediaHandler()
  buildAppMenu()
  createWindow()
  createTray()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// File → Quit / Cmd+Q / process signals all flow through `before-quit`. Mark
// the app as quitting so the window-close handler stops intercepting and
// lets the actual destroy go through.
app.on('before-quit', () => {
  setQuitting(true)
})

// The window's close handler hides instead of destroying when the tray is
// alive, so 'window-all-closed' only fires on an explicit quit. Keep the
// shutdown work here so the cleanup path runs once at the actual exit.
app.on('window-all-closed', () => {
  disposeAllTerminals()
  stopLsp()
  destroyTray()
  if (process.platform !== 'darwin') app.quit()
})
