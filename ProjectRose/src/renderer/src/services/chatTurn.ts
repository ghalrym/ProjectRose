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

// Set by cancelGeneration() so the catch below can tell a user-initiated abort
// apart from an upstream error whose message happens to contain "abort". Without
// this, any error mentioning "abort" (e.g. "Request was aborted by client" from
// a failed Bedrock stream) gets silently swallowed and the user sees nothing.
let userCancelled = false

export async function sendMessage(): Promise<void> {
  const { inputValue } = useChatUIStore.getState()
  const trimmed = inputValue.trim()
  const timeline = useChatTimelineStore.getState()
  if (!trimmed || timeline.isLoading) return

  const rootPath = useProjectStore.getState().rootPath
  if (!rootPath) return

  userCancelled = false

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

  // Wire up streaming listeners.
  //
  // Every payload carries a `sessionId`. If the user switches sessions mid-stream,
  // events from the abandoned session are still in flight on the IPC channel and
  // would land on the new session's timeline. Filtering by the sessionId captured
  // when this turn was issued drops those late events at the listener boundary.
  const t = (): ReturnType<typeof useChatTimelineStore.getState> =>
    useChatTimelineStore.getState()
  const turnSessionId = sessionId
  const forThisTurn = <T extends { sessionId: string }>(handler: (d: T) => void) =>
    (d: T): void => {
      if (d.sessionId !== turnSessionId) return
      handler(d)
    }
  const cleanupToken = window.api.onAiToken(forThisTurn((d) => t().appendToken(d)))
  const cleanupToolStart = window.api.onAiToolCallStart(forThisTurn((d) => t().appendToolStart(d)))
  const cleanupToolEnd = window.api.onAiToolCallEnd(forThisTurn((d) => t().resolveToolEnd(d)))
  const cleanupThinking = window.api.onAiThinking(forThisTurn((d) => t().appendThinking(d)))
  const cleanupAskUser = window.api.onAiAskUser(forThisTurn((d) => t().appendAskUser(d)))
  const cleanupInjected = window.api.onAiInjectedMessage(forThisTurn((d) => t().appendInjectedMessage(d)))
  const cleanupModelSelected = window.api.onAiModelSelected(forThisTurn((d) => t().modelSelected(d)))
  const cleanupStreamReset = window.api.onAiStreamReset(forThisTurn((d) => t().streamReset(d)))

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
      // A "successful" response with zero content and no streamed events
      // (no token, tool call, ask_user, thinking, etc.) means the model
      // accepted the request, returned nothing, and the SDK did not raise.
      // We've seen this when a non-vision model is given an image attachment
      // upstream — the request 200s with an empty stream. Without this
      // check the user sees nothing and assumes the app is broken.
      const finalState = useChatTimelineStore.getState()
      const lastMsg = finalState.messages[finalState.messages.length - 1]
      const emptyResponse =
        response.content === '' &&
        response.modifiedFiles.length === 0 &&
        lastMsg?.id === userMsg.id
      if (emptyResponse) {
        const hasAttachment = (userMsg.attachments?.length ?? 0) > 0
        const isManaged = useSettingsStore.getState().hostMode === 'projectrose'
        let hint = ''
        if (hasAttachment) {
          hint = isManaged
            ? ' Server image support is coming soon — if you want to use screen share you will need a vision-capable local model for now.'
            : ' The selected model may not support image input — try a vision-capable model, or stop sharing your screen/camera.'
        }
        finalState.errorCleanup({
          errorContent: `Error: The model returned an empty response.${hint}`,
        })
      } else {
        finalState.settleTurn({ modelDisplay: response.modelDisplay })
      }
      useSessionsStore.getState().touchSession(sessionId)
      // Re-read meta so the persisted updatedAt matches what touchSession set.
      const updatedMeta =
        useSessionsStore.getState().sessions.find((s) => s.id === sessionId) ?? sessionMeta!
      persistSession(rootPath, updatedMeta)

      // Refresh after each settled turn so the toast can fire when usage
      // crosses the threshold. Failures are swallowed — status is best-effort.
      useCompressionStore
        .getState()
        .refreshContextStatus(rootPath)
        .catch(() => {
          /* ignore */
        })

      if (response.modifiedFiles.length > 0) {
        useProjectStore.getState().refreshTree()
      }
    }, POST_RESOLUTION_DEFER_MS)
  } catch (err) {
    // Capture the flag now — by the time the setTimeout fires, another
    // sendMessage call could theoretically have reset it.
    const wasUserCancelled = userCancelled
    // Defer the same way as the success path so streaming events that arrived
    // before the error can still land on the right placeholder.
    setTimeout(() => {
      cleanup()
      const isAbort =
        wasUserCancelled || (err instanceof Error && err.name === 'AbortError')
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
  userCancelled = true
  await window.api.aiCancelGeneration()
}

export async function answerAskUser(questionId: string, answer: string): Promise<void> {
  useChatTimelineStore.getState().applyAnswer({ questionId, answer })
  const sessionId = useSessionsStore.getState().currentSessionId
  if (!sessionId) return
  await window.api.aiAskUserResponse(sessionId, questionId, answer)
}

export function newSession(): void {
  useSessionsStore.getState().setCurrentSessionId(null)
  useChatTimelineStore.getState().resetTimeline()
  useCompressionStore.getState().reset()
}

export async function loadSessions(rootPath: string): Promise<void> {
  await loadAllSessions(rootPath)
  if (useSessionsStore.getState().currentSessionId) {
    await useCompressionStore
      .getState()
      .refreshContextStatus(rootPath)
      .catch(() => {
        /* ignore */
      })
  }
}

export async function switchSession(rootPath: string, sessionId: string): Promise<void> {
  await loadSessionInto(rootPath, sessionId)
  await useCompressionStore
    .getState()
    .refreshContextStatus(rootPath)
    .catch(() => {
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
