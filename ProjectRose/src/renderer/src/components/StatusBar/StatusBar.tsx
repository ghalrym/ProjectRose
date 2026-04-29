import { useStatusStore } from '../../stores/useStatusStore'
import styles from './StatusBar.module.css'

export function StatusBar(): JSX.Element {
  const message = useStatusStore((s) => s.message)
  const tone = useStatusStore((s) => s.tone)

  const isIdle = message === null
  const dotClass = `${styles.dot} ${styles[`dot_${tone}`]}`

  return (
    <div className={styles.statusBar}>
      <span className={isIdle ? styles.idle : styles.message} key={message ?? 'idle'}>
        <span className={isIdle ? styles.dotIdle : dotClass} />
        {isIdle ? 'Ready' : message}
      </span>
      <div className={styles.right}>
        <span className={styles.brand}>ROSE</span>
        <span className={styles.version}>v{__APP_VERSION__}</span>
      </div>
    </div>
  )
}
