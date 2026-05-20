import { app } from 'electron'
import { join } from 'path'
import { mkdir } from 'fs/promises'

export const AGENT_HOME_DIRNAME = '.rose'

export function agentHomePath(): string {
  return join(app.getPath('home'), AGENT_HOME_DIRNAME)
}

export function agentSettingsPath(): string {
  return join(agentHomePath(), 'settings.json')
}

export function agentRoseMdPath(): string {
  return join(agentHomePath(), 'ROSE.md')
}

export function recentWorkspacesPath(): string {
  return join(agentHomePath(), 'recent-workspaces.json')
}

export function agentExtensionsDir(): string {
  return join(agentHomePath(), 'extensions')
}

export function agentExtensionInstallPath(extensionId: string): string {
  return join(agentExtensionsDir(), extensionId)
}

export async function ensureAgentHome(): Promise<void> {
  await mkdir(agentExtensionsDir(), { recursive: true })
}
