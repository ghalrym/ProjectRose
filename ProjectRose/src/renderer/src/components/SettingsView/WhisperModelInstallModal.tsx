import { useEffect } from 'react'
import { useWhisperPreloadStore } from '../../stores/useWhisperPreloadStore'
import styles from './WhisperModelInstallModal.module.css'

export interface WhisperModelOption {
  id: string
  label: string
  size: string
}

interface Props {
  open: boolean
  targetModel: WhisperModelOption | null
  onConfirm: () => Promise<void> | void
  onCancel: () => void
  onHide: () => void
  onComplete: () => void
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function WhisperModelInstallModal({
  open,
  targetModel,
  onConfirm,
  onCancel,
  onHide,
  onComplete
}: Props): JSX.Element | null {
  const { modelId, status, percent, loaded, total, fileLabel, error } = useWhisperPreloadStore()

  // When this install completes successfully, hand control back to the parent
  // so it can persist the new whisperModel setting and close the modal.
  useEffect(() => {
    if (!open || !targetModel) return
    if (status === 'ready' && modelId === targetModel.id) {
      onComplete()
    }
  }, [open, targetModel, status, modelId, onComplete])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (status === 'preparing' || status === 'downloading') onHide()
      else onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, status, onHide, onCancel])

  if (!open || !targetModel) return null

  const isInstalling = status === 'preparing' || status === 'downloading'
  const isDownloading = status === 'downloading'
  const isPreparing = status === 'preparing'
  const isError = status === 'error'

  const overlayClick = (): void => {
    if (isInstalling) onHide()
    else onCancel()
  }

  return (
    <div className={styles.overlay} onClick={overlayClick}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.closeBtn}
          onClick={isInstalling ? onHide : onCancel}
          aria-label={isInstalling ? 'Hide (download continues)' : 'Close'}
        >
          ✕
        </button>

        <div className={styles.kicker}>SPEECH-TO-TEXT · MODEL INSTALL</div>
        <div className={styles.title}>{targetModel.label}</div>
        <div className={styles.subtitle}>
          {status === 'idle' && (
            <>This model will download once (~{targetModel.size}) and be cached on disk for future use.</>
          )}
          {isPreparing && <>Preparing download…</>}
          {isDownloading && <>Downloading model files. You can close this dialog — the download continues in the background.</>}
          {status === 'ready' && <>Model installed. Finalizing…</>}
          {isError && <>The download could not finish.</>}
        </div>

        {(isInstalling || status === 'ready') && (
          <>
            <div className={styles.statusLine}>
              <span>
                {isPreparing ? 'PREPARING' : status === 'ready' ? 'READY' : 'DOWNLOADING'}
              </span>
              <span>
                {total > 0
                  ? `${formatBytes(loaded)} / ${formatBytes(total)} · ${percent.toFixed(0)}%`
                  : status === 'ready'
                    ? '100%'
                    : ''}
              </span>
            </div>
            <div className={styles.bar}>
              {isPreparing || (isDownloading && total === 0) ? (
                <div className={styles.barFillIndeterminate} />
              ) : (
                <div className={styles.barFill} style={{ width: `${percent}%` }} />
              )}
            </div>
            <div className={styles.fileLabel}>{fileLabel || ' '}</div>
          </>
        )}

        {isError && (
          <div className={styles.errorBox}>{error || 'Unknown error.'}</div>
        )}

        <div className={styles.footer}>
          {status === 'idle' && (
            <>
              <button className={styles.ghostBtn} onClick={onCancel}>CANCEL</button>
              <button className={styles.primaryBtn} onClick={() => { void onConfirm() }}>
                INSTALL
              </button>
            </>
          )}
          {isInstalling && (
            <button className={styles.ghostBtn} onClick={onHide}>
              HIDE (keep downloading)
            </button>
          )}
          {status === 'ready' && (
            <button className={styles.primaryBtn} onClick={onComplete}>DONE</button>
          )}
          {isError && (
            <>
              <button className={styles.ghostBtn} onClick={onCancel}>CANCEL</button>
              <button className={styles.primaryBtn} onClick={() => { void onConfirm() }}>
                RETRY
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
