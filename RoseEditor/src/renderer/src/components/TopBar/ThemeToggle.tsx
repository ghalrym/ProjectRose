import { useThemeStore } from '../../stores/useThemeStore'
import styles from './TopBar.module.css'

export function ThemeToggle(): JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  return (
    <button className={styles.iconButton} onClick={toggleTheme} title="Toggle theme">
      {theme === 'dark' ? '\u2600' : '\u263D'}
    </button>
  )
}
