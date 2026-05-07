import { useViewStore } from '../../stores/useViewStore'
import { useStatusStore } from '../../stores/useStatusStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import { useThemeStore } from '../../stores/useThemeStore'
import { RoseMark } from '../TopBar/RoseMark'
import clsx from 'clsx'
import styles from './BottomDock.module.css'

export function BottomDock(): JSX.Element {
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

  return (
    <div className={styles.dock}>
      <div className={styles.topGlow} />

      <div className={styles.fabRow} aria-hidden="true" />

      <button
        type="button"
        className={styles.fab}
        onClick={() => setActiveView('apps')}
        title="Open apps"
        aria-label="Open apps"
      >
        <span className={styles.fabBreathRing} />
        <RoseMark size={32} />
      </button>
      <div className={styles.fabLabel} aria-hidden="true">APP</div>

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
