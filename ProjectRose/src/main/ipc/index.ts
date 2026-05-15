import { registerFileHandlers } from './fileHandlers'
import { registerDialogHandlers } from './dialogHandlers'
import { registerTerminalHandlers } from './terminalHandlers'
import { registerProjectHandlers } from './projectHandlers'
import { registerLspHandlers } from './lspHandlers'
import { registerAiHandlers } from './aiHandlers'
import { registerRoseSetupHandlers } from './roseSetupHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerWhisperHandlers } from './whisperHandlers'
import { registerActiveSpeechHandlers } from './activeSpeechHandlers'
import { registerProjectSettingsHandlers } from './projectSettingsHandlers'
import { registerExtensionHandlers } from './extensionHandlers'
import { registerAuthHandlers } from './authHandlers'
import { registerSkillHandlers } from './skillHandlers'
import { registerUpdaterHandlers } from './updaterHandlers'
import { registerPromptHandlers } from './promptHandlers'
import { registerScreenHandlers } from './screenHandlers'

import { sessionIpc } from '../services/sessionService.ipc'
import { listSessions, loadSession, saveSession, deleteSession } from '../services/sessionService'

export function registerAllHandlers(): void {
  registerFileHandlers()
  registerDialogHandlers()
  registerTerminalHandlers()
  registerProjectHandlers()
  registerLspHandlers()
  registerAiHandlers()
  registerRoseSetupHandlers()
  registerSettingsHandlers()
  registerWhisperHandlers()
  registerActiveSpeechHandlers()
  registerProjectSettingsHandlers()
  registerExtensionHandlers()
  registerAuthHandlers()
  registerSkillHandlers()
  registerUpdaterHandlers()
  registerPromptHandlers()
  registerScreenHandlers()
}

// Wires up every typed-manifest namespace. Coexists with registerAllHandlers
// for the duration of the migration; each slice moves one service from the
// switchboard above into this one.
export function registerIpcManifests(): void {
  sessionIpc.register({
    list: listSessions,
    load: loadSession,
    save: saveSession,
    delete: deleteSession
  })
}
