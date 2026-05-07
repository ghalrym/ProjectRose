import { useStatusStore } from '../../stores/useStatusStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import { useThemeStore } from '../../stores/useThemeStore'
import { useAppsDrawerStore } from '../../stores/useAppsDrawerStore'
import { useViewStore } from '../../stores/useViewStore'
import { RoseMark } from '../TopBar/RoseMark'
import clsx from 'clsx'
import styles from './BottomDock.module.css'

function SettingsGearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.6 5.6 L7.7 7.7 M16.3 16.3 L18.4 18.4 M5.6 18.4 L7.7 16.3 M16.3 7.7 L18.4 5.6" opacity="0.75" />
    </svg>
  )
}

function AgentChatIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6 H20 A1.5 1.5 0 0 1 21.5 7.5 V15 A1.5 1.5 0 0 1 20 16.5 H10.5 L6 20 V16.5 A1.5 1.5 0 0 1 4 15 V7.5 A1.5 1.5 0 0 1 4 6 Z" />
      <path d="M8 10.5 H16 M8 13 H13.5" opacity="0.75" />
    </svg>
  )
}

export function BottomDock(): JSX.Element {
  const drawerOpen = useAppsDrawerStore((s) => s.open)
  const toggleDrawer = useAppsDrawerStore((s) => s.toggle)
  const closeDrawer = useAppsDrawerStore((s) => s.close)

  const activeView = useViewStore((s) => s.activeView)
  const setActiveView = useViewStore((s) => s.setActiveView)

  const message = useStatusStore((s) => s.message)
  const tone = useStatusStore((s) => s.tone)
  const updaterPhase = useUpdaterStore((s) => s.phase)
  const updaterVersion = useUpdaterStore((s) => s.version)
  const showUpdaterToast = useUpdaterStore((s) => s.showToast)

  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  const isIdle = message === null
  const updateReady = updaterPhase === 'ready'

  // Context-sensitive shortcut:
  //   on the agent (chat) view  → button jumps to Settings (gear icon)
  //   anywhere else             → button jumps to the Agent (chat bubble icon)
  const onAgentView = activeView === 'chat'
  const shortcutTarget = onAgentView ? 'settings' : 'chat'
  const shortcutLabel = onAgentView ? 'Settings' : 'Agent'

  const openShortcut = (): void => {
    closeDrawer()
    setActiveView(shortcutTarget)
  }

  return (
    <div className={styles.dock}>
      <div className={styles.topGlow} />

      <div className={styles.fabRow} aria-hidden="true" />

      <button
        type="button"
        className={clsx(styles.fab, drawerOpen && styles.fabActive)}
        onClick={toggleDrawer}
        title={drawerOpen ? 'Close apps' : 'Open apps'}
        aria-label={drawerOpen ? 'Close apps' : 'Open apps'}
        aria-expanded={drawerOpen}
      >
        <span className={styles.fabBreathRing} />
        <RoseMark size={32} />
      </button>

      <button
        type="button"
        className={styles.settingsFab}
        onClick={openShortcut}
        title={shortcutLabel}
        aria-label={shortcutLabel}
      >
        {onAgentView ? <SettingsGearIcon /> : <AgentChatIcon />}
      </button>

      <div className={styles.statusRow}>
        <span className={clsx(styles.statusMessage, isIdle && styles.statusIdle)} key={message ?? 'idle'}>
          <span className={clsx(styles.statusDot, !isIdle && styles[`tone_${tone}`])} />
          {isIdle ? 'READY' : message}
        </span>

        {updateReady && (
          <>
            <span className={styles.sep}>│</span>
            <button
              type="button"
              className={styles.updateBadge}
              onClick={showUpdaterToast}
              title={`Restart to install v${updaterVersion ?? ''}`}
            >
              <span className={styles.updateDot} />
              UPDATE READY
            </button>
          </>
        )}

        <div className={styles.spacer} />

        <button
          type="button"
          className={styles.themePill}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Herbarium' : 'Switch to Dark'}
        >
          {theme === 'dark' ? '☽ DARK' : '☀ PAPER'}
        </button>
        <span className={styles.sep}>│</span>
        <span className={styles.brand}>ROSE</span>
        <span className={styles.version}>v{__APP_VERSION__}</span>
      </div>
    </div>
  )
}
