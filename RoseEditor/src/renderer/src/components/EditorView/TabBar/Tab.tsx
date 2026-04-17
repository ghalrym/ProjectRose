import clsx from 'clsx'
import styles from './Tab.module.css'

interface TabProps {
  fileName: string
  isActive: boolean
  isDirty: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
}

export function Tab({ fileName, isActive, isDirty, onClick, onClose }: TabProps): JSX.Element {
  return (
    <div className={clsx(styles.tab, isActive && styles.active)} onClick={onClick}>
      {isDirty && <span className={styles.dirty} />}
      <span className={styles.name}>{fileName}</span>
      <button className={styles.closeBtn} onClick={onClose} title="Close">
        &times;
      </button>
    </div>
  )
}
