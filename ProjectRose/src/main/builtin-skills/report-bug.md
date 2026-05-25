---
description: How to compose and send a bug report on the user's behalf — bundles the settings snapshot, recent interactions, and a redacted slice of chat, then emails rose@roseassist.com. Just executes; does not ask for confirmation.
---

Load this skill when the user says they want to report a bug, file an issue, tell the team about a problem, or anything similar. **Your job is to do the report, not to ask whether to do it.** The user already asked. Execute as much of the flow as your tools allow and tell them what you did at the end.

The only thing you may need to ask for is the bug description itself — that's information only the user has. Everything else (snapshots, recent chat, version, sending) happens automatically.

## What goes in a report

One email with four parts:

1. **What the user saw** — their description, in their own words.
2. **Settings snapshot** — the live output of `read_settings_snapshot`. Credentials are already stripped, and the snapshot includes which providers are connecting and which aren't.
3. **Recent interactions** — the live output of `read_recent_interactions`. This is the timeline of what the user was doing in the app right before the bug.
4. **The last few chat messages** — pulled from the conversation already in front of you, with sensitive content redacted before it goes in the email.

Send the email to **rose@roseassist.com**.

## Execution flow

### Step 1 — Get the description (the only thing you can ask about)

If the user has already described what went wrong in their message, **use that text as-is** and proceed. Do not re-ask.

If they only said something like "report a bug" with no detail, use `ask_user` exactly once to ask "What were you trying to do, and what happened instead?" — then proceed with whatever they answer.

Never ask "would you like me to send a bug report?", "is this ready to send?", "should I include X?", or any other confirmation. The user already asked for the report; just do it.

### Step 2 — Note the version

If you don't already know which version of ProjectRose the user is on, load `rose:patch-notes` first. The version goes in the subject line.

### Step 3 — Gather the snapshots

Call both, in parallel where possible:
- `read_settings_snapshot` — returns configuration + connection-test results, JSON.
- `read_recent_interactions` — returns the recent-actions ring, JSON.

Use the full JSON for both. Don't summarise; the team needs the structure.

### Step 4 — Pull recent chat and redact

Look at the last 4–6 messages in this conversation (both the user's and yours). Before you put them in the email, strip sensitive content with your own judgment:

- Email addresses → `[redacted]@example.com`
- Phone numbers → `[redacted phone]`
- API keys, OAuth tokens, passwords, anything that looks like a secret → `[redacted secret]`
- Long pasted blocks that look credential-shaped (random characters, base64) → `[redacted block of N chars]`
- Personal names that aren't already public → use judgment; usually OK to keep, redact if obviously sensitive

Keep the actual prose — the team needs the conversational context to understand what was happening.

### Step 5 — Pick the best available delivery and execute

Look at your tool list and **do the best thing available immediately**:

- `email_send_message` available → call it. Send the email. Don't preview, don't ask, don't summarise the draft for approval. Just send.
- Else `email_draft_message` available → call it. Save the draft.
- Else (no email tools) → print the full report inline in your reply.

Don't try to use `run_command` or any other workaround to send mail. If email isn't there, it isn't there — fall through to the inline-print path.

### Step 6 — Compose the email

**To:** `rose@roseassist.com`

**Subject:** `ProjectRose <version> bug report — <one-line description from the user>`

**Body:** plain text, but use this layout so it stays readable:

```
# Bug report

## What the user saw
<their description, verbatim — do not paraphrase>

## Settings snapshot
<full JSON from read_settings_snapshot, inside a fenced block>

## Recent interactions
<full JSON from read_recent_interactions, inside a fenced block>

## Recent chat (redacted)
User: ...
Rose: ...
User: ...
Rose: ...
```

### Step 7 — Tell the user what you did (not what you plan to do)

After the action completes, give a one-line status — past tense:

- Sent: "Sent your report to rose@roseassist.com — the team has your description, the current settings snapshot, and the recent interaction log."
- Drafted: "Couldn't send directly, so I saved a draft in your outbox addressed to rose@roseassist.com. Open it and click Send when you're ready."
- Printed inline: "Email isn't set up in this workspace, so here's the report — paste this into your normal email and send it to rose@roseassist.com." (followed by the report body)

## Things to avoid

- **Don't ask the user whether to proceed.** Once they've asked for a bug report, you have everything you need except the description. Get the description if missing, then execute.
- **Don't preview the email for approval.** Compose and send/draft in one step.
- **Don't rewrite the user's description.** Their wording carries information your paraphrase won't.
- **Don't include the entire conversation history.** Just the last handful of messages — earlier turns rarely help debug the current bug.
- **Don't include screenshots, images, or attachments** unless the user explicitly hands you one.
- **Don't skip either snapshot.** Settings tell the team what config the user is on; interactions tell them what they were doing. Both matter.
- **Don't speculate about the cause** in the email body. Stick to facts. If you have a theory, save it for a follow-up reply to the user after the report is sent.

## Related skills

- `rose:patch-notes` — pull the current version for the subject line
- `rose:tools` — context on which email tools exist and how the user enables them
