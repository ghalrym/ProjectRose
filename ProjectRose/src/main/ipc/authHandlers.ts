import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { openAuthWindow, handleLogout, getAuthStatus, cancelPairing } from '../lib/authHandler'

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC.AUTH_LOGIN, async () => {
    try {
      await openAuthWindow()
    } catch (err) {
      // Surface a structured error to the renderer so the AccountView
      // can drop the pairing-pending state and show the message.
      const message = err instanceof Error ? err.message : 'Sign-in failed'
      throw new Error(message)
    }
  })

  ipcMain.handle(IPC.AUTH_LOGOUT, async () => {
    await handleLogout()
  })

  ipcMain.handle(IPC.AUTH_CANCEL, async () => {
    cancelPairing()
  })

  ipcMain.handle(IPC.AUTH_GET_STATUS, async () => {
    return getAuthStatus()
  })
}
