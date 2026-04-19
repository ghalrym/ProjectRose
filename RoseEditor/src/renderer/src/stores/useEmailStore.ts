import { create } from 'zustand'

export interface EmailSummary {
  uid: number
  subject: string
  from: string
  date: string
  read: boolean
}

interface EmailState {
  messages: EmailSummary[]
  selectedUid: number | null
  body: string | null
  loading: boolean
  bodyLoading: boolean
  error: string | null
  fetchMessages: () => Promise<void>
  fetchMessage: (uid: number) => Promise<void>
  deleteMessage: (uid: number) => Promise<void>
  selectMessage: (uid: number) => void
}

export const useEmailStore = create<EmailState>()((set, get) => ({
  messages: [],
  selectedUid: null,
  body: null,
  loading: false,
  bodyLoading: false,
  error: null,

  fetchMessages: async () => {
    set({ loading: true, error: null })
    try {
      const messages = await window.api.email.fetchMessages()
      set({ messages, loading: false })
    } catch (err) {
      set({ loading: false, error: (err as Error).message })
    }
  },

  fetchMessage: async (uid: number) => {
    set({ bodyLoading: true, selectedUid: uid })
    try {
      const body = await window.api.email.fetchMessage(uid)
      set({ body, bodyLoading: false })
    } catch (err) {
      set({ bodyLoading: false, error: (err as Error).message })
    }
  },

  deleteMessage: async (uid: number) => {
    const result = await window.api.email.deleteMessage(uid)
    if (result.ok) {
      const { messages, selectedUid } = get()
      const updated = messages.filter((m) => m.uid !== uid)
      set({
        messages: updated,
        selectedUid: selectedUid === uid ? null : selectedUid,
        body: selectedUid === uid ? null : get().body
      })
    }
  },

  selectMessage: (uid: number) => {
    set({ selectedUid: uid, body: null })
  }
}))
