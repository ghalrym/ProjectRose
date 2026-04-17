import { useRef } from 'react'
import { useChatStore } from '../../stores/useChatStore'
import styles from './ChatInput.module.css'

export function ChatInput(): JSX.Element {
  const inputValue = useChatStore((s) => s.inputValue)
  const setInputValue = useChatStore((s) => s.setInputValue)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const isLoading = useChatStore((s) => s.isLoading)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className={styles.inputArea}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
        disabled={isLoading}
        rows={2}
      />
      <button
        className={styles.sendBtn}
        onClick={sendMessage}
        disabled={isLoading || !inputValue.trim()}
      >
        {isLoading ? 'Thinking...' : 'Send'}
      </button>
    </div>
  )
}
