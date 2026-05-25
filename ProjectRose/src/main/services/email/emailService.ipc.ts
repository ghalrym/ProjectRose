import { defineIpc, method } from '../../../shared/ipc/defineIpc'
import type {
  DraftMessageArgs,
  EmailFolder,
  EmailMessage,
  EmailMessageSummary,
  EmailStatus,
  ForwardArgs,
  ListMessagesArgs,
  ReplyArgs,
  SaveImapTransportArgs,
  SearchArgs,
  SendMessageArgs
} from '../../../shared/email'

// IPC manifest for the rose-email built-in. Bound flat on window.api.email.*
// in src/preload/index.ts. The renderer's InboxPage + EmailSettings consume
// these directly; the agent's email tools call the same emailService
// functions internally (toolHandlers don't go through IPC).

export const emailIpc = defineIpc('email', {
  // Status + configuration
  getStatus: method<[], EmailStatus>(),
  saveImap: method<[args: SaveImapTransportArgs], EmailStatus>(),
  activateGoogle: method<[], EmailStatus>(),
  clearTransport: method<[], EmailStatus>(),

  // Read
  listFolders: method<[], EmailFolder[]>(),
  listMessages: method<[args: ListMessagesArgs], EmailMessageSummary[]>(),
  search: method<[args: SearchArgs], EmailMessageSummary[]>(),
  getMessage: method<[messageId: string], EmailMessage>(),

  // Compose
  draftMessage: method<[args: DraftMessageArgs], { draftId: string }>(),
  sendMessage: method<[args: SendMessageArgs], { messageId: string }>(),
  reply: method<[args: ReplyArgs], { messageId: string }>(),
  forward: method<[args: ForwardArgs], { messageId: string }>(),

  // Triage
  markRead: method<[payload: { messageId: string; read: boolean }], void>(),
  archive: method<[messageId: string], void>(),
  move: method<[payload: { messageId: string; folder: string }], void>(),
  label: method<[payload: { messageId: string; label: string; add: boolean }], void>(),
  deleteMessage: method<[messageId: string], void>()
})
