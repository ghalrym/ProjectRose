import { BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

const ICON_PATH = join(__dirname, '../../build/icon.ico')

// Theme colors matching variables.css
const THEME_COLORS = {
  dark:      { bg: '#11111b', fg: '#cdd6f4' },
  light:     { bg: '#dce0e8', fg: '#4c4f69' },
  herbarium: { bg: '#e8e0d0', fg: '#2e2418' },
}

let mainWindow: BrowserWindow | null = null

// True only when the user has explicitly chosen to quit (e.g. via tray menu
// "Quit" or File → Quit). The window-close handler reads this to decide
// whether to actually destroy the window or just hide it to the tray.
let isQuitting = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setQuitting(v: boolean): void {
  isQuitting = v
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ProjectRose',
    icon: ICON_PATH,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: THEME_COLORS.dark.bg,
      symbolColor: THEME_COLORS.dark.fg,
      height: 36
    },
    backgroundColor: THEME_COLORS.dark.bg,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Intercept the close button: hide to tray instead of quitting. Only an
  // explicit Quit (tray menu or File → Quit, both call setQuitting(true) /
  // app.quit() which sets `before-quit`) actually destroys the window.
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

// Update title bar overlay colors when theme changes
ipcMain.on('theme:changed', (_event, theme: 'dark' | 'light' | 'herbarium') => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const colors = THEME_COLORS[theme]
    mainWindow.setTitleBarOverlay({
      color: colors.bg,
      symbolColor: colors.fg
    })
  }
})
