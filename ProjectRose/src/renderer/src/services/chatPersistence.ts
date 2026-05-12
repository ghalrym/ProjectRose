import { useChatTimelineStore } from '../stores/useChatTimelineStore'
import { useCompressionStore } from '../stores/useCompressionStore'
import { useSessionsStore } from '../stores/useSessionsStore'
import type { ChatMessage, SessionMeta, CompressionSnapshot } from '../types/chatMessages'
import { sanitizeLoadedMessages } from './chatApiMessages'

function buildPayload(
  meta: SessionMeta,
  messages: ChatMessage[],
  snapshot: CompressionSnapshot | null
): Parameters<typeof window.api.session.save>[1] {
  const payload: Parameters<typeof window.api.session.save>[1] = {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: Date.now(),
    messages: messages as unknown[],
  }
  if (snapshot) {
    payload.compressedMessages = snapshot.compressedMessages
    payload.compressedFromCount = snapshot.compressedFromCount
    payload.compressedFromRawCount = snapshot.compressedFromRawCount
    payload.compressedAt = snapshot.compressedAt
  }
  return payload
}

function readSnapshot(): CompressionSnapshot | null {
  const c = useCompressionStore.getState()
  if (
    c.compressedMessages &&
    c.compressedFromCount != null &&
    c.compressedFromRawCount != null &&
    c.compressedAt != null
  ) {
    return {
      compressedMessages: c.compressedMessages,
      compressedFromCount: c.compressedFromCount,
      compressedFromRawCount: c.compressedFromRawCount,
      compressedAt: c.compressedAt,
    }
  }
  return null
}

// Explicit-meta variant: callers that started a turn at session X should keep
// writing to X even if the user switched to session Y mid-stream.
export function persistSession(rootPath: string, meta: SessionMeta): void {
  const messages = useChatTimelineStore.getState().messages
  const snapshot = readSnapshot()
  window.api.session.save(rootPath, buildPayload(meta, messages, snapshot)).catch(() => {
    /* persistence failures are non-fatal */
  })
}

export function persistCurrentSession(rootPath: string): void {
  const { currentSessionId, sessions } = useSessionsStore.getState()
  if (!currentSessionId) return
  const meta = sessions.find((s) => s.id === currentSessionId)
  if (!meta) return
  persistSession(rootPath, meta)
}

export async function loadSessionInto(rootPath: string, sessionId: string): Promise<void> {
  const loaded = await window.api.session.load(rootPath, sessionId)
  if (!loaded) return
  const hasFullSnapshot =
    !!loaded.compressedMessages &&
    loaded.compressedFromCount != null &&
    loaded.compressedFromRawCount != null &&
    loaded.compressedAt != null

  useChatTimelineStore.getState().resetTimeline()
  useChatTimelineStore
    .getState()
    .setMessages(sanitizeLoadedMessages((loaded.messages as ChatMessage[]) ?? []))
  useSessionsStore.getState().setCurrentSessionId(sessionId)
  useCompressionStore.getState().setSnapshot(
    hasFullSnapshot
      ? {
          compressedMessages: loaded.compressedMessages!,
          compressedFromCount: loaded.compressedFromCount!,
          compressedFromRawCount: loaded.compressedFromRawCount!,
          compressedAt: loaded.compressedAt!,
        }
      : null
  )
  useCompressionStore.getState().setContextStatus(null)
  useCompressionStore.getState().setToastDismissed(null)
}

export async function loadAllSessions(rootPath: string): Promise<void> {
  const sessions = (await window.api.session.list(rootPath)) as SessionMeta[]
  useSessionsStore.getState().setSessions(sessions)
  if (sessions.length > 0) {
    await loadSessionInto(rootPath, sessions[0].id)
  }
}

export async function deleteSessionFor(rootPath: string, sessionId: string): Promise<void> {
  await window.api.session.delete(rootPath, sessionId)
  const wasActive = useSessionsStore.getState().currentSessionId === sessionId
  useSessionsStore.getState().removeSession(sessionId)
  if (wasActive) {
    useSessionsStore.getState().setCurrentSessionId(null)
    useChatTimelineStore.getState().resetTimeline()
    useCompressionStore.getState().reset()
  }
}

export async function renameSessionFor(
  rootPath: string,
  sessionId: string,
  title: string
): Promise<void> {
  const loaded = await window.api.session.load(rootPath, sessionId)
  if (!loaded) return
  await window.api.session.save(rootPath, { ...loaded, title, updatedAt: Date.now() })
  useSessionsStore.getState().renameSessionLocal(sessionId, title)
}
