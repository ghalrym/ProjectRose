import { useStatusStore } from '../../stores/useStatusStore'
import { useUpdaterStore } from '../../stores/useUpdaterStore'
import styles from './StatusBar.module.css'

export function StatusBar(): JSX.Element {
  const message = useStatusStore((s) => s.message)
  const tone = useStatusStore((s) => s.tone)
  const updaterPhase = useUpdaterStore((s) => s.phase)
  const updaterVersion = useUpdaterStore((s) => s.version)
  const showUpdaterModal = useUpdaterStore((s) => s.showModal)

  const isIdle = message === null
  const dotClass = `${styles.dot} ${styles[`dot_${tone}`]}`
  const updateReady = updaterPhase === 'ready'

  return (
    <div className={styles.statusBar}>
      <span className={isIdle ? styles.idle : styles.message} key={message ?? 'idle'}>
        <span className={isIdle ? styles.dotIdle : dotClass} />
        {isIdle ? 'Ready' : message}
      </span>
      <div className={styles.right}>
        {updateReady && (
          <button
            type="button"
            className={styles.updateBadge}
            onClick={showUpdaterModal}
            title={`Restart to install v${updaterVersion ?? ''}`}
          >
            <span className={styles.updateDot} />
            Update ready
          </button>
        )}
        <span className={styles.brand}>ROSE</span>
        <span className={styles.version}>v{__APP_VERSION__}</span>
      </div>
    </div>
  )
}
