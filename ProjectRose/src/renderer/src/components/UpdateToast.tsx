import { useUpdaterStore } from '../stores/useUpdaterStore'
import styles from './UpdateToast.module.css'

function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return '0%'
  return `${Math.max(0, Math.min(100, Math.round(p)))}%`
}

export function UpdateToast(): JSX.Element | null {
  const phase = useUpdaterStore((s) => s.phase)
  const toastVisible = useUpdaterStore((s) => s.toastVisible)
  const version = useUpdaterStore((s) => s.version)
  const progressPercent = useUpdaterStore((s) => s.progressPercent)
  const errorMessage = useUpdaterStore((s) => s.errorMessage)
  const hideToast = useUpdaterStore((s) => s.hideToast)
  const dismiss = useUpdaterStore((s) => s.dismiss)
  const requestDownload = useUpdaterStore((s) => s.requestDownload)
  const requestSkip = useUpdaterStore((s) => s.requestSkip)
  const requestInstall = useUpdaterStore((s) => s.requestInstall)

  if (phase === 'idle' || !toastVisible) return null

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <button
        type="button"
        className={styles.closeBtn}
        onClick={() => (phase === 'available' ? dismiss() : hideToast())}
        title={phase === 'available' ? 'Remind me later' : 'Hide'}
      >
        ✕
      </button>

      <div className={styles.label}>PROJECTROSE UPDATE</div>

      {phase === 'available' && (
        <>
          <div className={styles.title}>v{version} available</div>
          <div className={styles.body}>
            A new version is ready to download.
          </div>
          <div className={styles.btnRow}>
            <button className={styles.btnGhost} onClick={() => void requestSkip()}>
              Skip This Version
            </button>
            <button className={styles.btnSecondary} onClick={() => dismiss()}>
              Later
            </button>
            <button className={styles.btnPrimary} onClick={() => void requestDownload()}>
              Install
            </button>
          </div>
        </>
      )}

      {phase === 'downloading' && (
        <>
          <div className={styles.title}>Downloading v{version}…</div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: formatPercent(progressPercent) }} />
          </div>
          <div className={styles.progressLabel}>{formatPercent(progressPercent)} DOWNLOADED</div>
          <div className={styles.btnRow}>
            <button className={styles.btnSecondary} onClick={() => hideToast()}>
              Hide
            </button>
          </div>
        </>
      )}

      {phase === 'ready' && (
        <>
          <div className={styles.title}>v{version} ready to install</div>
          <div className={styles.body}>
            Restart ProjectRose to apply the update.
          </div>
          <div className={styles.btnRow}>
            <button className={styles.btnSecondary} onClick={() => hideToast()}>
              Hide
            </button>
            <button className={styles.btnPrimary} onClick={() => void requestInstall()}>
              Restart Now
            </button>
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <div className={styles.title}>Update error</div>
          <div className={styles.errorMsg}>
            {errorMessage ?? 'Something went wrong while checking for updates.'}
          </div>
          <div className={styles.btnRow}>
            <button className={styles.btnSecondary} onClick={() => dismiss()}>
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  )
}
