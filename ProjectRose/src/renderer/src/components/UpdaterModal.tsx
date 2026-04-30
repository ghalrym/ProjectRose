import styles from './UpdaterModal.module.css'

export type UpdaterPhase = 'available' | 'downloading' | 'ready' | 'error'

export interface UpdaterModalProps {
  phase: UpdaterPhase
  version: string | null
  releaseNotes: string | null
  progressPercent: number
  errorMessage: string | null
  onClose: () => void
  onRestart: () => void
}

function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return '0%'
  return `${Math.max(0, Math.min(100, Math.round(p)))}%`
}

export function UpdaterModal(props: UpdaterModalProps): JSX.Element {
  const { phase, version, releaseNotes, progressPercent, errorMessage, onClose, onRestart } = props

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>

        <div className={styles.label}>PROJECTROSE UPDATE</div>
        <div className={styles.name}>
          {phase === 'ready'
            ? `READY · v${version ?? ''}`
            : phase === 'available' || phase === 'downloading'
              ? `DOWNLOADING · v${version ?? ''}`
              : 'UPDATE ERROR'}
        </div>

        {(phase === 'available' || phase === 'downloading') && (
          <>
            <div className={styles.body}>
              A new version is downloading in the background. You can keep working — we&apos;ll let you know when it&apos;s ready.
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: formatPercent(progressPercent) }} />
            </div>
            <div className={styles.progressLabel}>
              {phase === 'downloading' ? `${formatPercent(progressPercent)} DOWNLOADED` : 'STARTING…'}
            </div>
            <div className={styles.btnRow}>
              <button className={styles.btnSecondary} onClick={onClose}>Hide</button>
            </div>
          </>
        )}

        {phase === 'ready' && (
          <>
            <div className={styles.body}>
              Version {version} is ready to install. Restart now to apply, or keep working — it will install the next time you quit ProjectRose.
            </div>
            {releaseNotes && (
              <div className={styles.notes}>{releaseNotes}</div>
            )}
            <div className={styles.btnRow}>
              <button className={styles.btnSecondary} onClick={onClose}>Later</button>
              <button className={styles.btnPrimary} onClick={onRestart}>Restart Now</button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className={styles.errorMsg}>{errorMessage ?? 'Something went wrong while checking for updates.'}</div>
            <div className={styles.btnRow}>
              <button className={styles.btnSecondary} onClick={onClose}>Dismiss</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
