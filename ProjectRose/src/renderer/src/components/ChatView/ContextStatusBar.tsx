import { useChat, COMPRESSION_THRESHOLD_PCT } from '../../stores/useChat'
import styles from './ContextStatusBar.module.css'

export function ContextStatusBar(): JSX.Element | null {
  const status = useChat((s) => s.contextStatus)
  const isCompressing = useChat((s) => s.isCompressing)
  const compressNow = useChat((s) => s.compressNow)

  if (!status) return null

  const pct = Math.max(0, Math.min(100, Math.round(status.percentUsed * 100)))
  const high = status.percentUsed >= COMPRESSION_THRESHOLD_PCT

  // The manual button compresses the entire conversation (keep 0 recent turns
  // verbatim), unlike the auto-suggested toast which keeps the recent turns.
  const handleCompress = (): void => {
    void compressNow({ full: true })
  }

  return (
    <div className={styles.bar}>
      <span className={`${styles.metric} ${high ? styles.metricHigh : ''}`}>{pct}% context</span>
      <span className={styles.sep}>·</span>
      <span className={styles.tools}>
        {status.totalToolSteps} tool {status.totalToolSteps === 1 ? 'call' : 'calls'}
      </span>
      <button
        type="button"
        className={styles.btn}
        onClick={handleCompress}
        disabled={isCompressing}
        title="Summarise the whole conversation to free up context"
      >
        {isCompressing ? 'COMPRESSING…' : 'COMPRESS'}
      </button>
    </div>
  )
}
