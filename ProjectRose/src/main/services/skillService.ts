import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionOptions } from 'ai'
import { prPath } from '../lib/projectPaths'
import { IPC } from '../../shared/ipcChannels'

type EmitFn = (channel: string, payload: unknown) => void

export interface SkillMeta {
  name: string
  description: string
}

export interface SkillContent extends SkillMeta {
  body: string
}

function parseSkillFile(raw: string): { description: string; body: string } {
  if (!raw.startsWith('---')) return { description: '', body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { description: '', body: raw }
  const frontmatter = raw.slice(3, end)
  const body = raw.slice(end + 4).trimStart()
  const match = frontmatter.match(/^description:\s*["']?(.+?)["']?\s*$/m)
  return { description: match ? match[1].trim() : '', body }
}

export async function listSkills(rootPath: string): Promise<SkillMeta[]> {
  const dir = prPath(rootPath, 'skills')
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const skills: SkillMeta[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const { description } = parseSkillFile(raw)
      skills.push({ name: file.slice(0, -3), description })
    } catch {
      // skip unreadable files
    }
  }
  return skills
}

export async function loadSkillContent(rootPath: string, skillName: string): Promise<SkillContent | null> {
  const filePath = prPath(rootPath, 'skills', `${skillName}.md`)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const { description, body } = parseSkillFile(raw)
    return { name: skillName, description, body }
  } catch {
    return null
  }
}

// In-memory per-session skill state — cleared on app restart
const sessionSkills = new Map<string, string[]>()

export function appendSkillToSession(sessionId: string, body: string): void {
  const existing = sessionSkills.get(sessionId) ?? []
  existing.push(body)
  sessionSkills.set(sessionId, existing)
}

export function getSessionSkillsPrompt(sessionId: string): string {
  const bodies = sessionSkills.get(sessionId)
  if (!bodies || bodies.length === 0) return ''
  return '\n\n---\n\n## Loaded Skills\n\n' + bodies.join('\n\n---\n\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSkillTools(rootPath: string, sessionId: string, emit: EmitFn): Record<string, any> {
  const list_skills = tool({
    description: 'List all available skills in this project (.projectrose/skills/). Returns skill names and descriptions. Use load_skill to activate one.',
    inputSchema: z.object({}),
    execute: async (_input: Record<string, never>, options: ToolExecutionOptions) => {
      const id = options.toolCallId
      emit(IPC.AI_TOOL_CALL_START, { id, name: 'list_skills', params: {} })
      try {
        const skills = await listSkills(rootPath)
        const result = skills.length === 0
          ? 'No skills found in .projectrose/skills/'
          : skills.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ''}`).join('\n')
        emit(IPC.AI_TOOL_CALL_END, { id, result, error: false })
        return result
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        emit(IPC.AI_TOOL_CALL_END, { id, result: error, error: true })
        return error
      }
    }
  })

  const load_skill = tool({
    description: 'Load a skill by name into the current session. The skill content is appended to the system prompt for all subsequent steps in this session. Use list_skills first to discover available skill names.',
    inputSchema: z.object({
      skill_name: z.string().describe('The name of the skill to load (filename without .md extension)')
    }),
    execute: async (input: { skill_name: string }, options: ToolExecutionOptions) => {
      const id = options.toolCallId
      emit(IPC.AI_TOOL_CALL_START, { id, name: 'load_skill', params: input })
      try {
        const content = await loadSkillContent(rootPath, input.skill_name)
        if (!content) {
          const msg = `Skill "${input.skill_name}" not found. Use list_skills to see available skills.`
          emit(IPC.AI_TOOL_CALL_END, { id, result: msg, error: true })
          return msg
        }
        appendSkillToSession(sessionId, `### Skill: ${content.name}\n\n${content.body}`)
        const result = `Skill "${input.skill_name}" loaded into this session.`
        emit(IPC.AI_TOOL_CALL_END, { id, result, error: false })
        return result
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        emit(IPC.AI_TOOL_CALL_END, { id, result: error, error: true })
        return error
      }
    }
  })

  return { list_skills, load_skill }
}
