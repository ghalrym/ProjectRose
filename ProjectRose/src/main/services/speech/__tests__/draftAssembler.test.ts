import { describe, it, expect } from 'vitest'
import { DraftAssembler, type Clock, type DraftEvent, type DraftSettings } from '../draftAssembler'
import type { UtteranceEvent } from '../session'

/**
 * Fake clock that records scheduled callbacks. Tests drive time forward by
 * calling `advance(ms)` — neither setTimeout nor setInterval ever fire on
 * real wall time.
 */
function fakeClock(): Clock & { advance: (ms: number) => void; pending: () => number } {
  interface Scheduled {
    fn: () => void
    when: number
    interval: number | null
    handle: number
  }

  let now = 0
  let nextHandle = 1
  const scheduled = new Map<number, Scheduled>()

  function advance(ms: number): void {
    const target = now + ms
    while (true) {
      let next: Scheduled | undefined
      for (const s of scheduled.values()) {
        if (s.when <= target && (!next || s.when < next.when)) next = s
      }
      if (!next) break
      now = next.when
      next.fn()
      // setTimeout: remove; setInterval: reschedule.
      if (next.interval === null) {
        scheduled.delete(next.handle)
      } else {
        next.when = now + next.interval
      }
    }
    now = target
  }

  return {
    setTimeout: (fn, ms) => {
      const handle = nextHandle++
      scheduled.set(handle, { fn, when: now + ms, interval: null, handle })
      return handle
    },
    clearTimeout: (h) => { scheduled.delete(h as number) },
    setInterval: (fn, ms) => {
      const handle = nextHandle++
      scheduled.set(handle, { fn, when: now + ms, interval: ms, handle })
      return handle
    },
    clearInterval: (h) => { scheduled.delete(h as number) },
    advance,
    pending: () => scheduled.size
  }
}

function utt(text: string, opts: { speaker_id?: number | null } = {}): UtteranceEvent {
  return {
    sessionId: 1,
    utterance_id: Math.floor(Math.random() * 1_000_000),
    speaker_id: opts.speaker_id ?? null,
    speaker_name: null,
    text
  }
}

describe('DraftAssembler', () => {
  it('starts a draft on wake word and submits after the timer elapses', async () => {
    const clock = fakeClock()
    const settings: DraftSettings = {
      agentName: 'Rose',
      roseSpeechSpeakerId: null,
      activeListeningDraftSeconds: 3
    }
    const assembler = new DraftAssembler({ clock, settings: async () => settings })
    const events: DraftEvent[] = []
    assembler.onDraft((e) => events.push(e))

    await assembler.ingest(utt('Rose, hello'))
    await assembler.ingest(utt('world'))

    // Two utterances, two `building` emissions plus the initial timer-start
    // / tick emissions. Filter to status changes the test cares about.
    const statuses = events.map((e) => e.status)
    expect(statuses).toContain('building')
    expect(statuses).not.toContain('submitted')

    // Push past the timer and capture the submission.
    clock.advance(3000)

    const lastBuilding = [...events].reverse().find((e) => e.status === 'building')
    const submitted = events.find((e) => e.status === 'submitted')
    expect(lastBuilding?.text).toBe('Rose, hello world')
    expect(submitted).toBeDefined()
    expect(submitted!.text).toBe('Rose, hello world')
  })

  it('ignores utterances when no wake word and not drafting', async () => {
    const clock = fakeClock()
    const settings: DraftSettings = {
      agentName: 'Rose',
      roseSpeechSpeakerId: null,
      activeListeningDraftSeconds: 5
    }
    const assembler = new DraftAssembler({ clock, settings: async () => settings })
    const events: DraftEvent[] = []
    assembler.onDraft((e) => events.push(e))

    await assembler.ingest(utt('hello there'))
    await assembler.ingest(utt('how are you'))
    expect(events).toEqual([])
    expect(clock.pending()).toBe(0)
  })

  it('treats the enrolled speaker as the user and ignores other speakers', async () => {
    const clock = fakeClock()
    const settings: DraftSettings = {
      agentName: 'Rose',
      roseSpeechSpeakerId: 5,
      activeListeningDraftSeconds: 3
    }
    const assembler = new DraftAssembler({ clock, settings: async () => settings })
    const events: DraftEvent[] = []
    assembler.onDraft((e) => events.push(e))

    // Wake word from a known non-enrolled speaker — must NOT start a draft.
    await assembler.ingest(utt('Rose, hi', { speaker_id: 9 }))
    expect(events.filter((e) => e.status === 'building')).toEqual([])

    // Wake word from the enrolled speaker — starts the draft.
    await assembler.ingest(utt('Rose, hi', { speaker_id: 5 }))
    expect(events.filter((e) => e.status === 'building').length).toBeGreaterThan(0)
  })

  it('extends the timer on each follow-up utterance', async () => {
    const clock = fakeClock()
    const settings: DraftSettings = {
      agentName: 'Rose',
      roseSpeechSpeakerId: null,
      activeListeningDraftSeconds: 3
    }
    const assembler = new DraftAssembler({ clock, settings: async () => settings })
    const events: DraftEvent[] = []
    assembler.onDraft((e) => events.push(e))

    await assembler.ingest(utt('Rose go'))
    clock.advance(2000)            // 1s left
    await assembler.ingest(utt('do it'))  // resets timer to 3
    clock.advance(2000)            // 1s left again — not yet submitted
    expect(events.find((e) => e.status === 'submitted')).toBeUndefined()

    clock.advance(1500)            // now past the new deadline
    expect(events.find((e) => e.status === 'submitted')?.text).toBe('Rose go do it')
  })

  it('re-reads settings on each utterance so changes take effect mid-session', async () => {
    const clock = fakeClock()
    let agentName = 'Alpha'
    const assembler = new DraftAssembler({
      clock,
      settings: async () => ({
        agentName,
        roseSpeechSpeakerId: null,
        activeListeningDraftSeconds: 3
      })
    })
    const events: DraftEvent[] = []
    assembler.onDraft((e) => events.push(e))

    await assembler.ingest(utt('Alpha go'))
    expect(events.find((e) => e.status === 'building')).toBeDefined()

    // User renames the agent mid-session.
    agentName = 'Beta'
    clock.advance(3000)   // submit and clear
    expect(events.find((e) => e.status === 'submitted')).toBeDefined()

    const before = events.length
    await assembler.ingest(utt('Alpha go again'))  // old wake word — ignored
    expect(events.length).toBe(before)

    await assembler.ingest(utt('Beta go'))  // new wake word — starts draft
    expect(events.slice(before).find((e) => e.status === 'building')).toBeDefined()
  })

  it('dispose() clears pending timers', async () => {
    const clock = fakeClock()
    const settings: DraftSettings = {
      agentName: 'Rose',
      roseSpeechSpeakerId: null,
      activeListeningDraftSeconds: 5
    }
    const assembler = new DraftAssembler({ clock, settings: async () => settings })
    await assembler.ingest(utt('Rose hi'))
    expect(clock.pending()).toBeGreaterThan(0)
    assembler.dispose()
    expect(clock.pending()).toBe(0)
  })
})
