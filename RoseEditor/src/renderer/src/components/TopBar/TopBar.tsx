import { ViewToggle } from './ViewToggle'
import { ThemeToggle } from './ThemeToggle'
import { IndexingStatus } from './IndexingStatus'
import styles from './TopBar.module.css'

export function TopBar(): JSX.Element {
  return (
    <div className={styles.topBar}>
      <div className={styles.left}>
        <IndexingStatus />
      </div>
      <div className={styles.center}>
        <ViewToggle />
      </div>
      <div className={styles.right}>
        <ThemeToggle />
      </div>
    </div>
  )
}
