import { useState } from 'react'
import type { InjectedMessage } from '../../stores/useChatStore'
import styles from './InjectedCell.module.css'

interface InjectedCellProps {
  message: InjectedMessage
}

export function InjectedCell({ message }: InjectedCellProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const icon = message.extensionIcon
  const isImage = typeof icon === 'string' && (icon.startsWith('http') || icon.startsWith('data:') || icon.includes('/'))

  return (
    <div className={styles.container}>
      <div
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
      >
        {icon
          ? isImage
            ? <img className={styles.iconImg} src={icon} alt="" />
            : <span className={styles.icon}>{icon}</span>
          : <span className={styles.icon}>🌹</span>
        }
        <span className={styles.extensionName}>{message.extensionName}</span>
        <span className={styles.separator}>▸</span>
        <span className={styles.subLabel}>guided agent</span>
        <span className={styles.chevron}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && <div className={styles.content}>{message.content}</div>}
    </div>
  )
}
