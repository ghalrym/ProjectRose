import { create } from 'zustand'

export type StatusTone = 'info' | 'success' | 'error' | 'warning'

interface StatusState {
  message: string | null
  tone: StatusTone
  notify: (text: string, opts?: { tone?: StatusTone; durationMs?: number }) => void
  clear: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useStatusStore = create<StatusState>()((set) => ({
  message: null,
  tone: 'info',
  notify: (text, opts) => {
    if (timer) clearTimeout(timer)
    set({ message: text, tone: opts?.tone ?? 'info' })
    timer = setTimeout(() => {
      set({ message: null, tone: 'info' })
      timer = null
    }, opts?.durationMs ?? 3000)
  },
  clear: () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    set({ message: null, tone: 'info' })
  }
}))
