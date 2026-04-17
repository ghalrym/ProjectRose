import type { UserMessage, AssistantMessage } from '../../stores/useChatStore'
import clsx from 'clsx'
import styles from './ChatCell.module.css'

interface ChatCellProps {
  message: UserMessage | AssistantMessage
}

export function ChatCell({ message }: ChatCellProps): JSX.Element {
  const isUser = message.role === 'user'

  return (
    <div
      className={clsx(
        styles.cell,
        isUser ? styles.userCell : styles.assistantCell
      )}
    >
      <div className={styles.cellHeader}>
        <span className={isUser ? styles.userLabel : styles.assistantLabel}>
          {isUser ? 'Input' : 'Output'}
        </span>
      </div>
      <div className={styles.cellContent}>{message.content}</div>
    </div>
  )
}
