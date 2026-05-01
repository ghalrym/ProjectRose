import type { TtsConfig } from '../../ipc/settingsHandlers'

export interface TtsAudioChunk {
  audio: ArrayBuffer
  format: 'pcm' | 'wav' | 'mp3'
  sampleRate: number
}

export interface VoiceList {
  voices: string[]
  uploadedVoices: string[]
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

// Node fetch wraps DNS/connection errors in TypeError with a `cause` chain.
// Surface the most informative bit so users see "ECONNREFUSED" instead of "fetch failed".
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const seen = new Set<unknown>()
  let cur: unknown = err
  let detail = ''
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    if (cur instanceof Error) {
      const code = (cur as { code?: string }).code
      const errno = (cur as { errno?: number }).errno
      const syscall = (cur as { syscall?: string }).syscall
      const hostname = (cur as { hostname?: string }).hostname
      const parts: string[] = []
      if (code) parts.push(code)
      if (syscall) parts.push(syscall)
      if (hostname) parts.push(hostname)
      if (errno !== undefined && !code) parts.push(`errno=${errno}`)
      if (cur.message && cur.message !== err.message) parts.push(cur.message)
      if (parts.length) detail = parts.join(' ')
      cur = (cur as { cause?: unknown }).cause
    } else {
      cur = undefined
    }
  }
  return detail ? `${err.message} (${detail})` : err.message
}

export async function listVoices(cfg: Pick<TtsConfig, 'baseUrl' | 'apiKey'>): Promise<VoiceList> {
  const url = joinUrl(cfg.baseUrl, '/v1/audio/voices')
  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders(cfg.apiKey) })
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${describeFetchError(err)}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200) || res.statusText}`)
  }
  const data = await res.json() as { voices?: string[]; uploaded_voices?: string[] }
  return {
    voices: Array.isArray(data.voices) ? data.voices : [],
    uploadedVoices: Array.isArray(data.uploaded_voices) ? data.uploaded_voices : []
  }
}


export async function* synthesize(
  text: string,
  cfg: TtsConfig,
  signal: AbortSignal
): AsyncIterable<TtsAudioChunk> {
  const url = joinUrl(cfg.baseUrl, '/v1/audio/speech')
  const body = JSON.stringify({
    model: cfg.model,
    input: text,
    voice: cfg.voice,
    response_format: cfg.format,
    stream: true
  })
  console.log('[tts:synthesize] POST', url, 'body:', body)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg.apiKey) },
      body,
      signal
    })
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${describeFetchError(err)}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    let parsedMessage = ''
    try {
      const j = JSON.parse(detail) as { error?: { message?: string } }
      parsedMessage = j.error?.message ?? ''
    } catch { /* not json */ }
    throw new Error(`HTTP ${res.status}: ${parsedMessage || detail.slice(0, 200) || res.statusText}`)
  }
  if (!res.body) throw new Error('Server returned empty body')

  const reader = res.body.getReader()
  const isPcm = cfg.format === 'pcm'

  if (isPcm) {
    // Stream chunks straight to the player.
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value && value.byteLength > 0) {
          yield {
            audio: toArrayBuffer(value),
            format: 'pcm',
            sampleRate: cfg.sampleRate
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  } else {
    // WAV/MP3 need a complete container before decodeAudioData can play them.
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value && value.byteLength > 0) {
          chunks.push(value)
          total += value.byteLength
        }
      }
    } finally {
      reader.releaseLock()
    }
    const combined = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { combined.set(c, offset); offset += c.byteLength }
    yield {
      audio: combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength) as ArrayBuffer,
      format: cfg.format,
      sampleRate: cfg.sampleRate
    }
  }
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}
