import clsx from 'clsx'
import { SessionSidebar } from './SessionSidebar'
import { BloomStage } from './BloomStage'
import { ChatPanel } from './ChatPanel'
import { useActiveListening } from '../../hooks/useActiveListening'
import { useViewStore } from '../../stores/useViewStore'
import styles from './ChatView.module.css'

export function ChatView(): JSX.Element {
  useActiveListening()
  const isChatFullWidth = useViewStore((s) => s.isChatFullWidth)
  return (
    <div className={clsx(styles.chatView, isChatFullWidth && styles.chatViewFullWidth)}>
      <SessionSidebar />
      {!isChatFullWidth && <BloomStage />}
      <ChatPanel />
    </div>
  )
}
