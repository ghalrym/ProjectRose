import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useChatStore } from '../../stores/useChatStore'
import type { ChatMessage, ToolMessage, AskUserMessage } from '../../stores/useChatStore'
import { useActiveListeningStore } from '../../stores/useActiveListeningStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { ChatCell } from './ChatCell'
import { ToolCallGroupCell } from './ToolCallGroupCell'
import { AskUserCell } from './AskUserCell'
import { SystemPromptCell } from './SystemPromptCell'
import { ChatInput } from './ChatInput'
import { TranscriptView } from './TranscriptView'
import styles from './ChatPanel.module.css'

type RenderItem =
  | { type: 'message'; message: Exclude<ChatMessage, ToolMessage> }
  | { type: 'tool-group'; messages: ToolMessage[]; key: string }

function formatToolCall(msg: ToolMessage): string {
  let params = ''
  try {
    params = JSON.stringify(msg.params, null, 2)
  } catch {
    params = String(msg.params)
  }
  const status = msg.pending ? 'running' : msg.error ? 'error' : 'done'
  const result =
    msg.result == null
      ? '(no result)'
      : msg.result
  return `[Tool: ${msg.name}] (${status})\nParams: ${params}\nResult: ${result}`
}

function formatChatForCopy(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      parts.push(`[User]\n${msg.content}`)
    } else if (msg.role === 'assistant') {
      parts.push(`[Assistant]\n${msg.content}`)
    } else if (msg.role === 'tool') {
      parts.push(formatToolCall(msg))
    } else if (msg.role === 'ask_user') {
      const ans = msg.answer ? `\nAnswer: ${msg.answer}` : ''
      parts.push(`[Ask]\n${msg.question}${ans}`)
    }
  }
  return parts.join('\n\n')
}

function groupMessages(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role === 'tool') {
      const group: ToolMessage[] = []
      while (i < messages.length && messages[i].role === 'tool') {
        group.push(messages[i] as ToolMessage)
        i++
      }
      items.push({ type: 'tool-group', messages: group, key: group[0].id })
    } else {
      items.push({ type: 'message', message: msg as Exclude<ChatMessage, ToolMessage> })
      i++
    }
  }
  return items
}

export function ChatPanel(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const isLoading = useChatStore((s) => s.isLoading)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const rootPath = useProjectStore((s) => s.rootPath)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const mode = useActiveListeningStore((s) => s.mode)
  const isActive = useActiveListeningStore((s) => s.isActive)
  const setMode = useActiveListeningStore((s) => s.setMode)
  const [copiedAll, setCopiedAll] = useState(false)

  const handleCopyAll = async (): Promise<void> => {
    const text = formatChatForCopy(messages)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1500)
    } catch {
      // clipboard may be unavailable; silently ignore
    }
  }

  useEffect(() => {
    if (rootPath) loadSessions(rootPath)
  }, [rootPath])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const items = groupMessages(messages)

  return (
    <div className={styles.chatPanel}>
      <div className={styles.panelHeader}>
        <button
          className={clsx(styles.toggleBtn, mode === 'chat' && styles.toggleBtnActive)}
          onClick={() => setMode('chat')}
        >
          CHAT
        </button>
        <button
          className={clsx(styles.toggleBtn, mode === 'transcript' && styles.toggleBtnActive)}
          onClick={() => setMode('transcript')}
        >
          TRANSCRIPT
        </button>
        {isActive && <span className={styles.liveChip}><span className={styles.liveDot} />LIVE</span>}
        <button
          className={clsx(styles.copyChatBtn, !isActive && styles.copyChatBtnPushRight)}
          onClick={handleCopyAll}
          disabled={messages.length === 0}
          title="Copy entire chat"
          type="button"
        >
          {copiedAll ? 'COPIED' : 'COPY CHAT'}
        </button>
      </div>

      {mode === 'chat' ? (
        <div className={styles.messages}>
          {rootPath && <SystemPromptCell rootPath={rootPath} />}
          {messages.length === 0 ? (
            <div className={styles.empty}>Start a conversation with the AI assistant</div>
          ) : (
            <>
              {items.map((item) =>
                item.type === 'tool-group'
                  ? <ToolCallGroupCell key={item.key} messages={item.messages} />
                  : item.message.role === 'ask_user'
                  ? <AskUserCell key={item.message.id} message={item.message as AskUserMessage} />
                  : <ChatCell key={item.message.id} message={item.message} />
              )}
              {isLoading && (
                <div className={styles.loading}>Generating response...</div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        <TranscriptView />
      )}

      <ChatInput />
    </div>
  )
}
