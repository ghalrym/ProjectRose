import { BrowserWindow } from 'electron'
import type {
  GenerateRequest,
  CompressRequest,
  CompressResponse,
  Message
} from '../../shared/roseModelTypes'
import { IPC } from '../../shared/ipcChannels'

interface SSEEvent {
  event: string
  data: string
}

let toolCallCounter = 0

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

export class RoseModelClient {
  private baseUrl: string

  constructor(baseUrl = 'http://127.0.0.1:8010') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async generate(request: GenerateRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`RoseModel /generate returned ${res.status}: ${body}`)
    }

    if (!res.body) {
      // Non-streaming fallback: read once, parse as JSON or plain text.
      const text = await res.text()
      return this.fallbackParse(text)
    }

    return this.consumeStream(res.body)
  }

  private async consumeStream(body: ReadableStream<Uint8Array>): Promise<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8')
    const contentChunks: string[] = []
    const pendingToolIds: string[] = []
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: true })
        if (done) {
          buffer += decoder.decode()
          buffer = buffer.replace(/\r\n/g, '\n')
          this.drainEvents(buffer, contentChunks, pendingToolIds, true)
          break
        }
        buffer = this.drainEvents(buffer.replace(/\r\n/g, '\n'), contentChunks, pendingToolIds, false)
      }
    } finally {
      try { reader.releaseLock() } catch {}
    }

    return contentChunks.join('')
  }

  // Consumes complete events from the buffer (terminated by "\n\n") and dispatches them.
  // Returns the remainder that hasn't been processed yet.
  private drainEvents(
    buffer: string,
    contentChunks: string[],
    pendingToolIds: string[],
    flush: boolean
  ): string {
    let remainder = buffer
    while (true) {
      const boundary = remainder.indexOf('\n\n')
      if (boundary < 0) {
        // If flushing at EOF, process any trailing event without a boundary.
        if (flush && remainder.trim().length > 0) {
          this.dispatchEvent(this.parseEvent(remainder), contentChunks, pendingToolIds)
          return ''
        }
        return remainder
      }
      const eventText = remainder.slice(0, boundary)
      remainder = remainder.slice(boundary + 2)
      this.dispatchEvent(this.parseEvent(eventText), contentChunks, pendingToolIds)
    }
  }

  private parseEvent(block: string): SSEEvent {
    let event = 'message'
    const dataLines: string[] = []
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (!line) continue
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    return { event, data: dataLines.join('\n') }
  }

  private dispatchEvent(
    evt: SSEEvent,
    contentChunks: string[],
    pendingToolIds: string[]
  ): void {
    if (!evt.data || evt.data === '[DONE]') return

    let parsed: unknown
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      parsed = evt.data
    }

    const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>

    switch (evt.event) {
      case 'token':
      case 'message': {
        const content =
          typeof obj.content === 'string' ? obj.content :
          typeof obj.token === 'string' ? obj.token :
          typeof obj.text === 'string' ? obj.text :
          typeof parsed === 'string' ? (parsed as string) : ''
        if (content) contentChunks.push(content)
        return
      }
      case 'tool_call': {
        const name = typeof obj.tool === 'string' ? obj.tool : 'tool'
        const params =
          obj.params && typeof obj.params === 'object'
            ? (obj.params as Record<string, unknown>)
            : {}
        const id = `tool-${++toolCallCounter}-${Date.now()}`
        pendingToolIds.push(id)
        notifyRenderer(IPC.AI_TOOL_CALL_START, { id, name, params })
        return
      }
      case 'tool_result': {
        const id = pendingToolIds.shift()
        if (!id) return
        const success = obj.success === true
        const resultText =
          typeof obj.content === 'string' && obj.content.length > 0
            ? obj.content
            : typeof obj.error === 'string' && obj.error.length > 0
              ? obj.error
              : ''
        notifyRenderer(IPC.AI_TOOL_CALL_END, {
          id,
          result: resultText,
          error: !success
        })
        return
      }
      case 'done':
      case 'context_warning':
      default:
        return
    }
  }

  private fallbackParse(text: string): string {
    try {
      const data = JSON.parse(text)
      if (typeof data === 'string') return data
      if (data && typeof data.content === 'string') return data.content
      if (data && typeof data.response === 'string') return data.response
      if (data && data.message && typeof data.message.content === 'string') return data.message.content
      return JSON.stringify(data)
    } catch {
      return text
    }
  }

  async compress(messages: Message[]): Promise<Message[]> {
    const res = await fetch(`${this.baseUrl}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages } as CompressRequest)
    })

    if (!res.ok) {
      throw new Error(`RoseModel /compress returned ${res.status}`)
    }

    const data: CompressResponse = await res.json()
    return data.messages
  }
}
