import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { chat, compressToolNoise, getContextStatus } from '../services/aiService'
import { buildAgentMd } from '../services/agentMd'
import { sessionRegistry } from '../services/sessionRegistry'
import type { ScreenshotResult } from '../services/chatSession'
import type { Message } from '../../shared/roseModelTypes'

export function registerAiHandlers(): void {
  ipcMain.handle(
    IPC.AI_CHAT,
    async (_event, payload: { messages: Message[]; rootPath: string; sessionId: string }) => {
      return chat(payload.messages, payload.rootPath, payload.sessionId)
    }
  )

  ipcMain.handle(
    IPC.AI_CONTEXT_STATUS,
    async (_event, payload: {
      rootPath: string
      messages: Array<Record<string, unknown>>
      compression: {
        compressedMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
        compressedFromCount: number
        compressedFromRawCount: number
      } | null
    }) => {
      return getContextStatus(payload.rootPath, payload.messages, payload.compression)
    }
  )

  ipcMain.handle(
    IPC.AI_COMPRESS_TOOL_NOISE,
    async (_event, payload: { rootPath: string; messages: Array<Record<string, unknown>> }) => {
      return compressToolNoise(payload.rootPath, payload.messages)
    }
  )

  ipcMain.handle(
    IPC.AI_GET_SYSTEM_PROMPT,
    async (_event, rootPath: string) => {
      return buildAgentMd(rootPath)
    }
  )

  ipcMain.handle(IPC.AI_CANCEL, (_event, payload: { sessionId: string }) => {
    // Route by sessionId. No-op if no session is registered for the id —
    // either it already settled or the caller raced with cancellation. We
    // do not fall back to "cancel the most recent" because that would let
    // a stale cancel from a settled session abort a freshly-started one.
    sessionRegistry.get(payload.sessionId)?.cancel()
  })

  ipcMain.handle(
    IPC.AI_ASK_USER_RESPONSE,
    (_event, payload: { sessionId: string; questionId: string; answer: string }) => {
      // Route by sessionId so two simultaneous sessions cannot resolve each
      // other's questions. No-op if the session is gone (cancelled or
      // disposed) — the question's pending resolver went with it.
      sessionRegistry.get(payload.sessionId)?.resolveAskUserQuestion(payload.questionId, payload.answer)
    }
  )

  ipcMain.handle(
    IPC.AI_CAPTURE_SCREENSHOT_RESULT,
    (_event, payload: { sessionId: string; requestId: string; result: ScreenshotResult }) => {
      // Route by sessionId so two simultaneous sessions cannot resolve each
      // other's captures. No-op if the session is gone.
      sessionRegistry.get(payload.sessionId)?.resolveScreenshot(payload.requestId, payload.result)
    }
  )
}
