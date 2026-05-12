import { create } from 'zustand'
import type { SessionMeta } from '../types/chatMessages'

interface SessionsState {
  sessions: SessionMeta[]
  currentSessionId: string | null
  setSessions: (sessions: SessionMeta[]) => void
  setCurrentSessionId: (id: string | null) => void
  upsertSession: (session: SessionMeta) => void
  removeSession: (id: string) => void
  renameSessionLocal: (id: string, title: string) => void
  touchSession: (id: string) => void
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  currentSessionId: null,
  setSessions: (sessions) => set({ sessions }),
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  upsertSession: (session) =>
    set((s) => {
      const exists = s.sessions.some((x) => x.id === session.id)
      return {
        sessions: exists
          ? s.sessions.map((x) => (x.id === session.id ? session : x))
          : [session, ...s.sessions],
      }
    }),
  removeSession: (id) =>
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
  renameSessionLocal: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)),
    })),
  touchSession: (id) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, updatedAt: Date.now() } : x
      ),
    })),
}))
