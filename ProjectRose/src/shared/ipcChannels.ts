export const IPC = {
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',

  TERMINAL_SPAWN: 'terminal:spawn',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DISPOSE: 'terminal:dispose',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  WATCHER_CHANGE: 'watcher:change',

  PROJECTS_GET_RECENT: 'projects:getRecent',
  PROJECTS_ADD_RECENT: 'projects:addRecent',
  PROJECTS_REMOVE_RECENT: 'projects:removeRecent',
  PROJECTS_GET_DEFAULT_PATH: 'projects:getDefaultPath',

  APP_QUIT: 'app:quit',

  ROSE_CHECK_MD: 'rose:checkMd',
  ROSE_INIT_PROJECT: 'rose:initProject',
  ROSE_ENSURE_SCAFFOLD: 'rose:ensureScaffold',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  HEALTH_CHECK_ALL: 'health:checkAll',

  WHISPER_TRANSCRIBE: 'whisper:transcribe',

  INDEXING_PROJECT: 'indexing:project',
  INDEXING_PROGRESS: 'indexing:progress',

  AI_CHAT: 'ai:chat',
  AI_CONTEXT_STATUS: 'ai:contextStatus',
  AI_COMPRESS_TOOL_NOISE: 'ai:compressToolNoise',
  AI_GET_SYSTEM_PROMPT: 'ai:getSystemPrompt',
  AI_MODEL_SELECTED: 'ai:modelSelected',
  AI_STREAM_RESET: 'ai:streamReset',
  AI_FILE_MODIFIED: 'ai:fileModified',
  AI_TOOL_CALL_START: 'ai:toolCallStart',
  AI_TOOL_CALL_END: 'ai:toolCallEnd',
  AI_THINKING: 'ai:thinking',
  AI_TOKEN: 'ai:token',
  AI_CANCEL: 'ai:cancel',
  AI_ASK_USER: 'ai:askUser',
  AI_ASK_USER_RESPONSE: 'ai:askUserResponse',
  AI_INJECTED_MESSAGE: 'ai:injectedMessage',
  AI_CAPTURE_SCREENSHOT: 'ai:captureScreenshot',
  AI_CAPTURE_SCREENSHOT_RESULT: 'ai:captureScreenshotResult',

  LSP_PY_TO_SERVER: 'lsp:py:toServer',
  LSP_PY_FROM_SERVER: 'lsp:py:fromServer',
  LSP_TS_TO_SERVER: 'lsp:ts:toServer',
  LSP_TS_FROM_SERVER: 'lsp:ts:fromServer',
  LSP_STARTED: 'lsp:started',
  LSP_STOPPED: 'lsp:stopped',

  // Extensions
  EXTENSION_LIST: 'extension:list',
  EXTENSION_INSTALL_FROM_GIT: 'extension:installFromGit',
  EXTENSION_INSTALL_FROM_DISK: 'extension:installFromDisk',
  // Two-step install: preview reads the manifest from a temp clone/copy and
  // returns it without finalising. The renderer shows the user what the
  // extension declares it'll do, then either confirms (build + move into
  // place) or cancels (delete temp).
  EXTENSION_INSTALL_PREVIEW_FROM_GIT: 'extension:installPreviewFromGit',
  EXTENSION_INSTALL_PREVIEW_FROM_DISK: 'extension:installPreviewFromDisk',
  EXTENSION_INSTALL_CONFIRM: 'extension:installConfirm',
  EXTENSION_INSTALL_CANCEL: 'extension:installCancel',
  EXTENSION_UNINSTALL: 'extension:uninstall',
  EXTENSION_ENABLE: 'extension:enable',
  EXTENSION_DISABLE: 'extension:disable',
  EXTENSION_LOAD_RENDERER: 'extension:loadRenderer',
  EXTENSION_LOAD_MAIN: 'extension:loadMain',

  // Skills (SKILLS_UPLOAD stays — dialog needs to anchor to the caller window;
  // list and delete are now declared via services/skillService.ipc.ts.)
  SKILLS_UPLOAD: 'skills:upload',

  // Account auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_CANCEL: 'auth:cancel',
  AUTH_GET_STATUS: 'auth:getStatus',
  AUTH_GET_USAGE: 'auth:getUsage',
  AUTH_CHANGED: 'auth:changed',
  AUTH_PAIRING_PENDING: 'auth:pairingPending',

  // Active Listening — session lifecycle
  ACTIVE_LISTENING_OPEN_SESSION: 'activeSpeech:openSession',
  ACTIVE_LISTENING_SEND_CHUNK: 'activeSpeech:sendChunk',
  ACTIVE_LISTENING_CLOSE_SESSION: 'activeSpeech:closeSession',
  ACTIVE_LISTENING_DRAFT: 'activeSpeech:draft',
  ACTIVE_LISTENING_CANCEL_DRAFT: 'activeSpeech:cancelDraft',

  // Speaker management + session history
  ACTIVE_LISTENING_LABEL_SPEAKER: 'activeSpeech:labelSpeaker',
  ACTIVE_LISTENING_TRAIN: 'activeSpeech:train',
  ACTIVE_LISTENING_TRAIN_STATUS: 'activeSpeech:trainStatus',
  ACTIVE_LISTENING_TRAIN_HISTORY: 'activeSpeech:trainHistory',
  ACTIVE_LISTENING_GET_SPEAKERS: 'activeSpeech:getSpeakers',
  ACTIVE_LISTENING_CREATE_SPEAKER: 'activeSpeech:createSpeaker',
  ACTIVE_LISTENING_ADD_SAMPLE: 'activeSpeech:addSample',
  ACTIVE_LISTENING_GET_UTTERANCES: 'activeSpeech:getUtterances',
  ACTIVE_LISTENING_GET_SESSIONS: 'activeSpeech:getSessions',
  ACTIVE_LISTENING_UTTERANCE: 'activeSpeech:utterance',

  // Screen / window capture for chat share-screen
  SCREEN_GET_SOURCES: 'screen:getSources',
  SCREEN_SET_ACTIVE_SOURCE: 'screen:setActiveSource',

  // Status bar notifications (main → renderer)
  STATUS_NOTIFY: 'status:notify',

  // Auto-updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_SKIP_VERSION: 'updater:skipVersion',
  UPDATER_AVAILABLE: 'updater:available',
  UPDATER_NOT_AVAILABLE: 'updater:notAvailable',
  UPDATER_PROGRESS: 'updater:progress',
  UPDATER_DOWNLOADED: 'updater:downloaded',
  UPDATER_ERROR: 'updater:error',

  // Tray (main → renderer)
  TRAY_OPEN_CHAT: 'tray:openChat',
  TRAY_TOGGLE_LISTENING: 'tray:toggleListening',
  // Tray (renderer → main): renderer pushes the live `isActive` value so the
  // tray menu and icon stay in sync without main needing to introspect store.
  LISTENING_STATE_CHANGED: 'tray:listeningStateChanged',

  // Deep link (projectrose://...) delivered from main to renderer. On macOS
  // this fires from `app.on('open-url')`; Windows/Linux delivery via argv is
  // a follow-up.
  DEEPLINK_RECEIVED: 'deeplink:received'
} as const
