import { useChat, useShouldShowToast } from '../../stores/useChat'
import { useProjectStore } from '../../stores/useProjectStore'
import styles from './CompressionToast.module.css'

export function CompressionToast(): JSX.Element | null {
  const status = useChat((s) => s.contextStatus)
  const isCompressing = useChat((s) => s.isCompressing)
  const dismiss = useChat((s) => s.dismissCompressionToast)
  const compressNow = useChat((s) => s.compressNow)
  const rootPath = useProjectStore((s) => s.rootPath)
  const shouldShow = useShouldShowToast()

  // Once compression starts, keep the toast mounted (with the spinner) until
  // the action resolves — even if status changes mid-flight.
  if (!shouldShow && !isCompressing) return null
  if (!status || !rootPath) return null

  const pct = Math.round(status.percentUsed * 100)

  const handleCompress = (): void => {
    void compressNow()
  }

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <div className={styles.title}>CONTEXT GETTING FULL</div>
      {isCompressing ? (
        <div className={styles.busy}>
          <span className={styles.spinner} aria-hidden="true" />
          Summarizing older turns…
        </div>
      ) : (
        <>
          <div className={styles.body}>
            Session is using <span className={styles.metric}>~{pct}%</span> of model context
            ({status.totalToolSteps} tool calls so far). Compressing older turns
            keeps replies sharp.
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleCompress}
            >
              Compress
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={dismiss}
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  )
}
