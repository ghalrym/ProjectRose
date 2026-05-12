import { useProjectStore } from '../stores/useProjectStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSessionsStore } from '../stores/useSessionsStore'
import { useCompressionStore } from '../stores/useCompressionStore'
import { useChatTimelineStore } from '../stores/useChatTimelineStore'
import { useChatUIStore } from '../stores/useChatUIStore'
import { useScreenWebcamShare } from '../hooks/useScreenWebcamShare'
import type { UserMessage } from '../types/chatMessages'
import { buildApiMessages, substituteCompressionSnapshot } from './chatApiMessages'
import {
  persistSession,
  persistCurrentSession,
  loadAllSessions,
  loadSessionInto,
  deleteSessionFor,
  renameSessionFor,
} from './chatPersistence'

// Electron's webContents.send (used for IPC.AI_TOKEN / IPC.AI_THINKING / etc.)
// and ipcMain.handle response (returned by window.api.aiChat) travel on
// separate IPC paths with no FIFO ordering between them. The invoke response
// can overtake several streaming events. Deferring listener teardown +
// placeholder reset by a few hundred ms gives the streaming events time to
// land before the listeners go away.
const POST_RESOLUTION_DEFER_MS = 250

function newSessionId(): string {
  return crypto.randomUUID()
}

let userMsgCounter = 0
function newUserMsgId(): string {
  return `msg-u-${++userMsgCounter}`
}

export async function sendMessage(): Promise<void> {
  const { inputValue } = useChatUIStore.getState()
  const trimmed = inputValue.trim()
  const timeline = useChatTimelineStore.getState()
  if (!trimmed || timeline.isLoading) return

  const rootPath = useProjectStore.getState().rootPath
  if (!rootPath) return

  // Snapshot API messages before adding the new user message
  const includeThinking = useSettingsStore.getState().includeThinkingInContext
  const compression = useCompressionStore.getState()
  const snapshot =
    compression.compressedMessages && compression.compressedFromCount != null
      ? {
          compressedMessages: compression.compressedMessages,
          compressedFromCount: compression.compressedFromCount,
        }
      : null

  const baseApiMessages = buildApiMessages(timeline.messages, includeThinking)
  const apiMessages = substituteCompressionSnapshot(baseApiMessages, snapshot)

  const frame = await useScreenWebcamShare.getState().captureFrame()

  const userMsg: UserMessage = {
    id: newUserMsgId(),
    role: 'user',
    content: trimmed,
    timestamp: Date.now(),
    ...(frame ? { attachments: [frame] } : {}),
  }

  // Resolve / create session, capturing the metadata that the rest of this
  // turn will write to — even if the user switches sessions mid-stream.
  let sessionId = useSessionsStore.getState().currentSessionId
  let sessionMeta = sessionId
    ? useSessionsStore.getState().sessions.find((s) => s.id === sessionId)
    : undefined
  if (!sessionId || !sessionMeta) {
    sessionId = newSessionId()
    const now = Date.now()
    sessionMeta = { id: sessionId, title: trimmed.slice(0, 50), createdAt: now, updatedAt: now }
    useSessionsStore.getState().upsertSession(sessionMeta)
    useSessionsStore.getState().setCurrentSessionId(sessionId)
  }

  useChatUIStore.getState().setInputValue('')
  useChatTimelineStore.getState().startTurn(userMsg)
  persistSession(rootPath, sessionMeta)

  // Wire up streaming listeners
  const t = (): ReturnType<typeof useChatTimelineStore.getState> =>
    useChatTimelineStore.getState()
  const cleanupToken = window.api.onAiToken((d) => t().appendToken(d))
  const cleanupToolStart = window.api.onAiToolCallStart((d) => t().appendToolStart(d))
  const cleanupToolEnd = window.api.onAiToolCallEnd((d) => t().resolveToolEnd(d))
  const cleanupThinking = window.api.onAiThinking((d) => t().appendThinking(d))
  const cleanupAskUser = window.api.onAiAskUser((d) => t().appendAskUser(d))
  const cleanupInjected = window.api.onAiInjectedMessage((d) => t().appendInjectedMessage(d))
  const cleanupModelSelected = window.api.onAiModelSelected((d) => t().modelSelected(d))
  const cleanupStreamReset = window.api.onAiStreamReset((d) => t().streamReset(d))

  const cleanup = (): void => {
    cleanupToken()
    cleanupToolStart()
    cleanupToolEnd()
    cleanupThinking()
    cleanupAskUser()
    cleanupInjected()
    cleanupModelSelected()
    cleanupStreamReset()
  }

  try {
    const response = await window.api.aiChat(
      [
        ...apiMessages,
        { role: 'user', content: trimmed, attachments: userMsg.attachments },
      ] as Parameters<typeof window.api.aiChat>[0],
      rootPath,
      sessionId
    )

    setTimeout(() => {
      cleanup()
      useChatTimelineStore.getState().settleTurn({ modelDisplay: response.modelDisplay })
      useSessionsStore.getState().touchSession(sessionId)
      // Re-read meta so the persisted updatedAt matches what touchSession set.
      const updatedMeta =
        useSessionsStore.getState().sessions.find((s) => s.id === sessionId) ?? sessionMeta!
      persistSession(rootPath, updatedMeta)

      // Refresh after each settled turn so the toast can fire when usage
      // crosses the threshold. Failures are swallowed — status is best-effort.
      refreshContextStatus(rootPath).catch(() => {
        /* ignore */
      })

      if (response.modifiedFiles.length > 0) {
        useProjectStore.getState().refreshTree()
      }
    }, POST_RESOLUTION_DEFER_MS)
  } catch (err) {
    // Defer the same way as the success path so streaming events that arrived
    // before the error can still land on the right placeholder.
    setTimeout(() => {
      cleanup()
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
      if (isAbort) {
        useChatTimelineStore.getState().abortCleanup()
      } else {
        const errorContent = `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`
        useChatTimelineStore.getState().errorCleanup({ errorContent })
      }
      persistSession(rootPath, sessionMeta!)
    }, POST_RESOLUTION_DEFER_MS)
  }
}

