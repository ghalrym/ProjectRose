import { useEffect, useCallback, useState } from 'react'
import { TopBar } from './components/TopBar/TopBar'
import { FileActions } from './components/TopBar/FileActions'
import { EditorView } from './components/EditorView/EditorView'
import { ChatView } from './components/ChatView/ChatView'
import { ChatPanel } from './components/ChatView/ChatPanel'
import { SettingsView } from './components/SettingsView/SettingsView'
import { AccountView } from './components/AccountView/AccountView'
import { AppsDrawer } from './components/AppsDrawer/AppsDrawer'
import { WelcomeView } from './components/WelcomeView/WelcomeView'
import { SetupWizard } from './components/SetupWizard/SetupWizard'
import { BottomDock } from './components/BottomDock/BottomDock'
import { UpdateToast } from './components/UpdateToast'
import { getExtensionByViewId, loadDynamicExtensions, subscribeToExtensionsChange } from './extensions/registry'
import { useThemeStore } from './stores/useThemeStore'
import { useViewStore } from './stores/useViewStore'
import { useActiveListeningStore } from './stores/useActiveListeningStore'
import { useFileStore } from './stores/useFileStore'
import { useProjectStore } from './stores/useProjectStore'
import { useIndexingStore } from './stores/useIndexingStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useServiceStore } from './stores/useServiceStore'
import { useStatusStore } from './stores/useStatusStore'
import { useUpdaterStore } from './stores/useUpdaterStore'
import { useScreenWebcamShare } from './hooks/useScreenWebcamShare'
import styles from './App.module.css'

