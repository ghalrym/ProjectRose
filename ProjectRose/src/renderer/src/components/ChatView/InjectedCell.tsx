import type { InjectedMessage } from '../../stores/useChatStore'
import styles from './InjectedCell.module.css'

interface InjectedCellProps {
  message: InjectedMessage
}

export function InjectedCell({ message }: InjectedCellProps): JSX.Element {
  const icon = message.extensionIcon
  const isImage = typeof icon === 'string' && (icon.startsWith('http') || icon.startsWith('data:') || icon.includes('/'))

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {icon
          ? isImage
            ? <img className={styles.iconImg} src={icon} alt="" />
            : <span className={styles.icon}>{icon}</span>
          : <span className={styles.icon}>🌹</span>
        }
        <span className={styles.extensionName}>{message.extensionName}</span>
        <span className={styles.separator}>▸</span>
        <span className={styles.subLabel}>guided agent</span>
      </div>
      <div className={styles.content}>{message.content}</div>
    </div>
  )
}
