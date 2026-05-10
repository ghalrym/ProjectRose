import { useEffect, useRef } from 'react'
import { useStatusStore } from '../../stores/useStatusStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import { useThemeStore } from '../../stores/useThemeStore'
import { useAppsDrawerStore } from '../../stores/useAppsDrawerStore'
import { useViewStore } from '../../stores/useViewStore'
import { useDockPositionStore } from '../../stores/useDockPositionStore'
import { RoseMark } from '../TopBar/RoseMark'
import clsx from 'clsx'
import styles from './BottomDock.module.css'

const DRAG_THRESHOLD_PX = 4

function SettingsGearIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
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

  const offsetX = useDockPositionStore((s) => s.offsetX)
  const setOffsetX = useDockPositionStore((s) => s.setOffsetX)

  // Publish the offset on the document root so siblings of the dock
  // (the view area / chat panel grid columns) can react to FAB position.
  // Also publish which side the settings satellite sits on: it flips to
  // the inner side of the FAB (away from the nearer screen edge), so
  // the FAB itself sits closest to the edge and the satellite trails
  // toward the screen center.
  useEffect(() => {
    document.documentElement.style.setProperty('--fab-offset-x', `${offsetX}px`)
    document.documentElement.style.setProperty('--fab-satellite-x', offsetX > 0 ? '-26px' : '26px')
  }, [offsetX])

  const dockRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startOffset: number; moved: boolean } | null>(null)
  const justDraggedRef = useRef(false)

  // If the window shrinks, an offsetX that was valid for the previous size
  // may now place the cluster off-screen. Re-clamp on every dock resize
  // (and once on mount, in case the persisted value is out of range for
  // the current window size).
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    const reclamp = (): void => {
      const half = dock.clientWidth / 2
      const min = -half + 42
      const max = half - 42
      const current = useDockPositionStore.getState().offsetX
      const clamped = Math.max(min, Math.min(max, current))
      if (clamped !== current) setOffsetX(clamped)
    }
    reclamp()
    const observer = new ResizeObserver(reclamp)
    observer.observe(dock)
    return () => observer.disconnect()
  }, [setOffsetX])

  const onFabPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startOffset: offsetX, moved: false }
  }

  const onFabPointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const info = dragRef.current
    if (!info) return
    const dx = e.clientX - info.startX
    if (!info.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
    info.moved = true
    justDraggedRef.current = true
    const dock = dockRef.current
    if (!dock) return
    const half = dock.clientWidth / 2
    // The settings satellite sits on the inner side of the FAB (away from
    // the nearer edge), so when the cluster is dragged toward an edge the
    // FAB itself is the outermost element — 36px from the FAB center to
    // the FAB edge. Clamp symmetrically with a 6px visual margin.
    const min = -half + 42
    const max = half - 42
    const next = Math.max(min, Math.min(max, info.startOffset + dx))
    setOffsetX(next)
  }

  const onFabPointerUp = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
  }

  const consumeDragClick = (): boolean => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return true
    }
    return false
  }

  const isIdle = message === null
  const updateReady = updaterPhase === 'ready'

  // Context-sensitive shortcut:
  //   on the agent (chat) view  → button jumps to Settings (gear icon)
  //   anywhere else             → button jumps to the Agent (chat bubble icon)
  const onAgentView = activeView === 'chat'
  const shortcutTarget = onAgentView ? 'settings' : 'chat'
  const shortcutLabel = onAgentView ? 'Settings' : 'Agent'

  const onFabClick = (): void => {
    if (consumeDragClick()) return
    toggleDrawer()
  }

  const onSettingsClick = (): void => {
    if (consumeDragClick()) return
    closeDrawer()
    setActiveView(shortcutTarget)
  }

  return (
    <div ref={dockRef} className={styles.dock}>
      <div className={styles.topGlow} />

      <div className={styles.fabRow} aria-hidden="true" />

      <button
        type="button"
        className={clsx(styles.fab, drawerOpen && styles.fabActive)}
        onClick={onFabClick}
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        onPointerCancel={onFabPointerUp}
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
        onClick={onSettingsClick}
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        onPointerCancel={onFabPointerUp}
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
