import { registerDialogHandlers } from './dialogHandlers'
import { registerTerminalHandlers } from './terminalHandlers'
import { registerAppHandlers } from './appHandlers'
import { registerLspHandlers } from './lspHandlers'
import { registerAiHandlers } from './aiHandlers'
import { registerWhisperHandlers } from './whisperHandlers'
import { registerActiveSpeechHandlers } from './activeSpeechHandlers'
import { registerExtensionHandlers } from './extensionHandlers'
import { registerAuthHandlers } from './authHandlers'
import { registerSkillHandlers } from './skillHandlers'
import { registerUpdaterHandlers } from './updaterHandlers'
import { registerScreenHandlers } from './screenHandlers'

import { sessionIpc } from '../services/sessionService.ipc'
import { listSessions, loadSession, saveSession, deleteSession } from '../services/sessionService'

import { promptIpc } from '../services/promptService.ipc'
import {
  readRosePrompt,
  writeRosePrompt,
  listExtensionPrompts,
  readExtensionPrompt,
  writeExtensionPrompt,
  resetExtensionPrompt
} from '../services/promptService'

import { skillIpc } from '../services/skillService.ipc'
import { listSkills, deleteSkill } from '../services/skillService'

import { fileIpc } from '../services/fileService.ipc'
import {
  readFileContent,
  writeFileContent,
  createFile,
  deleteFile,
  deleteDirectory,
  renameEntry,
  createDirectory,
  readDirectoryTree
} from '../services/fileService'

import { recentProjectsIpc } from '../services/recentProjects.ipc'
import {
  getRecentProjects,
  addRecentProject,
  removeRecentProject,
  getDefaultProjectPath
} from '../services/recentProjects'

import { settingsIpc, healthIpc } from '../services/settingsService.ipc'
import { readSettings, applySettingsPatch, checkServicesHealth } from '../services/settingsService'

import { projectSettingsIpc, toolsIpc } from '../services/projectSettingsService.ipc'
import { readProjectSettings, writeProjectSettings, listTools } from '../services/projectSettingsService'

import { roseSetupIpc } from '../services/roseSetupService.ipc'
import { checkRoseMd, initRoseProject, ensureRoseScaffold } from '../services/roseSetupService'

export function registerAllHandlers(): void {
  registerDialogHandlers()
  registerTerminalHandlers()
  registerAppHandlers()
  registerLspHandlers()
  registerAiHandlers()
  registerWhisperHandlers()
  registerActiveSpeechHandlers()
  registerExtensionHandlers()
  registerAuthHandlers()
  registerSkillHandlers()
  registerUpdaterHandlers()
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
  promptIpc.register({
    readRose: readRosePrompt,
    writeRose: writeRosePrompt,
    listExtension: listExtensionPrompts,
    readExtension: readExtensionPrompt,
    writeExtension: writeExtensionPrompt,
    resetExtension: resetExtensionPrompt
  })
  skillIpc.register({
    list: listSkills,
    delete: deleteSkill
  })
  fileIpc.register({
    read: readFileContent,
    write: ({ filePath, content }) => writeFileContent(filePath, content),
    create: createFile,
    delete: deleteFile,
    deleteDir: deleteDirectory,
    rename: ({ oldPath, newPath }) => renameEntry(oldPath, newPath),
    createDir: createDirectory,
    readDirTree: readDirectoryTree
  })
  recentProjectsIpc.register({
    getRecent: getRecentProjects,
    addRecent: addRecentProject,
    removeRecent: removeRecentProject,
    getDefaultPath: getDefaultProjectPath
  })
  settingsIpc.register({
    get: readSettings,
    set: applySettingsPatch
  })
  healthIpc.register({
    checkAll: checkServicesHealth
  })
  projectSettingsIpc.register({
    getSettings: readProjectSettings,
    setSettings: writeProjectSettings
  })
  toolsIpc.register({
    list: listTools
  })
  roseSetupIpc.register({
    checkMd: checkRoseMd,
    initProject: initRoseProject,
    ensureScaffold: ensureRoseScaffold
  })
}
