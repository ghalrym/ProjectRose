import { ipcMain, desktopCapturer, session, webContents, type DesktopCapturerSource } from 'electron'
import { IPC } from '../../shared/ipcChannels'

export interface ScreenSourceInfo {
  id: string
  name: string
  displayId: string
  thumbnailDataURL: string
  appIconDataURL: string | null
}

const activeSourceByWebContents = new Map<number, string>()

export function registerScreenHandlers(): void {
  ipcMain.handle(IPC.SCREEN_GET_SOURCES, async (): Promise<ScreenSourceInfo[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    })
    return sources.map((s: DesktopCapturerSource) => ({
      id: s.id,
      name: s.name,
      displayId: s.display_id ?? '',
      thumbnailDataURL: s.thumbnail.toDataURL(),
      appIconDataURL: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }))
  })

  ipcMain.handle(IPC.SCREEN_SET_ACTIVE_SOURCE, (event, sourceId: string | null): void => {
    if (!sourceId) {
      activeSourceByWebContents.delete(event.sender.id)
      return
    }
    activeSourceByWebContents.set(event.sender.id, sourceId)
  })
}

export function attachDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const wc = request.frame ? webContents.fromFrame(request.frame) : null
    let sourceId = wc ? activeSourceByWebContents.get(wc.id) : undefined
    if (!sourceId && activeSourceByWebContents.size === 1) {
      sourceId = activeSourceByWebContents.values().next().value
    }
    if (!sourceId) {
      callback({})
      return
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    const match = sources.find((s) => s.id === sourceId)
    callback(match ? { video: match } : {})
  })
}
