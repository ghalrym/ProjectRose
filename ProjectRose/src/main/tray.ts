import { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain } from 'electron'
import type { NativeImage } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/ipcChannels'
import { createWindow, getMainWindow, setQuitting } from './window'

let tray: Tray | null = null
let baseIcon: NativeImage | null = null
let listeningIcon: NativeImage | null = null
let isListening = false

function pickIconPath(): string {
  return process.platform === 'win32'
    ? join(__dirname, '../../build/icon.ico')
    : join(__dirname, '../../build/icon.png')
}

// Composites a red dot in the upper-left corner of the source icon and returns
// a new NativeImage. Pixel format from `toBitmap()` is BGRA on Windows/Linux
// and on macOS — using full red (B=0,G=0,R=255) is unambiguous either way.
//
// Falls back to the base icon if the bitmap can't be produced (e.g. .ico
// formats that nativeImage can't unpack on some Electron versions).
function makeListeningIcon(base: NativeImage): NativeImage {
  try {
    const size = base.getSize()
    if (size.width === 0 || size.height === 0) return base

    // Resize to a tray-friendly size first so the dot has a consistent
    // proportion regardless of the source resolution.
    const target = 32
    const resized = base.resize({ width: target, height: target, quality: 'best' })
    const bmp = Buffer.from(resized.toBitmap())

    const r = Math.floor(target / 4)        // dot radius
    const cx = r + 1                         // upper-left placement
    const cy = r + 1
    const r2 = r * r
    const ringInner = (r - 1) * (r - 1)      // optional white ring
    const ringOuter = (r + 1) * (r + 1)

    for (let y = 0; y < target; y++) {
      for (let x = 0; x < target; x++) {
        const dx = x - cx
        const dy = y - cy
        const d2 = dx * dx + dy * dy
        const idx = (y * target + x) * 4
        if (d2 <= r2) {
          // Solid red fill (BGRA-safe — high red, low green, low blue)
          bmp[idx] = 0x20      // B
          bmp[idx + 1] = 0x20  // G
          bmp[idx + 2] = 0xff  // R
          bmp[idx + 3] = 0xff  // A
        } else if (d2 <= ringOuter && d2 > ringInner) {
          // Thin dark ring for contrast against bright icons
          bmp[idx] = 0x00
          bmp[idx + 1] = 0x00
          bmp[idx + 2] = 0x00
          bmp[idx + 3] = 0xff
        }
      }
    }

    return nativeImage.createFromBuffer(bmp, {
      width: target,
      height: target,
      scaleFactor: 1
    })
  } catch {
    return base
  }
}

function ensureWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    if (!existing.isVisible()) existing.show()
    existing.focus()
    return existing
  }
  return createWindow()
}

function sendToRenderer(channel: string): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send(channel))
  } else {
    win.webContents.send(channel)
  }
}

function showAndOpenChat(): void {
  ensureWindow()
  sendToRenderer(IPC.TRAY_OPEN_CHAT)
}

function toggleListening(): void {
  // The renderer owns the truth (mic permission, audio stream, store state).
  // Just request a flip — the renderer will reply via LISTENING_STATE_CHANGED
  // which calls setListeningState() and triggers the icon/menu refresh.
  ensureWindow()
  sendToRenderer(IPC.TRAY_TOGGLE_LISTENING)
}

function quitApp(): void {
  setQuitting(true)
  app.quit()
}

function buildContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open Chat',
      click: () => showAndOpenChat()
    },
    {
      label: 'Active Listening',
      type: 'checkbox',
      checked: isListening,
      click: () => toggleListening()
    },
    { type: 'separator' },
    {
      label: 'Quit ProjectRose',
      click: () => quitApp()
    }
  ])
}

function refreshTrayPresentation(): void {
  if (!tray || tray.isDestroyed()) return
  const icon = isListening && listeningIcon ? listeningIcon : baseIcon
  if (icon) tray.setImage(icon)
  tray.setToolTip(isListening ? 'ProjectRose · listening' : 'ProjectRose')
  tray.setContextMenu(buildContextMenu())
}

export function setListeningState(active: boolean): void {
  if (isListening === active) return
  isListening = active
  refreshTrayPresentation()
}

export function createTray(): Tray {
  const raw = nativeImage.createFromPath(pickIconPath())
  // macOS menu-bar icons should be ~22pt and rendered as template images so
  // they automatically invert in dark mode. The 1024×1024 source is way too
  // big for the menu bar otherwise.
  if (process.platform === 'darwin') {
    baseIcon = raw.resize({ width: 22, height: 22, quality: 'best' })
    baseIcon.setTemplateImage(true)
  } else {
    baseIcon = raw
  }
  listeningIcon = makeListeningIcon(baseIcon)
  if (process.platform === 'darwin') listeningIcon.setTemplateImage(true)

  tray = new Tray(baseIcon)
  refreshTrayPresentation()

  if (process.platform !== 'darwin') {
    tray.on('click', () => ensureWindow())
  }

  // Renderer reports its current isActive whenever it flips. Wire once.
  ipcMain.on(IPC.LISTENING_STATE_CHANGED, (_event, payload: { active: boolean }) => {
    setListeningState(!!payload?.active)
  })

  return tray
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
  }
  tray = null
  ipcMain.removeAllListeners(IPC.LISTENING_STATE_CHANGED)
}
