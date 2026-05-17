import { useActiveListeningStore } from '../../stores/useActiveListeningStore'
import styles from './SessionPrepModal.module.css'

export function SessionPrepModal(): JSX.Element | null {
  const preparing = useActiveListeningStore((s) => s.preparing)
  const prepError = useActiveListeningStore((s) => s.prepError)
  const setActive = useActiveListeningStore((s) => s.setActive)

  if (!preparing && !prepError) return null

  const dismissError = (): void => {
    setActive(false)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.kicker}>ACTIVE LISTENING</div>
        <div className={styles.title}>
          {prepError ? 'Could not prepare session' : 'Preparing session…'}
        </div>

        {!prepError && (
          <>
            <div className={styles.spinner} />
            <div className={styles.subtitle}>
              Warming up the transcription and speaker models. This is fast once they're cached on disk; first time may take a few minutes for the larger whisper models.
            </div>
          </>
        )}

        {prepError && (
          <>
            <div className={styles.errorBox}>{prepError}</div>
            <div className={styles.footer}>
              <button className={styles.ghostBtn} onClick={dismissError}>CLOSE</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
