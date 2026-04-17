import { ViewToggle } from './ViewToggle'
import { ThemeToggle } from './ThemeToggle'
import { SaveIndicator } from './SaveIndicator'
import { IndexingStatus } from './IndexingStatus'
import styles from './TopBar.module.css'

interface TopBarProps {
  activeFileName: string | null
  isDirty: boolean
}

export function TopBar({ activeFileName, isDirty }: TopBarProps): JSX.Element {
  return (
    <div className={styles.topBar}>
      <SaveIndicator fileName={activeFileName} isDirty={isDirty} />
      <IndexingStatus />
      <ViewToggle />
      <ThemeToggle />
    </div>
  )
}
