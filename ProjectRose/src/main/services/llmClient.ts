import { streamText, generateText, stepCountIs, tool } from 'ai'
import type { ModelMessage, ToolExecutionOptions } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOllama } from 'ai-sdk-ollama'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import {
  handleReadFile,
  handleWriteFile,
  handleEditFile,
  handleListDirectory,
  handleGrep,
  handleRunCommand,
  handleSearchWeb
} from './toolHandlers'
import {
  handleMemoryReadDiary,
  handleMemoryListDiary,
  handleMemoryWriteDiary,
  handleMemoryAddBehaviorRecord,
  handleMemoryListBehaviorRecords,
  handleMemoryReadBehaviorRecord,
  handleMemoryRemoveBehaviorRecord,
  handleMemoryNewContact,
  handleMemoryReadContact,
  handleMemorySearchContacts,
  handleMemoryAddContactNote,
  handleMemoryRemoveContactNote,
  handleMemorySetContactKind
} from './memory/tools'
import {
  handleCalendarCreateEvent,
  handleCalendarEditEvent,
  handleCalendarGetEvent,
  handleCalendarListEvents,
  handleCalendarInviteToEvent,
  handleCalendarDeleteEvent
} from './memory/calendarTools'
import {
  handleEmailListMessages,
  handleEmailSearch,
  handleEmailGetMessage,
  handleEmailListFolders,
  handleEmailDraftMessage,
  handleEmailSendMessage,
  handleEmailReply,
  handleEmailForward,
  handleEmailMarkRead,
  handleEmailArchive,
  handleEmailMove,
  handleEmailLabel,
  handleEmailDelete,
  handleEmailListQuarantined,
  handleEmailReleaseFromQuarantine
} from './email/tools'
import type { ExtensionToolCtx } from '../../shared/extension-types'
import type { Message } from '../../shared/roseModelTypes'
import type { ModelConfig } from './settingsService'
import type { InjectionRecord } from '../../shared/extensionHooks'
import { fireThoughtHook, fireMessageHook, fireTokenHook } from './extensionHooks'
import { loadSession } from '../lib/session'
import { WEB_BASE_URL } from '../lib/webConfig'
import { sessionRegistry } from './sessionRegistry'
import { toolRegistry, wrapExecute } from './toolRegistry'
import type { ToolSourceContext, EmitFn, HookCtx, ToolSourceName, SubagentTurnContext } from './toolRegistry'
import { readRecentInteractions } from './interactionLog'
import { INTERACTION_LOG_CAPACITY } from '../../shared/interactionLog'
import type { ScreenshotResult } from './chatSession'

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

// Screenshot tool result shape — declared on the session module so it sits
// next to the pending-screenshots Map that owns it; re-exported here for
// callers that historically imported it from llmClient.
export type { ScreenshotResult } from './chatSession'

// SSE chunk patcher for the projectrose Responses endpoint. Tracks the
// output_index assigned to each item by response.output_item.added events,
// then back-fills the field on response.function_call_arguments.delta events
// (which the backend currently emits without it). Also injects the required
// status: "completed" on response.output_item.done events for function_call
// items. Returns the line unchanged if it isn't a data line we know about.
function patchProjectroseSseLine(
  line: string,
  itemIdToOutputIndex: Map<string, number>
): string {
  const trailing = line.match(/\r?\n$/)?.[0] ?? ''
  const content = trailing ? line.slice(0, -trailing.length) : line
  if (!content.startsWith('data:')) return line

  const jsonText = content.slice('data:'.length).replace(/^ /, '')
  if (jsonText === '' || jsonText === '[DONE]') return line

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    return line
  }

  if (
    obj.type === 'response.output_item.added' &&
    typeof obj.output_index === 'number'
  ) {
    const item = obj.item as { id?: unknown } | undefined
    if (item && typeof item.id === 'string') {
      itemIdToOutputIndex.set(item.id, obj.output_index)
    }
  }

  let mutated = false
  if (
    obj.type === 'response.function_call_arguments.delta' &&
    obj.output_index === undefined &&
    typeof obj.item_id === 'string'
  ) {
    const idx = itemIdToOutputIndex.get(obj.item_id)
    if (typeof idx === 'number') {
      obj.output_index = idx
      mutated = true
    }
  }

  if (obj.type === 'response.output_item.done') {
    const item = obj.item as { type?: unknown; status?: unknown } | undefined
    if (item && item.type === 'function_call' && item.status === undefined) {
      item.status = 'completed'
      mutated = true
    }
  }

  if (!mutated) return line
  return `data: ${JSON.stringify(obj)}${trailing}`
}

const patchProjectroseResponsesFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init)
  if (!response.body) return response
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) return response

  const itemIdToOutputIndex = new Map<string, number>()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx + 1)
        buffer = buffer.slice(newlineIdx + 1)
        controller.enqueue(encoder.encode(patchProjectroseSseLine(line, itemIdToOutputIndex)))
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(patchProjectroseSseLine(buffer, itemIdToOutputIndex)))
        buffer = ''
      }
    }
  })

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveModel(
  model: ModelConfig,
  ollamaBaseUrl: string
): Promise<any> {
  switch (model.provider) {
    case 'ollama': {
      // Workaround for ai-sdk-ollama 3.8.3: it omits tool_call_id on role:"tool" messages,
      // which breaks the link to the assistant's tool_calls and confuses models like Qwen3.
      const patchedFetch: typeof fetch = async (input, init) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body)
            if (Array.isArray(body.messages)) {
              const pending: Array<{ id: string; name: string }> = []
              let mutated = false
              for (const msg of body.messages) {
                if (msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
                  for (const tc of msg.tool_calls) {
                    const id = tc?.id
                    const name = tc?.function?.name ?? tc?.name
                    if (typeof id === 'string' && typeof name === 'string') {
                      pending.push({ id, name })
                    }
                  }
                } else if (msg && msg.role === 'tool' && !msg.tool_call_id) {
                  const idx = pending.findIndex((p) => p.name === msg.tool_name)
                  if (idx !== -1) {
                    msg.tool_call_id = pending[idx].id
                    pending.splice(idx, 1)
                    mutated = true
                  }
                }
              }
              if (mutated) {
                init = { ...init, body: JSON.stringify(body) }
              }
            }
          } catch {
            // not JSON or unexpected shape — pass through unchanged
          }
        }
        return globalThis.fetch(input, init)
      }
      const provider = createOllama({
        baseURL: ollamaBaseUrl || 'http://localhost:11434',
        fetch: patchedFetch
      })
      return provider(model.modelName || 'llama3', { think: true })
    }
    case 'projectrose':
    default: {
      const session = await loadSession()
      const token = session?.token ?? ''
      const provider = createOpenAI({
        apiKey: token,
        baseURL: `${WEB_BASE_URL}/api/openai`,
        // Workaround for the managed Responses endpoint: its SSE stream omits
        // two fields that @ai-sdk/openai 3.x strictly validates, so tool calls
        // never reach the SDK's `tool-call` emit path:
        //   1. `output_index` on response.function_call_arguments.delta
        //   2. `status: "completed"` on response.output_item.done items of
        //       type function_call
        // Until the backend is fixed, rewrite each SSE event on the way in
        // and fill the missing fields before the SDK parses the chunk.
        fetch: patchProjectroseResponsesFetch
      })
      // Explicit .responses() — hits /api/openai/responses. The bare provider()
      // call resolves to the same thing in @ai-sdk/openai 3.x but explicit
      // beats implicit, and reasoning streams (response.reasoning_summary_text.delta)
      // only flow through the Responses transport.
      return provider.responses(model.modelName || 'managed')
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCoreTools(ctx: ToolSourceContext): Record<string, any> {
  const { rootPath: projectRoot, emit, toolCtx, hookCtx } = ctx
  return {
    read_file: tool({
      description: 'Read the contents of a file. Use project-relative paths.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the project root')
      }),
      execute: wrapExecute('read_file', handleReadFile, projectRoot, emit, toolCtx, hookCtx)
    }),
    write_file: tool({
      description: 'Write content to a file. Creates the file and any missing parent directories if they do not exist.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the project root'),
        content: z.string().describe('The full file content to write')
      }),
      execute: wrapExecute('write_file', handleWriteFile, projectRoot, emit, toolCtx, hookCtx)
    }),
    edit_file: tool({
      description: 'Replace a unique string in a file with new content. Fails if old_string is not found or appears more than once — add more surrounding context to disambiguate.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the project root'),
        old_string: z.string().describe('Exact string to find and replace. Must appear exactly once in the file.'),
        new_string: z.string().describe('String to replace old_string with')
      }),
      execute: wrapExecute('edit_file', handleEditFile, projectRoot, emit, toolCtx, hookCtx)
    }),
    list_directory: tool({
      description: 'List files and subdirectories in a directory.',
      inputSchema: z.object({
        path: z.string().describe('Directory path relative to the project root. Use "." for the root.')
      }),
      execute: wrapExecute('list_directory', handleListDirectory, projectRoot, emit, toolCtx, hookCtx)
    }),
    grep: tool({
      description: 'Search file contents for a regex pattern. Returns matching lines as file:line: text. Searches the entire project by default; narrow with path or include.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().optional().describe('Directory to search in, relative to project root (default: entire project)'),
        include: z.string().optional().describe('Comma-separated file extensions to include, e.g. ".ts,.tsx" or "*.py"'),
        case_sensitive: z.boolean().optional().describe('Case-sensitive match (default: false)')
      }),
      execute: wrapExecute('grep', handleGrep, projectRoot, emit, toolCtx, hookCtx)
    }),
    run_command: tool({
      description: 'Run a shell command in the project directory. Use for installing packages, running tests, linting, etc. Returns stdout/stderr.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute')
      }),
      execute: wrapExecute('run_command', handleRunCommand, projectRoot, emit, toolCtx, hookCtx)
    }),
    ask_user: tool({
      description: 'Ask the user a clarifying question and wait for their response before continuing. Use when you need input or a decision from the user. Provide 2–6 multiple-choice options when relevant.',
      inputSchema: z.object({
        question: z.string().describe('The question to ask the user'),
        options: z.array(z.string()).optional().describe('2–6 multiple-choice options for the user to select from')
      }),
      execute: async (input, options) => {
        const id = options.toolCallId
        const session = sessionRegistry.get(toolCtx.sessionId)
        if (!session) {
          // No registered session — happens only if the tool runs outside a
          // ChatSession-managed turn (no current path does this). Return
          // the cancelled sentinel rather than hang forever.
          return '[cancelled]'
        }
        return new Promise<string>((resolve) => {
          session.pendingAskUser.set(id, resolve)
          emit(IPC.AI_ASK_USER, { sessionId: session.sessionId, questionId: id, question: input.question, options: input.options ?? [] })
        })
      }
    }),
    screenshot: tool({
      description: 'Capture a single frame from whatever the user is currently sharing (screen, window, or camera) and attach the image to your context. Only works when the user has share-screen or camera mode enabled in the chat composer; returns an error otherwise. Useful when you need to see the user\'s current screen state or look at them through their camera.',
      inputSchema: z.object({}),
      execute: async (_input, options): Promise<string> => {
        const id = options.toolCallId
        const sessionId = toolCtx.sessionId
        emit(IPC.AI_TOOL_CALL_START, { sessionId, id, name: 'screenshot', params: {} })
        const session = sessionRegistry.get(sessionId)
        const cancelled: ScreenshotResult = { ok: false, reason: 'cancelled' }
        if (!session) {
          // No registered session — no current path reaches this branch.
          // Return the cancelled sentinel rather than hang forever.
          emit(IPC.AI_TOOL_CALL_END, { sessionId, id, result: cancelled.reason, error: true })
          return JSON.stringify(cancelled)
        }
        const result = await new Promise<ScreenshotResult>((resolve) => {
          session.pendingScreenshots.set(id, resolve)
          // sessionId rides along so the renderer can echo it back unchanged
          // on AI_CAPTURE_SCREENSHOT_RESULT — no need for the renderer to
          // reach into a sessions store.
          emit(IPC.AI_CAPTURE_SCREENSHOT, { requestId: id, sessionId: session.sessionId })
        })
        if (!result.ok) {
          emit(IPC.AI_TOOL_CALL_END, { sessionId, id, result: result.reason, error: true })
        } else {
          const summary = `Captured ${result.mode} frame${result.sourceLabel ? ` (${result.sourceLabel})` : ''}`
          emit(IPC.AI_TOOL_CALL_END, { sessionId, id, result: summary, error: false })
        }
        return JSON.stringify(result)
      },
      toModelOutput: ({ output }) => {
        let parsed: ScreenshotResult
        try {
          parsed = typeof output === 'string' ? JSON.parse(output) : (output as ScreenshotResult)
        } catch {
          return { type: 'error-text', value: 'Failed to parse screenshot result.' }
        }
        if (!parsed.ok) {
          return { type: 'error-text', value: parsed.reason }
        }
        const commaIdx = parsed.dataUrl.indexOf(',')
        const base64 = commaIdx >= 0 ? parsed.dataUrl.slice(commaIdx + 1) : parsed.dataUrl
        return {
          type: 'content',
          value: [
            {
              type: 'text',
              text: `Screenshot of ${parsed.mode}${parsed.sourceLabel ? ` (${parsed.sourceLabel})` : ''}.`
            },
            { type: 'media', data: base64, mediaType: 'image/jpeg' }
          ]
        }
      }
    }),
    search_web: tool({
      description: 'Search the web for up-to-date information. Use when the user asks about current events, documentation, libraries, or anything that may have changed since the model was trained. Returns the search API response as JSON containing result titles, URLs, and snippets.',
      inputSchema: z.object({
        query: z.string().describe('The search query — natural language is fine'),
        numResults: z.number().optional().describe('Maximum number of results to return (server picks a default if omitted)')
      }),
      execute: wrapExecute('search_web', handleSearchWeb, projectRoot, emit, toolCtx, hookCtx)
    }),
    // ── Memory subsystem (~/.rose/memory/) ────────────────────────────────
    // Diary, behaviour records, and contacts are agent-global — they live in
    // ~/.rose/ alongside ROSE.md so the Agent carries them across every
    // Workspace it operates in.
    memory_read_diary: tool({
      description: 'Read your diary entry for a given date. Use this to recall what happened on a previous day.',
      inputSchema: z.object({
        date: z.string().describe('Date key in yyyy-mm-dd format')
      }),
      execute: wrapExecute('memory_read_diary', handleMemoryReadDiary, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_list_diary: tool({
      description: 'List the dates of your existing diary entries. Optional from/to bounds (yyyy-mm-dd, inclusive).',
      inputSchema: z.object({
        from: z.string().optional().describe('Inclusive lower bound, yyyy-mm-dd'),
        to: z.string().optional().describe('Inclusive upper bound, yyyy-mm-dd')
      }),
      execute: wrapExecute('memory_list_diary', handleMemoryListDiary, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_write_diary: tool({
      description: 'Write or overwrite your diary entry for a given date. Normally called only by the daily scheduler — use sparingly outside of that flow.',
      inputSchema: z.object({
        date: z.string().optional().describe('Date key in yyyy-mm-dd format (defaults to today)'),
        content: z.string().describe('Full markdown body of the diary entry')
      }),
      execute: wrapExecute('memory_write_diary', handleMemoryWriteDiary, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_add_behavior_record: tool({
      description: 'Record a standing behaviour directive the user has given you ("from now on, always X"; "don\'t Y"; "prefer Z"). Use when the user expresses a durable preference about how you should act. The decision + details are written to a dated markdown file the user can review later.',
      inputSchema: z.object({
        slug: z.string().describe('Short kebab-case identifier for the behaviour, e.g. "ask-before-pushing-main"'),
        decision: z.string().describe('One-line summary of the behaviour the user wants'),
        details: z.string().describe('Longer explanation: why the user wants this, when it applies, what the impact on your behaviour should be')
      }),
      execute: wrapExecute('memory_add_behavior_record', handleMemoryAddBehaviorRecord, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_list_behavior_records: tool({
      description: 'List every behaviour record the user has given you. Use at the start of work in an unfamiliar context to refresh your standing directives.',
      inputSchema: z.object({}),
      execute: wrapExecute('memory_list_behavior_records', handleMemoryListBehaviorRecords, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_read_behavior_record: tool({
      description: 'Read the full text of a behaviour record by filename.',
      inputSchema: z.object({
        filename: z.string().describe('Filename returned by memory_list_behavior_records, e.g. 2026-05-21-ask-before-pushing-main.md')
      }),
      execute: wrapExecute('memory_read_behavior_record', handleMemoryReadBehaviorRecord, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_remove_behavior_record: tool({
      description: 'Delete a behaviour record. Use only when the user explicitly retracts a directive.',
      inputSchema: z.object({
        filename: z.string().describe('Filename of the record to remove')
      }),
      execute: wrapExecute('memory_remove_behavior_record', handleMemoryRemoveBehaviorRecord, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_new_contact: tool({
      description: 'Create an empty contact entry for a person, business, website, or other entity. Notes are added separately via memory_add_contact_note. The `kind` classification is what gates Google Contacts sync — set it accurately if you can.',
      inputSchema: z.object({
        entity: z.string().describe('Name of the person/business/website/other'),
        kind: z.enum(['person', 'business', 'website', 'other']).optional().describe('Classification — defaults to "other" if omitted. Set this when you know.')
      }),
      execute: wrapExecute('memory_new_contact', handleMemoryNewContact, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_set_contact_kind: tool({
      description: 'Update the kind classification of an existing contact (person / business / website / other). Use this when you learn a contact you previously created is actually a different kind than you initially assumed.',
      inputSchema: z.object({
        entity: z.string().describe('Name of the contact'),
        kind: z.enum(['person', 'business', 'website', 'other']).describe('New classification')
      }),
      execute: wrapExecute('memory_set_contact_kind', handleMemorySetContactKind, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_read_contact: tool({
      description: 'Read every note you have about a person/place/thing by name.',
      inputSchema: z.object({
        entity: z.string().describe('Name of the contact to read')
      }),
      execute: wrapExecute('memory_read_contact', handleMemoryReadContact, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_search_contacts: tool({
      description: 'Search your contacts using one or more query strings (case-insensitive substring). Each query is checked against every contact\'s name and notes; a contact becomes a hit if at least one query matches anywhere. Returns JSON: { queries: string[], hits: [{ entity, kind, matchedQueryCount, totalMatches, nameMatches: string[], noteMatches: [{ note, queries }], contact: <markdown if a query matched the name, else null> }] }. Hits are ranked highest first — more distinct queries matched is the primary signal, then total match count, then alphabetical. Pass multiple queries to look up several candidates at once (e.g. variant spellings, related people, related topics).',
      inputSchema: z.object({
        queries: z.array(z.string()).min(1).describe('One or more terms to search for in contact names and notes. Each is matched independently; results combine and rank by match count.')
      }),
      execute: wrapExecute('memory_search_contacts', handleMemorySearchContacts, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_add_contact_note: tool({
      description: 'Append a note to a contact. Creates the contact if it does not yet exist. Notes are bullets in the contact\'s markdown file.',
      inputSchema: z.object({
        entity: z.string().describe('Name of the contact'),
        note: z.string().describe('The note to add (one line, no leading bullet)')
      }),
      execute: wrapExecute('memory_add_contact_note', handleMemoryAddContactNote, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_remove_contact_note: tool({
      description: 'Remove a note from a contact. Matches notes case-insensitively against the supplied text.',
      inputSchema: z.object({
        entity: z.string().describe('Name of the contact'),
        note: z.string().describe('The note text to remove')
      }),
      execute: wrapExecute('memory_remove_contact_note', handleMemoryRemoveContactNote, projectRoot, emit, toolCtx, hookCtx)
    }),
    // ─── rose-calendar (Memory.Event) ──────────────────────────────────
    memory_create_event: tool({
      description: 'Create a calendar event in agent memory. Events store as markdown under ~/.rose/memory/calendar/{yyyy}/{mm}/{dd}/. Times are ISO 8601 — `2026-05-22T14:00` for timed events (pair with `timeZone`), `2026-05-22` for all-day (set `allDay: true`). For recurring events pass `recurrence` as an array of RRULE/RDATE/EXDATE strings (e.g. ["RRULE:FREQ=WEEKLY;BYDAY=TU"]).',
      inputSchema: z.object({
        summary: z.string().describe('Event title'),
        start: z.string().describe('ISO 8601 start time (or date for all-day)'),
        end: z.string().optional().describe('ISO 8601 end time. Defaults to start if omitted.'),
        allDay: z.boolean().optional().describe('Mark as an all-day event (uses date-only values for start/end)'),
        timeZone: z.string().optional().describe('IANA timezone, e.g. America/New_York. Ignored for all-day.'),
        description: z.string().optional(),
        location: z.string().optional(),
        attendees: z.array(z.union([z.string(), z.object({ email: z.string(), displayName: z.string().optional(), responseStatus: z.string().optional() })])).optional().describe('Attendee emails (strings) or {email, displayName?, responseStatus?} objects'),
        recurrence: z.array(z.string()).optional().describe('Array of RRULE/RDATE/EXDATE strings, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=TU"]'),
        calendarId: z.string().optional().describe('Target Google calendar id (defaults to "primary" on push)')
      }),
      execute: wrapExecute('memory_create_event', handleCalendarCreateEvent, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_edit_event: tool({
      description: 'Edit an existing event. Identify it either by `date` + `slug` (the local ref returned by memory_list_events) or by `google_id`. Pass only the fields you want to change.',
      inputSchema: z.object({
        date: z.string().optional().describe('yyyy-mm-dd of the event\'s storage directory'),
        slug: z.string().optional().describe('Filename slug without .md'),
        google_id: z.string().optional().describe('Google iCalUID, as stored in the event\'s google-id bullet'),
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        allDay: z.boolean().optional(),
        timeZone: z.string().optional(),
        attendees: z.array(z.union([z.string(), z.object({ email: z.string(), displayName: z.string().optional(), responseStatus: z.string().optional() })])).optional(),
        recurrence: z.array(z.string()).optional()
      }),
      execute: wrapExecute('memory_edit_event', handleCalendarEditEvent, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_get_event: tool({
      description: 'Fetch the full record of an event (summary, times, description, attendees, recurrence, google ids). Identify by date+slug or google_id.',
      inputSchema: z.object({
        date: z.string().optional(),
        slug: z.string().optional(),
        google_id: z.string().optional()
      }),
      execute: wrapExecute('memory_get_event', handleCalendarGetEvent, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_list_events: tool({
      description: 'List events whose occurrences fall inside a date-time range. Recurring events are expanded via RRULE — you see one row per occurrence. Both bounds are ISO 8601; the upper bound is exclusive.',
      inputSchema: z.object({
        start: z.string().describe('Inclusive lower bound, ISO 8601'),
        end: z.string().describe('Exclusive upper bound, ISO 8601'),
        calendarIds: z.array(z.string()).optional().describe('Restrict to specific Google calendarIds. Local-only events are always included.'),
        limit: z.number().optional().describe('Max occurrences to return (default 100)')
      }),
      execute: wrapExecute('memory_list_events', handleCalendarListEvents, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_invite_to_event: tool({
      description: 'Add attendees to a synced event and trigger Google\'s native invitation email (Google sends the standard calendar invite to each new attendee). The event must already be synced — push it first if it has no google-id.',
      inputSchema: z.object({
        date: z.string().optional(),
        slug: z.string().optional(),
        google_id: z.string().optional(),
        attendees: z.array(z.union([z.string(), z.object({ email: z.string(), displayName: z.string().optional() })])).describe('Attendees to invite — email strings or {email, displayName?} objects')
      }),
      execute: wrapExecute('memory_invite_to_event', handleCalendarInviteToEvent, projectRoot, emit, toolCtx, hookCtx)
    }),
    memory_delete_event: tool({
      description: 'Delete an event. If the event is synced to Google, the remote copy is removed first (and attendees are notified). Local-only events are removed from disk.',
      inputSchema: z.object({
        date: z.string().optional(),
        slug: z.string().optional(),
        google_id: z.string().optional()
      }),
      execute: wrapExecute('memory_delete_event', handleCalendarDeleteEvent, projectRoot, emit, toolCtx, hookCtx)
    }),
    // ─── rose-email: read group ───────────────────────────────────────
    email_list_messages: tool({
      description: 'List messages in a folder. Quarantined messages (suspected prompt-injection) are filtered out and only visible via email_list_quarantined.',
      inputSchema: z.object({
        folder: z.string().optional().describe('Folder/label ID. Defaults to INBOX.'),
        limit: z.number().optional().describe('Max messages to return. Default 50.'),
        query: z.string().optional().describe('Free-text search filter applied server-side.')
      }),
      execute: wrapExecute('email_list_messages', handleEmailListMessages, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_search: tool({
      description: 'Search messages by free-text query. Quarantined messages are excluded.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        folder: z.string().optional().describe('Restrict to a folder/label ID'),
        limit: z.number().optional().describe('Max results. Default 50.')
      }),
      execute: wrapExecute('email_search', handleEmailSearch, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_get_message: tool({
      description: 'Fetch a full message by ID. Triggers quarantine scan on first sight; throws if flagged.',
      inputSchema: z.object({ messageId: z.string().describe('Message ID returned by list/search') }),
      execute: wrapExecute('email_get_message', handleEmailGetMessage, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_list_folders: tool({
      description: 'List available folders/labels.',
      inputSchema: z.object({}),
      execute: wrapExecute('email_list_folders', handleEmailListFolders, projectRoot, emit, toolCtx, hookCtx)
    }),
    // ─── rose-email: compose group ────────────────────────────────────
    email_draft_message: tool({
      description: 'Create a draft (no send). Returns the draft ID.',
      inputSchema: z.object({
        to: z.array(z.object({ address: z.string(), name: z.string().optional() })).describe('Recipients'),
        cc: z.array(z.object({ address: z.string(), name: z.string().optional() })).optional(),
        bcc: z.array(z.object({ address: z.string(), name: z.string().optional() })).optional(),
        subject: z.string(),
        body: z.string(),
        inReplyTo: z.string().optional().describe('Message-Id this draft replies to')
      }),
      execute: wrapExecute('email_draft_message', handleEmailDraftMessage, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_send_message: tool({
      description: 'Send a new message.',
      inputSchema: z.object({
        to: z.array(z.object({ address: z.string(), name: z.string().optional() })),
        cc: z.array(z.object({ address: z.string(), name: z.string().optional() })).optional(),
        bcc: z.array(z.object({ address: z.string(), name: z.string().optional() })).optional(),
        subject: z.string(),
        body: z.string(),
        draftId: z.string().optional().describe('Send a previously-created draft instead')
      }),
      execute: wrapExecute('email_send_message', handleEmailSendMessage, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_reply: tool({
      description: 'Reply to a message.',
      inputSchema: z.object({
        messageId: z.string(),
        body: z.string(),
        replyAll: z.boolean().optional()
      }),
      execute: wrapExecute('email_reply', handleEmailReply, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_forward: tool({
      description: 'Forward a message.',
      inputSchema: z.object({
        messageId: z.string(),
        to: z.array(z.object({ address: z.string(), name: z.string().optional() })),
        body: z.string().optional()
      }),
      execute: wrapExecute('email_forward', handleEmailForward, projectRoot, emit, toolCtx, hookCtx)
    }),
    // ─── rose-email: triage group ─────────────────────────────────────
    email_mark_read: tool({
      description: 'Toggle the read/unread flag on a message.',
      inputSchema: z.object({ messageId: z.string(), read: z.boolean() }),
      execute: wrapExecute('email_mark_read', handleEmailMarkRead, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_archive: tool({
      description: 'Archive a message (Gmail: remove INBOX label; IMAP: move to Archive).',
      inputSchema: z.object({ messageId: z.string() }),
      execute: wrapExecute('email_archive', handleEmailArchive, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_move: tool({
      description: 'Move a message to a different folder/label.',
      inputSchema: z.object({ messageId: z.string(), folder: z.string() }),
      execute: wrapExecute('email_move', handleEmailMove, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_label: tool({
      description: 'Add or remove a label/keyword on a message.',
      inputSchema: z.object({ messageId: z.string(), label: z.string(), add: z.boolean() }),
      execute: wrapExecute('email_label', handleEmailLabel, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_delete: tool({
      description: 'Move a message to Trash. Never hard-deletes.',
      inputSchema: z.object({ messageId: z.string() }),
      execute: wrapExecute('email_delete', handleEmailDelete, projectRoot, emit, toolCtx, hookCtx)
    }),
    // ─── rose-email: quarantine group ─────────────────────────────────
    email_list_quarantined: tool({
      description: 'List messages currently in the prompt-injection quarantine. Bodies remain hidden from read tools until released.',
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: wrapExecute('email_list_quarantined', handleEmailListQuarantined, projectRoot, emit, toolCtx, hookCtx)
    }),
    email_release_from_quarantine: tool({
      description: 'Release a quarantined message so email_get_message will return its body again.',
      inputSchema: z.object({ messageId: z.string() }),
      execute: wrapExecute('email_release_from_quarantine', handleEmailReleaseFromQuarantine, projectRoot, emit, toolCtx, hookCtx)
    }),
    // ── User-interaction log (in-memory ring, capacity 50) ───────────────────
    read_recent_interactions: tool({
      description: `Read the most recent UI actions the user has taken in this app (this session only — the log is in-memory and resets on app restart). Returns up to ${INTERACTION_LOG_CAPACITY} entries, newest last, each shaped as { timestamp, kind, target? }. Use when the user refers to "what I just did", their current view, a setting they toggled, or otherwise expects you to know recent UI context. Kinds include: view.changed (target=view), view.chat-toggled, view.terminal-toggled, chat.message-sent, settings.changed (target=key path, never a value), project.opened, extension.installed/uninstalled/enabled/disabled/opened, email.opened/sent/replied/forwarded/archived/deleted/moved/labeled, contact.created/edited/deleted, calendar.event-created/edited/deleted, routine.created/edited/deleted/fired.`,
      inputSchema: z.object({
        limit: z.number().optional().describe(`Max entries to return (default and max ${INTERACTION_LOG_CAPACITY}).`)
      }),
      execute: wrapExecute(
        'read_recent_interactions',
        async (input) => {
          const rawLimit = typeof input.limit === 'number' ? input.limit : INTERACTION_LOG_CAPACITY
          const limit = Math.max(0, Math.min(INTERACTION_LOG_CAPACITY, Math.floor(rawLimit)))
          const entries = readRecentInteractions(limit)
          return JSON.stringify(entries)
        },
        projectRoot,
        emit,
        toolCtx,
        hookCtx
      )
    })
  }
}

export interface StreamResult {
  content: string
  inputTokens: number
  outputTokens: number
  // Full conversation including the assistant response(s) and any tool messages
  // produced during this streamChat call. Used by aiService.chat to extend the
  // history when an extension hook injects a follow-up message.
  finalMessages: ModelMessage[]
}

function isXmlParseError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('xml syntax error') || lower.includes('expected element type')
}

function toModelMessage(m: Message): ModelMessage {
  if (m.role === 'system') return { role: 'system', content: m.content }
  if (m.role === 'assistant') return { role: 'assistant', content: m.content }
  const atts = m.attachments ?? []
  if (atts.length === 0) return { role: 'user', content: m.content }
  return {
    role: 'user',
    content: [
      { type: 'text', text: m.content },
      ...atts.map((a) => ({ type: 'image' as const, image: a.dataUrl, mediaType: a.mimeType }))
    ]
  }
}

export async function streamChat(params: {
  messages: Message[]
  systemPrompt: string
  enabledExtensionIds?: string[]
  model: ModelConfig
  ollamaBaseUrl: string
  projectRoot: string
  disabledTools?: string[]
  abortSignal?: AbortSignal
  // Optional notify override — defaults to notifyRenderer (main agent).
  // Pass `() => {}` for subagents that should not emit IPC events.
  notify?: EmitFn
  // Which tool sources to ask the registry for. Defaults to all four.
  // `runAgentOnce` and subagents pass `['core', 'extension']` to keep
  // their tool sets bounded (no recursive subagent spawning).
  include?: readonly ToolSourceName[]
  // Per-turn context the subagent factory needs. Only required when
  // `include` contains `'subagent'` (i.e. the main user-visible chat).
  subagentContext?: SubagentTurnContext
  // Called fresh before each step — allows dynamic system prompt updates (e.g. loaded skills).
  getSystemPrompt?: () => string
  // When set, chat hooks fire at segment boundaries and after tool calls.
  // Only the user-visible main chat passes this; subagents and one-shot
  // background runs leave it undefined to keep hooks scoped to the main chat.
  turnId?: string
  // Host chat session id forwarded to extension tool execute() as toolCtx.sessionId.
  // Required so extensions can scope state (e.g. CLI session resume) per chat.
  sessionId: string
  collectInjections?: (rec: InjectionRecord) => void
  // Escape hatch for the auto-injection loop: when set, skip the Message[] →
  // ModelMessage[] conversion and use these directly. Lets the loop preserve
  // full assistant tool-call structure across iterations (Message[] is lossy).
  preBuiltCoreMessages?: ModelMessage[]
}): Promise<StreamResult> {
  const { messages, systemPrompt, enabledExtensionIds, model: modelConfig, ollamaBaseUrl, projectRoot, disabledTools, abortSignal } = params
  const emit: EmitFn = params.notify ?? notifyRenderer
  const hookCtx: HookCtx | undefined = params.turnId ? { turnId: params.turnId, rootPath: projectRoot } : undefined
  const toolCtx: ExtensionToolCtx = { sessionId: params.sessionId, turnId: params.turnId }
  const model = await resolveModel(modelConfig, ollamaBaseUrl)
  const tools = toolRegistry.getToolsForSession({
    rootPath: projectRoot,
    emit,
    toolCtx,
    hookCtx,
    disabledTools,
    enabledExtensionIds,
    include: params.include,
    subagent: params.subagentContext
  })

  let coreMessages: ModelMessage[] = params.preBuiltCoreMessages
    ? [...params.preBuiltCoreMessages]
    : messages.map((m) => toModelMessage(m))

  const fireBoundary = async (kind: 'thought' | 'message', content: string): Promise<void> => {
    if (!hookCtx || !params.collectInjections || content.length === 0) return
    // Injection budget lives on the ChatSession — look it up by sessionId.
    // No registered session means we're outside a turn (no current path
    // reaches this branch), in which case skip injecting.
    const session = sessionRegistry.get(params.sessionId)
    if (!session) return
    const rec = kind === 'thought'
      ? await fireThoughtHook(content, hookCtx.turnId, hookCtx.rootPath, session)
      : await fireMessageHook(content, hookCtx.turnId, hookCtx.rootPath, session)
    if (rec) params.collectInjections(rec)
  }

  let accumulatedText = ''
  let inputTokens = 0
  let outputTokens = 0
  // Some upstream models prefix the first message delta with stray newlines
  // (e.g. minimax). Swallow leading whitespace until the first real character.
  let textStarted = false

  for (let stepNum = 0; stepNum < 100; stepNum++) {
    let hadTools = false
    let finishReason: string | undefined

    // Inner retry loop — retries up to 2 times on XML parse errors from models like QWEN
    // that use XML-based tool calling and occasionally produce malformed output.
    for (let xmlRetries = 0; xmlRetries <= 2; xmlRetries++) {
      const result = streamText({
        model,
        system: params.getSystemPrompt?.() ?? systemPrompt,
        messages: coreMessages,
        tools,
        stopWhen: stepCountIs(1),
        abortSignal
      })

      let stepError: Error | null = null
      // Per-step segment buffers. A "segment" is a contiguous run of text-delta
      // or reasoning-delta chunks; the boundary is detected when the chunk type
      // changes. At each boundary we fire on_thought / on_message hooks with
      // the buffered content. Reset on every retry so a partial buffered
      // segment from a failed attempt does not leak into the retry.
      let textBuffer = ''
      let thinkingBuffer = ''

      try {
        for await (const chunk of result.fullStream) {
          // Boundary detection: flush buffers when transitioning to a different
          // chunk type. Tool-call chunks, finish chunks, etc. all close out
          // any in-flight text/thinking segments so hooks see contiguous content.
          if (chunk.type !== 'text-delta' && textBuffer.length > 0) {
            const flushed = textBuffer
            textBuffer = ''
            await fireBoundary('message', flushed)
          }
          if (chunk.type !== 'reasoning-delta' && thinkingBuffer.length > 0) {
            const flushed = thinkingBuffer
            thinkingBuffer = ''
            await fireBoundary('thought', flushed)
          }

          switch (chunk.type) {
            case 'text-delta':
              if (chunk.text) {
                let token = chunk.text
                if (!textStarted) {
                  token = token.replace(/^\s+/, '')
                  if (token.length === 0) break
                  textStarted = true
                }
                accumulatedText += token
                textBuffer += token
                emit(IPC.AI_TOKEN, { sessionId: params.sessionId, token })
                // Notify on_token hooks. Voided so a slow handler never stalls
                // streaming — handlers must self-throttle if they need to.
                if (hookCtx) void fireTokenHook(token, hookCtx.turnId, hookCtx.rootPath)
              }
              break
            case 'reasoning-delta':
              if (chunk.text) {
                thinkingBuffer += chunk.text
                emit(IPC.AI_THINKING, { sessionId: params.sessionId, content: chunk.text })
              }
              break
            case 'finish':
              if (chunk.totalUsage) {
                inputTokens += chunk.totalUsage.inputTokens ?? 0
                outputTokens += chunk.totalUsage.outputTokens ?? 0
              }
              break
            case 'error': {
              const e = chunk.error
              const errMsg = e instanceof Error ? e.message : (
                typeof e === 'object' && e !== null && 'message' in e
                  ? String((e as { message: unknown }).message)
                  : JSON.stringify(e)
              )
              if (e instanceof Error) throw e
              throw new Error(errMsg)
            }
          }
        }

        // End-of-stream flush in case the stream ended on a text/reasoning
        // delta without a separate boundary chunk.
        if (textBuffer.length > 0) {
          const flushed = textBuffer
          textBuffer = ''
          await fireBoundary('message', flushed)
        }
        if (thinkingBuffer.length > 0) {
          const flushed = thinkingBuffer
          thinkingBuffer = ''
          await fireBoundary('thought', flushed)
        }

        const steps = await result.steps
        const resp = await result.response
        const lastStep = steps.at(-1)
        hadTools = (lastStep?.toolCalls?.length ?? 0) > 0
        finishReason = lastStep?.finishReason
        coreMessages = [...coreMessages, ...resp.messages]
      } catch (err) {
        stepError = err instanceof Error ? err : new Error(String(err))
      }

      if (!stepError) break  // step succeeded — exit retry loop
      if (isXmlParseError(stepError.message) && xmlRetries < 2) continue
      throw stepError
    }

    if (!hadTools || finishReason === 'length' || finishReason === 'content-filter') break
  }

  return { content: accumulatedText, inputTokens, outputTokens, finalMessages: coreMessages }
}


// Renderer-shaped message: structural subset of the renderer's ChatMessage union.
// Defined here as Record<string, unknown> to avoid an import cycle with the
// renderer module — fields are pulled out by name with runtime checks.
type RendererMessage = Record<string, unknown>

// Output shape sent to the LLM. Matches what the renderer's buildApiMessages
// produces from settled renderer messages.
export interface ApiShapeMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// Number of trailing turns left untouched by compression. A "turn" starts at a
// user message and ends just before the next user message (or end of list).
// Holding back the recent two means the model still sees the active back-and-forth
// verbatim while older history collapses into summaries.
const KEEP_RECENT_TURNS = 2

interface Turn {
  // Indices into the input renderer-message array, inclusive.
  start: number
  end: number
  // Indices into the api-shape view (post-filter to user/assistant/injected).
  apiStart: number
  apiEnd: number
}

function isApiShape(role: unknown): role is 'user' | 'assistant' | 'injected' {
  return role === 'user' || role === 'assistant' || role === 'injected'
}

function rendererToApi(m: RendererMessage): ApiShapeMessage | null {
  const role = m.role
  const content = typeof m.content === 'string' ? m.content : ''
  if (role === 'user') return { role: 'user', content }
  if (role === 'assistant') return { role: 'assistant', content }
  if (role === 'injected') {
    const extName = typeof m.extensionName === 'string' ? m.extensionName : 'extension'
    return { role: 'system', content: `[Extension ${extName}] ${content}` }
  }
  return null
}

// Walk renderer messages and produce one Turn per user message. The first turn
// covers any leading non-user messages too (shouldn't normally happen, but if
// the session starts with system/injected content it still gets grouped).
function splitIntoTurns(messages: RendererMessage[]): Turn[] {
  const turns: Turn[] = []
  let currentStart = 0
  let currentApiStart = 0
  let apiIdx = 0
  let started = false

  for (let i = 0; i < messages.length; i++) {
    const role = messages[i].role
    if (role === 'user') {
      if (started) {
        turns.push({
          start: currentStart,
          end: i - 1,
          apiStart: currentApiStart,
          apiEnd: apiIdx - 1,
        })
      }
      currentStart = i
      currentApiStart = apiIdx
      started = true
    }
    if (isApiShape(role)) apiIdx++
  }
  if (started) {
    turns.push({
      start: currentStart,
      end: messages.length - 1,
      apiStart: currentApiStart,
      apiEnd: apiIdx - 1,
    })
  }
  return turns
}

// Build a compact text representation of one old turn that the summarizer can
// digest. Mentions tools used (with success/error) so the summary can name them
// even though tool messages never round-trip to the LLM in normal chat.
function describeTurnForSummary(messages: RendererMessage[], turn: Turn): string {
  const lines: string[] = []
  for (let i = turn.start; i <= turn.end; i++) {
    const m = messages[i]
    const role = m.role
    const content = typeof m.content === 'string' ? m.content : ''
    if (role === 'user') {
      lines.push(`USER: ${content}`)
    } else if (role === 'assistant') {
      if (content.trim().length > 0) lines.push(`ASSISTANT: ${content}`)
    } else if (role === 'tool') {
      const name = typeof m.name === 'string' ? m.name : 'tool'
      const error = m.error === true
      const result = typeof m.result === 'string' ? m.result : ''
      const snippet = result.length > 200 ? result.slice(0, 200) + '…' : result
      lines.push(`TOOL ${name}${error ? ' (error)' : ''}: ${snippet}`)
    } else if (role === 'ask_user') {
      const q = typeof m.question === 'string' ? m.question : ''
      const a = typeof m.answer === 'string' ? m.answer : ''
      lines.push(`ASK_USER: ${q} → ${a}`)
    } else if (role === 'injected') {
      const extName = typeof m.extensionName === 'string' ? m.extensionName : 'extension'
      lines.push(`INJECTED [${extName}]: ${content}`)
    }
  }
  return lines.join('\n')
}

export interface CompressionResult {
  // Replacement view for the first `compressedFromCount` items of the
  // renderer's api-shape messages. The renderer substitutes them in before
  // sending the next chat call.
  compressedMessages: ApiShapeMessage[]
  // Number of original api-shape messages this view replaces. Used by the
  // renderer to slice out the substituted prefix.
  compressedFromCount: number
  // Raw renderer-message counterpart of compressedFromCount. Includes the
  // kept-verbatim recent-turn raw messages, since those are also embedded in
  // compressedMessages. Used by status reporting to count tool steps only in
  // the post-compression tail.
  compressedFromRawCount: number
  // How many older turns this snapshot folded into the summary. Surfaced in
  // the renderer's timeline divider so the user can see what got compressed.
  compressedTurnCount: number
}

// Discriminated outcome for a compression attempt. Every failure mode the
// renderer needs to surface to the user gets its own arm — keep this in sync
// with the renderer's compressNow() notify switch.
export type CompressionOutcome =
  | { status: 'compressed'; result: CompressionResult }
  | { status: 'too-short'; turnCount: number }
  | { status: 'no-model' }
  | { status: 'failed'; message: string }

export async function compressTurnsForContext(
  messages: RendererMessage[],
  modelConfig: ModelConfig,
  ollamaBaseUrl: string,
  // How many of the most recent turns to keep verbatim after the summary.
  // The auto-suggested compression keeps KEEP_RECENT_TURNS so recent context
  // stays sharp; a manual "compress everything" pass passes 0 to fold the
  // whole conversation into the summary.
  keepRecentTurns: number = KEEP_RECENT_TURNS
): Promise<CompressionOutcome> {
  const keep = Math.max(0, keepRecentTurns)
  const turns = splitIntoTurns(messages)
  // Nothing to fold: at keep=N we need more than N turns; at keep=0 we still
  // need at least one turn to summarize.
  if (turns.length <= keep || turns.length === 0) {
    return { status: 'too-short', turnCount: turns.length }
  }

  const oldTurns = turns.slice(0, turns.length - keep)
  const recentTurns = turns.slice(turns.length - keep)

  const oldDescriptions = oldTurns
    .map((t, idx) => `### Turn ${idx + 1}\n${describeTurnForSummary(messages, t)}`)
    .join('\n\n')

  let summary: string
  try {
    const model = await resolveModel(modelConfig, ollamaBaseUrl)
    const summaryPrompt = `You are compressing the older portion of a coding-assistant chat session to keep the model's context focused. For each turn below, write ONE short sentence (max 25 words) that captures: what the user asked, which tools the assistant used, and the outcome. Output as a numbered list with no preamble or trailing remarks.

${oldDescriptions}`
    const out = await generateText({
      model,
      messages: [{ role: 'user' as const, content: summaryPrompt }]
    })
    summary = out.text
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const summaryBlock: ApiShapeMessage = {
    role: 'system',
    content: `Summary of earlier turns in this session (older history compressed to save context):\n${summary.trim()}`
  }

  // Append the recent turns verbatim, in api shape, after the summary.
  const recentApi: ApiShapeMessage[] = []
  for (const t of recentTurns) {
    for (let i = t.start; i <= t.end; i++) {
      const api = rendererToApi(messages[i])
      if (api) recentApi.push(api)
    }
  }

  // compressedMessages already contains the recent turns verbatim, so the
  // substitution covers ALL api-shape messages present at compression time.
  // The renderer slices its current apiMessages by this count and appends any
  // newer ones produced after compression. With keep=0 there are no recent
  // turns, so the boundary is the end of the last folded turn — i.e. the whole
  // conversation collapses to just the summary block.
  const boundaryTurn = recentTurns[recentTurns.length - 1] ?? oldTurns[oldTurns.length - 1]
  const compressedFromCount = boundaryTurn.apiEnd + 1
  const compressedFromRawCount = boundaryTurn.end + 1

  return {
    status: 'compressed',
    result: {
      compressedMessages: [summaryBlock, ...recentApi],
      compressedFromCount,
      compressedFromRawCount,
      compressedTurnCount: oldTurns.length,
    },
  }
}
