import { useProjectStore } from '../../stores/useProjectStore'
import { BrandMenu } from './BrandMenu'
import { ViewToggle } from './ViewToggle'
import { ThemeToggle } from './ThemeToggle'
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs'
import styles from './TopBar.module.css'

export function TopBar(): JSX.Element {
  const rootPath = useProjectStore((s) => s.rootPath)
  const projectName = rootPath
    ? rootPath.replace(/\\/g, '/').split('/').pop() || 'rose-editor'
    : 'rose-editor'

  return (
    <div className={styles.topBar}>
      <div className={styles.hairline} />

      <BrandMenu projectName={projectName} />

      <div className={styles.divider} />

      {/* breadcrumb — fills remaining left space */}
      <div className={styles.breadcrumbZone}>
        <Breadcrumbs />
      </div>

      <div className={styles.spacer} />

      <ViewToggle />

      <div className={styles.spacer} />

      <div className={styles.right}>
        <ThemeToggle />
      </div>
    </div>
  )
}
