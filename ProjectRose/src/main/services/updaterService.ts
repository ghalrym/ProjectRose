import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '../../shared/ipcChannels'

const ONE_HOUR_MS = 60 * 60 * 1000

let initialized = false

const STATE_FILE = join(app.getPath('userData'), 'updater.json')

interface UpdaterState {
  skippedVersions: string[]
}

async function readState(): Promise<UpdaterState> {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    const skipped = Array.isArray(parsed?.skippedVersions) ? parsed.skippedVersions.filter((v: unknown) => typeof v === 'string') : []
    return { skippedVersions: skipped }
  } catch {
    return { skippedVersions: [] }
  }
}

async function writeState(state: UpdaterState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function initAutoUpdater(): void {
  if (initialized) return
  if (!app.isPackaged) {
    log.info('[updater] skipping autoUpdater: dev mode')
    return
  }
  if (process.platform === 'darwin') {
    log.info('[updater] skipping autoUpdater: macOS not signed/notarized')
    return
  }

  initialized = true

  log.transports.file.level = 'info'
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', async (info: UpdateInfo) => {
    const { skippedVersions } = await readState()
    if (skippedVersions.includes(info.version)) {
      log.info(`[updater] update v${info.version} is skipped by user; ignoring`)
      return
    }
    broadcast(IPC.UPDATER_AVAILABLE, {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('download-progress', (info: ProgressInfo) => {
    broadcast(IPC.UPDATER_PROGRESS, {
      percent: info.percent,
      bytesPerSecond: info.bytesPerSecond,
      transferred: info.transferred,
      total: info.total
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    broadcast(IPC.UPDATER_DOWNLOADED, {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('error', (err: Error) => {
    broadcast(IPC.UPDATER_ERROR, { message: err?.message ?? String(err) })
  })

  void autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[updater] initial check failed', err)
  })
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[updater] periodic check failed', err)
    })
  }, ONE_HOUR_MS)
}

export async function checkForUpdatesNow(): Promise<void> {
  if (!initialized) return
  await autoUpdater.checkForUpdates()
}

export async function downloadUpdateNow(): Promise<void> {
  if (!initialized) return
  await autoUpdater.downloadUpdate()
}

export function installUpdateAndRestart(): void {
  if (!initialized) return
  autoUpdater.quitAndInstall()
}

export async function skipVersion(version: string): Promise<void> {
  const state = await readState()
  if (state.skippedVersions.includes(version)) return
  state.skippedVersions.push(version)
  await writeState(state)
  log.info(`[updater] user skipped v${version}`)
}
