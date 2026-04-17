import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalStore } from '../../../stores/useTerminalStore'
import { useThemeStore } from '../../../stores/useThemeStore'
import { useViewStore } from '../../../stores/useViewStore'
import '@xterm/xterm/css/xterm.css'
import styles from './TerminalPanel.module.css'

const DARK_THEME = {
  background: '#11111b',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  selectionBackground: '#45475a',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#89dceb',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#89dceb',
  brightWhite: '#a6adc8'
}

const LIGHT_THEME = {
  background: '#dce0e8',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  selectionBackground: '#bcc0cc',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#8839ef',
  cyan: '#04a5e5',
  white: '#acb0be',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#8839ef',
  brightCyan: '#04a5e5',
  brightWhite: '#bcc0cc'
}

export function TerminalPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const initialize = useTerminalStore((s) => s.initialize)
  const dispose = useTerminalStore((s) => s.dispose)
  const sessionId = useTerminalStore((s) => s.sessionId)
  const theme = useThemeStore((s) => s.theme)
  const terminalHeight = useViewStore((s) => s.terminalHeight)
  const setTerminalHeight = useViewStore((s) => s.setTerminalHeight)

  // Create xterm instance and spawn pty on mount
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      theme: theme === 'dark' ? DARK_THEME : LIGHT_THEME
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    setTimeout(() => fitAddon.fit(), 100)

    // Spawn a new pty session
    initialize()

    return () => {
      // Clean up data listeners
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Wire up data flow when sessionId becomes available
  useEffect(() => {
    const term = terminalRef.current
    if (!term || !sessionId) return

    // Clean up previous listeners if any
    if (cleanupRef.current) {
      cleanupRef.current()
    }

    // User types -> send to pty
    const inputDisposable = term.onData((data) => {
      window.api.writeTerminal(sessionId, data)
    })

    // Pty output -> write to xterm
    const removeDataListener = window.api.onTerminalData((data) => {
      term.write(data)
    })

    // Fit terminal and tell pty the size
    const fitAddon = fitAddonRef.current
    if (fitAddon) {
      setTimeout(() => {
        fitAddon.fit()
        window.api.resizeTerminal(sessionId, term.cols, term.rows)
      }, 50)
    }

    cleanupRef.current = () => {
      inputDisposable.dispose()
      removeDataListener()
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
    }
  }, [sessionId])

  // Sync theme
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME
    }
  }, [theme])

  // Refit on height change
  useEffect(() => {
    const fitAddon = fitAddonRef.current
    if (!fitAddon) return

    const handle = setTimeout(() => {
      fitAddon.fit()
      const term = terminalRef.current
      if (term && sessionId) {
        window.api.resizeTerminal(sessionId, term.cols, term.rows)
      }
    }, 50)

    return () => clearTimeout(handle)
  }, [terminalHeight, sessionId])

  // Resize observer for window resizes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      const fitAddon = fitAddonRef.current
      if (!fitAddon) return
      fitAddon.fit()
      const term = terminalRef.current
      if (term && sessionId) {
        window.api.resizeTerminal(sessionId, term.cols, term.rows)
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [sessionId])

  // Drag handle for resizing
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const startHeight = terminalHeight

      const onMouseMove = (ev: MouseEvent): void => {
        const delta = startY - ev.clientY
        const newHeight = Math.max(100, Math.min(600, startHeight + delta))
        setTerminalHeight(newHeight)
      }

      const onMouseUp = (): void => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [terminalHeight, setTerminalHeight]
  )

  return (
    <div className={styles.terminalWrapper} style={{ height: terminalHeight }}>
      <div className={styles.dragHandle} onMouseDown={handleDragStart} />
      <div className={styles.terminalHeader}>
        <span className={styles.terminalTitle}>Terminal</span>
      </div>
      <div className={styles.terminalContainer} ref={containerRef} />
    </div>
  )
}
