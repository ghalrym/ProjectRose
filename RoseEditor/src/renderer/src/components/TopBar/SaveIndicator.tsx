import styles from './TopBar.module.css'

interface SaveIndicatorProps {
  fileName: string | null
  isDirty: boolean
}

export function SaveIndicator({ fileName, isDirty }: SaveIndicatorProps): JSX.Element {
  if (!fileName) {
    return <div className={styles.saveIndicator}>No file open</div>
  }

  return (
    <div className={styles.saveIndicator}>
      {isDirty && <span className={styles.dirtyDot} />}
      <span className={styles.fileName}>{fileName}</span>
    </div>
  )
}
