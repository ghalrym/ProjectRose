import { useEffect } from 'react'
import { useActiveListeningStore, defaultSendDraft } from '../stores/useActiveListeningStore'

/**
 * Lifecycle effect for the active-listening session: open on enable,
 * close on disable. The IPC + event routing live on
 * `useActiveListeningStore.init`; this hook is just the React-side
 * trigger.
 */
export function useActiveListenSession({ enabled, projectPath }: {
  enabled: boolean
  projectPath: string | null
}): void {
  useEffect(() => {
    if (!enabled || !projectPath) return
    return useActiveListeningStore.getState().init(projectPath, { sendDraft: defaultSendDraft })
  }, [enabled, projectPath])
}
