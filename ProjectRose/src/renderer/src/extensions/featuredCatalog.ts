export interface CatalogEntry {
  id: string
  name: string
  description: string
  author: string
  repoUrl: string
}

export const FEATURED_CATALOG: CatalogEntry[] = [
  {
    id: 'rose-bond',
    name: 'Bond',
    description: 'Toggle Bond Bridge smart-home devices on/off. Multi-bridge, IR/RF learn, scenes, rooms, AI tool calls.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-bond.git'
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
  },
  {
    id: 'rose-qwen-director',
    name: 'Qwen Director',
    description: 'Tracks checklists in agent thinking and reminds the agent to finish all tasks before responding to the user.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-qwen-director.git'
  },
  {
    id: 'rose-vllm-tts',
    name: 'vLLM TTS',
    description: 'Streaming text-to-speech via vLLM-Omni-compatible audio endpoints. Speaks the assistant\'s chat replies aloud.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-vllm-tts.git'
  },
  {
    id: 'rose-coding-agents',
    name: 'Coding Agents',
    description: 'Headless harnesses for Claude Code, Codex, and OpenCode. Lets the host agent delegate tasks to other coding agents.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/roseproject-coding-agents.git'
  },
  {
    id: 'rose-wordpress',
    name: 'WordPress',
    description: 'Manage one or more self-hosted WordPress sites via Application Passwords. Posts, pages, custom post types, media, comments, users, taxonomies, plugins, themes, and site settings — for both the user and the AI agent.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-wordpress.git'
  },
  {
    id: 'rose-concretecms',
    name: 'Concrete CMS',
    description: 'Manage one or more self-hosted Concrete CMS v9 sites via OAuth API integrations. Pages, files, users, groups, topics, and attributes — for both the user and the AI agent.',
    author: 'ProjectRose',
    repoUrl: 'https://github.com/RoseAgent/projectrose-concretecms.git'
  }
]