export async function cancelGeneration(): Promise<void> {
  await window.api.aiCancelGeneration()
}

export async function answerAskUser(questionId: string, answer: string): Promise<void> {
  useChatTimelineStore.getState().applyAnswer({ questionId, answer })
  await window.api.aiAskUserResponse(questionId, answer)
}

export async function refreshContextStatus(rootPath: string): Promise<void> {
  const messages = useChatTimelineStore.getState().messages
  if (messages.length === 0) {
    useCompressionStore.getState().setContextStatus(null)
    return
  }
  const c = useCompressionStore.getState()
  const snapshot =
    c.compressedMessages && c.compressedFromCount != null && c.compressedFromRawCount != null
      ? {
          compressedMessages: c.compressedMessages,
          compressedFromCount: c.compressedFromCount,
          compressedFromRawCount: c.compressedFromRawCount,
        }
      : null
  const status = await window.api.aiContextStatus(
    rootPath,
    messages as unknown as Array<Record<string, unknown>>,
    snapshot
  )
  useCompressionStore.getState().setContextStatus(status)
}

export async function compressNow(rootPath: string): Promise<void> {
  const sessionId = useSessionsStore.getState().currentSessionId
  if (!sessionId || useCompressionStore.getState().isCompressing) return
  useCompressionStore.getState().setIsCompressing(true)
  try {
    const messages = useChatTimelineStore.getState().messages
    const result = await window.api.aiCompressToolNoise(
      rootPath,
      messages as unknown as Array<Record<string, unknown>>
    )
    if (result) {
      const at = Date.now()
      useCompressionStore.getState().setSnapshot({
        compressedMessages: result.compressedMessages,
        compressedFromCount: result.compressedFromCount,
        compressedFromRawCount: result.compressedFromRawCount,
        compressedAt: at,
      })
      persistCurrentSession(rootPath)
      // Recompute status against the new snapshot, then snap the dismiss
      // baseline to it. If post-compression usage is below threshold the
      // toast hides naturally; if it isn't (recent turns alone exceed it),
      // the snap suppresses the toast until usage grows by REDISPLAY_*
      // deltas. Either way we don't immediately re-fire the toast at the
      // exact level the user just acted on.
      await refreshContextStatus(rootPath)
      const fresh = useCompressionStore.getState().contextStatus
      useCompressionStore.getState().setToastDismissed(
        fresh ? { percentUsed: fresh.percentUsed, totalToolSteps: fresh.totalToolSteps } : null
      )
    }
  } finally {
    useCompressionStore.getState().setIsCompressing(false)
  }
}

export function newSession(): void {
  useSessionsStore.getState().setCurrentSessionId(null)
  useChatTimelineStore.getState().resetTimeline()
  useCompressionStore.getState().reset()
}

export async function loadSessions(rootPath: string): Promise<void> {
  await loadAllSessions(rootPath)
  if (useSessionsStore.getState().currentSessionId) {
    await refreshContextStatus(rootPath).catch(() => {
      /* ignore */
    })
  }
}

export async function switchSession(rootPath: string, sessionId: string): Promise<void> {
  await loadSessionInto(rootPath, sessionId)
  await refreshContextStatus(rootPath).catch(() => {
    /* ignore */
  })
}

export async function deleteSession(rootPath: string, sessionId: string): Promise<void> {
  await deleteSessionFor(rootPath, sessionId)
}

export async function renameSession(
  rootPath: string,
  sessionId: string,
  title: string
): Promise<void> {
  await renameSessionFor(rootPath, sessionId, title)
}

// Called by BrandMenu when switching projects: resets all chat-related state.
export function clearChatForProjectSwitch(): void {
  useChatTimelineStore.getState().resetTimeline()
  useSessionsStore.getState().setSessions([])
  useSessionsStore.getState().setCurrentSessionId(null)
  useCompressionStore.getState().reset()
}
