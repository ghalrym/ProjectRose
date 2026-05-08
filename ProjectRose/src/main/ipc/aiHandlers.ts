import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { chat, buildAgentMd, cancelActiveChat, compressToolNoise, getContextStatus } from '../services/aiService'
import { resolveAskUserQuestion, resolveScreenshotRequest, type ScreenshotResult } from '../services/llmClient'
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
    async (_event, payload: { rootPath: string; messages: Array<Record<string, unknown>> }) => {
      return getContextStatus(payload.rootPath, payload.messages)
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

  ipcMain.handle(IPC.AI_CANCEL, () => {
    cancelActiveChat()
  })

  ipcMain.handle(
    IPC.AI_ASK_USER_RESPONSE,
    (_event, payload: { questionId: string; answer: string }) => {
      resolveAskUserQuestion(payload.questionId, payload.answer)
    }
  )

  ipcMain.handle(
    IPC.AI_CAPTURE_SCREENSHOT_RESULT,
    (_event, payload: { requestId: string; result: ScreenshotResult }) => {
      resolveScreenshotRequest(payload.requestId, payload.result)
    }
  )
}
