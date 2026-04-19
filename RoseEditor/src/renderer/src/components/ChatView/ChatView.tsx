import { useEffect, useRef } from 'react'
import { useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { ChatCell } from './ChatCell'
import { ToolCallCell } from './ToolCallCell'
import { ChatInput } from './ChatInput'
import { SessionSidebar } from './SessionSidebar'
import styles from './ChatView.module.css'

export function ChatView(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const isLoading = useChatStore((s) => s.isLoading)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const rootPath = useProjectStore((s) => s.rootPath)
  const loadSessions = useChatStore((s) => s.loadSessions)

  useEffect(() => {
    if (rootPath) loadSessions(rootPath)
  }, [rootPath])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className={styles.chatView}>
      <SessionSidebar />
      <div className={styles.chatMain}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            Start a conversation with the AI assistant
          </div>
        ) : (
          <div className={styles.messages}>
            {messages.map((msg) =>
              msg.role === 'tool'
                ? <ToolCallCell key={msg.id} message={msg} />
                : <ChatCell key={msg.id} message={msg} />
            )}
            {isLoading && (
              <div className={styles.loading}>Generating response...</div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
        <ChatInput />
      </div>
    </div>
  )
}
