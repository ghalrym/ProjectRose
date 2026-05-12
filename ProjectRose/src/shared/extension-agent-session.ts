// Type of multi-turn agent session handed to extensions via
// `ctx.openAgentSession(...)`. The runtime implementation lives in the host
// at `src/main/services/agentSession.ts`; this file holds only the shape so
// it can sit on the shared/extension-contract import path (extension code is
// allowed to import from `shared/`, but not from `main/`).
export interface AgentSession {
  send: (text: string) => Promise<string>
  close: () => void
}