function App(): JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const activeView = useViewStore((s) => s.activeView)
  const rootPath = useProjectStore((s) => s.rootPath)
  const openFile = useFileStore((s) => s.openFile)
  const saveActiveFile = useFileStore((s) => s.saveActiveFile)
  const createNewFile = useFileStore((s) => s.createNewFile)
  const openFolder = useProjectStore((s) => s.openFolder)
  const refreshTree = useProjectStore((s) => s.refreshTree)
  const toggleTerminal = useViewStore((s) => s.toggleTerminal)

  const { load: loadSettings } = useSettingsStore()
  const setServiceStatus = useServiceStore((s) => s.setStatus)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [, setExtVersion] = useState(0)

  // Speech is now in-process — always available
  useEffect(() => {
    setServiceStatus(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Bridge: when the agent invokes the `screenshot` tool, capture a frame from
  // the active share stream and send it back to main.
  useEffect(() => {
    return window.api.onAiCaptureScreenshot(async ({ requestId }) => {
      const share = useScreenWebcamShare.getState()
      if (share.mode === 'off') {
        await window.api.aiCaptureScreenshotResult(requestId, {
          ok: false,
          reason: 'The user is not currently sharing a screen, window, or camera. Ask them to enable screen-share or camera in the chat composer first.'
        })
        return
      }
      const frame = await share.captureFrame()
      if (!frame) {
        await window.api.aiCaptureScreenshotResult(requestId, {
          ok: false,
          reason: 'Capture failed (stream not ready).'
        })
        return
      }
      await window.api.aiCaptureScreenshotResult(requestId, {
        ok: true,
        dataUrl: frame.dataUrl,
        mode: frame.kind,
        sourceLabel: share.sourceLabel
      })
    })
  }, [])

  // Re-render when dynamic extensions finish loading
  useEffect(() => subscribeToExtensionsChange(() => setExtVersion((v) => v + 1)), [])

  // Load dynamic (third-party) extensions whenever the project changes
  useEffect(() => {
    loadDynamicExtensions(rootPath ?? '').catch(console.error)
  }, [rootPath])

  // Load persisted settings on mount
  useEffect(() => { loadSettings() }, [loadSettings])

  // Reload settings when a project is opened to merge in repo config
  useEffect(() => { if (rootPath) loadSettings() }, [rootPath, loadSettings])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.api.setNativeTheme(theme)
  }, [theme])

  // Subscribe once to indexing progress events from the main process.
  useEffect(() => {
    const cleanup = window.api.onIndexingProgress((p) => {
      useIndexingStore.getState().setProgress(p)
    })
    return cleanup
  }, [])

  // Subscribe once to status notifications from the main process (e.g. extensions).
  useEffect(() => {
    const cleanup = window.api.onStatusNotify(({ text, tone, durationMs }) => {
      useStatusStore.getState().notify(text, { tone, durationMs })
    })
    return cleanup
  }, [])

  // Subscribe once to auto-updater events from the main process.
  useEffect(() => {
    const store = useUpdaterStore.getState
    const cleanups = [
      window.api.updater.onAvailable((info) => store().setAvailable(info)),
      window.api.updater.onProgress((info) => store().setProgress(info.percent)),
      window.api.updater.onDownloaded((info) => store().setDownloaded(info)),
      window.api.updater.onError((info) => store().setError(info.message))
    ]
    return () => cleanups.forEach((c) => c())
  }, [])

  // Check for ROSE.md when a project is opened; trigger wizard if missing.
  // If already initialized, ensure scaffold directories exist (recreates any that were deleted).
  useEffect(() => {
    if (!rootPath) {
      setNeedsSetup(false)
      return
    }
    window.api.checkRoseMd(rootPath).then((hasMd) => {
      setNeedsSetup(!hasMd)
      if (hasMd) window.api.ensureScaffold(rootPath).catch(() => {})
    })
  }, [rootPath])

  // Poll the file tree every minute to catch external changes.
  useEffect(() => {
    if (!rootPath) return
    const interval = setInterval(() => refreshTree(), 60 * 1000)
    return () => clearInterval(interval)
  }, [rootPath, refreshTree])

  const handleOpenFolder = useCallback(async () => {
    const path = await window.api.openFolderDialog()
    if (path) openFolder(path)
  }, [openFolder])

  const handleOpenFile = useCallback(async () => {
    const path = await window.api.openFileDialog()
    if (path) openFile(path)
  }, [openFile])

  // Listen for native menu events
  useEffect(() => {
    const cleanups = [
      window.api.onMenuNewFile(() => createNewFile()),
      window.api.onMenuOpenFile(() => handleOpenFile()),
      window.api.onMenuOpenFolder(() => handleOpenFolder()),
      window.api.onMenuSave(() => saveActiveFile()),
      window.api.onTrayOpenChat(() => useViewStore.getState().setActiveView('chat')),
      window.api.onTrayToggleListening(() => {
        const s = useActiveListeningStore.getState()
        s.setActive(!s.isActive)
      })
    ]
    return () => cleanups.forEach((c) => c())
  }, [createNewFile, handleOpenFile, handleOpenFolder, saveActiveFile])

  // Push isActive changes to main so the tray icon/menu stay in sync. Also
  // fire once on mount so a freshly-opened tray reflects the current value.
  useEffect(() => {
    window.api.notifyListeningStateChanged(useActiveListeningStore.getState().isActive)
    return useActiveListeningStore.subscribe((state, prev) => {
      if (state.isActive !== prev.isActive) {
        window.api.notifyListeningStateChanged(state.isActive)
      }
    })
  }, [])

  // Keyboard shortcut for terminal toggle
  useEffect(() => {
    if (!rootPath) return

    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        toggleTerminal()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rootPath, toggleTerminal])

  // Welcome screen when no project is open
  if (!rootPath) {
    return (
      <div className={styles.app}>
        <div className={styles.titleBar} />
        <WelcomeView onOpenFolder={handleOpenFolder} />
        <AppsDrawer />
        <BottomDock />
        <UpdateToast />
      </div>
    )
  }

  return (
    <div className={styles.app}>
      <div className={styles.titleBar} />
      <TopBar />
      {needsSetup && (
        <SetupWizard
          rootPath={rootPath}
          onComplete={() => { setNeedsSetup(false); refreshTree() }}
        />
      )}
      {activeView === 'editor' && (
        <div className={styles.toolbar}>
          <FileActions
            onOpenFolder={handleOpenFolder}
            onOpenFile={handleOpenFile}
            onNewFile={createNewFile}
            onSave={saveActiveFile}
          />
        </div>
      )}
      <main className={`${styles.mainContent} ${activeView === 'chat' ? styles.mainContentChat : ''}`}>
        <div className={styles.viewArea}>
          {activeView === 'editor' && <EditorView />}
          {activeView === 'chat' && <ChatView />}
          {activeView === 'settings' && <SettingsView />}
          {activeView === 'account' && <AccountView />}
          {(() => {
            const ext = getExtensionByViewId(activeView)
            return ext?.PageView ? <ext.PageView /> : null
          })()}
        </div>
        {activeView !== 'chat' && <ChatPanel />}
      </main>
      <AppsDrawer />
      <BottomDock />
      <UpdateToast />
    </div>
  )
}

export default App
