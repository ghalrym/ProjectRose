export interface CatalogEntry {
  id: string
  name: string
  description: string
  author: string
  repoUrl: string
}

export const BUILTIN_CATALOG: CatalogEntry[] = [
  {
    id: 'rose-crm',
    name: 'CRM',
    description: 'Contact management — store and retrieve people and places for the AI agent.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-crm.git'
  },
  {
    id: 'rose-discord',
    name: 'Discord',
    description: 'Discord channel integration and messaging.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-discord.git'
  },
  {
    id: 'rose-docker',
    name: 'Docker',
    description: 'Docker container management.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-docker.git'
  },
  {
    id: 'rose-email',
    name: 'Email',
    description: 'IMAP email management with spam filtering and prompt-injection quarantine.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-email.git'
  },
  {
    id: 'rose-git',
    name: 'Git',
    description: 'Git repository management with diff viewer and staging area.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-git.git'
  },
  {
    id: 'rose-heartbeat',
    name: 'Heartbeat',
    description: 'Automatically processes deferred tasks and scheduled work on a configurable interval.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-heartbeat.git'
  }
]
