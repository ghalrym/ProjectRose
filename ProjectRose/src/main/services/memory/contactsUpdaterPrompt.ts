import type { ConversationLogEntry } from '../../../shared/memory'

// The contacts updater is a host-internal Detached Run. The agent receives a
// recent slice of user↔agent dialog and is asked to keep the contact memory
// in sync with what was said. It does the actual writes by calling the
// existing memory_* tools — this prompt just hands it the source material.

export const CONTACTS_UPDATER_SYSTEM_PROMPT = `You are the Agent of ProjectRose performing a routine contacts-memory sweep.

You will be shown a slice of recent user↔agent conversations. Your job: extract every person, business, website, or other entity mentioned in those messages and reconcile them with your contact memory.

Each contact carries a \`kind\` classification (one of: person, business, website, other). This drives whether the contact is eligible to sync with the user's Google Contacts, so set it accurately on creation.

Process to follow:

1. Read through the conversation slice. Note every distinct entity referenced — people, companies, products, websites, projects, places, etc.
2. For each one, call \`memory_search_contacts\` with the name to see if a contact already exists.
3. If no contact exists, call \`memory_new_contact\` with both \`entity\` and the appropriate \`kind\`:
   - **person**: an individual (named human you or the user know).
   - **business**: a company, team, brand, or organisation.
   - **website**: a URL or domain treated as a contact (a wiki, a service, a documentation site).
   - **other**: places, products, projects, or anything that doesn't fit the first three.
   Then call \`memory_add_contact_note\` with one or two short factual notes the conversation provided (role, relationship, what they do, where they live, when first mentioned).
4. If a contact exists but you now know its kind was wrong, call \`memory_set_contact_kind\` to correct it.
5. If a contact exists and you have new factual notes, call \`memory_add_contact_note\`. Do not duplicate notes that are already there.
6. Do NOT remove or alter existing notes unless the user explicitly retracted them in the conversation.
7. Be conservative — if a mention is too generic to be useful ("a person at the meeting", "some library") or it's clearly the user themselves, skip it.

Output a brief one-line summary of what you did at the end (e.g. "Created 2 new contacts (1 person, 1 business); added 4 notes to 3 existing contacts.").`

interface BuildPromptArgs {
  windowDescription: string
  conversations: ConversationLogEntry[]
}

function formatConversations(entries: ConversationLogEntry[]): string {
  if (entries.length === 0) return '_No new messages in this window._'
  const grouped = new Map<string, ConversationLogEntry[]>()
  for (const e of entries) {
    const list = grouped.get(e.sessionId) ?? []
    list.push(e)
    grouped.set(e.sessionId, list)
  }
  const sections: string[] = []
  let n = 1
  for (const [sessionId, msgs] of grouped) {
    const lines: string[] = [`### Conversation ${n} (session ${sessionId.slice(0, 8)})`]
    for (const m of msgs.sort((a, b) => a.timestamp - b.timestamp)) {
      const ts = new Date(m.timestamp).toLocaleTimeString()
      lines.push(`- [${ts}] **${m.role}**: ${m.content}`)
    }
    sections.push(lines.join('\n'))
    n += 1
  }
  return sections.join('\n\n')
}

export function buildContactsUpdaterUserPrompt(args: BuildPromptArgs): string {
  return [
    `Below is the recent user↔agent conversation slice (${args.windowDescription}). Sweep it for contacts to create or update.`,
    '',
    formatConversations(args.conversations),
    '',
    'Use memory_search_contacts → memory_new_contact / memory_add_contact_note as described in your system prompt. Output only the one-line summary when you finish.'
  ].join('\n')
}
