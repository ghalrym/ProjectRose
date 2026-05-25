import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { piperRootDir } from './paths'

// The Rhasspy/piper-voices repo on Hugging Face publishes a canonical
// `voices.json` index that lists every voice with language metadata, file
// paths, sizes, and digests. We mirror it locally rather than hard-coding,
// so users get every voice (~100 across many languages) and updates land
// without an app release.

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'
const VOICES_JSON_URL = `${HF_BASE}/voices.json`

type Quality = 'x_low' | 'low' | 'medium' | 'high'

interface PiperVoicesJsonEntry {
  key: string
  name: string
  language: {
    code: string
    family: string
    region: string
    name_native: string
    name_english: string
    country_english: string
  }
  quality: Quality
  num_speakers: number
  speaker_id_map: Record<string, number>
  files: Record<string, { size_bytes: number; md5_digest?: string }>
  aliases?: string[]
}

type PiperVoicesJson = Record<string, PiperVoicesJsonEntry>

export interface VoiceCatalogEntry {
  id: string
  speakerName: string         // 'Amy', 'L2arctic ABA', 'Libritts p225', …
  displayName: string         // 'Amy · English (United States)'
  languageCode: string        // 'en_US'
  languageFamily: string      // 'en' — for the language-family filter
  languageEnglish: string     // 'English'
  languageNative: string      // 'English' — sometimes non-Latin
  country: string             // 'United States'
  quality: Quality
  approxSizeMB: number
  modelUrl: string
  configUrl: string
  // Multi-speaker fields. For single-speaker voices these are null. For each
  // speaker in a multi-speaker model we emit a child entry whose id is
  // `${parentId}#${speakerKey}` and whose speakerIndex is the integer Piper
  // expects at `--speaker <n>`. The parent entry itself is also emitted with
  // speakerIndex = null so persisted "tts.voice" values from before this
  // change still resolve.
  parentId: string | null
  speakerKey: string | null
  speakerIndex: number | null
  totalSpeakers: number       // 1 for single-speaker voices
}

export const DEFAULT_VOICE_ID = 'en_US-amy-medium'

// Offline-safe fallback. Used only when voices.json can't be fetched AND no
// cached copy exists on disk — i.e. the very first launch with no network.
// Keeps the toggle-on flow functional with the default English voice.
const FALLBACK_CATALOG: VoiceCatalogEntry[] = [
  {
    id: 'en_US-amy-medium',
    speakerName: 'Amy',
    displayName: 'Amy · English (United States)',
    languageCode: 'en_US',
    languageFamily: 'en',
    languageEnglish: 'English',
    languageNative: 'English',
    country: 'United States',
    quality: 'medium',
    approxSizeMB: 63,
    modelUrl: `${HF_BASE}/en/en_US/amy/medium/en_US-amy-medium.onnx`,
    configUrl: `${HF_BASE}/en/en_US/amy/medium/en_US-amy-medium.onnx.json`,
    parentId: null,
    speakerKey: null,
    speakerIndex: null,
    totalSpeakers: 1
  }
]

let cachedCatalog: VoiceCatalogEntry[] | null = null
let cachedFetchedAt = 0
let inflightFetch: Promise<PiperVoicesJson | null> | null = null

function localVoicesJsonPath(): string {
  return join(piperRootDir(), 'voices.json')
}

function qualityRank(q: Quality): number {
  return { x_low: 0, low: 1, medium: 2, high: 3 }[q]
}

function prettySpeaker(raw: string): string {
  // Names come in as snake-case lowercase ("jenny_dioco", "l2arctic").
  // Title-case each underscore-separated chunk so they render naturally.
  return raw
    .split('_')
    .map((chunk) => (chunk ? chunk[0].toUpperCase() + chunk.slice(1) : ''))
    .join(' ')
    .trim()
}

function transformVoicesJson(json: PiperVoicesJson): VoiceCatalogEntry[] {
  const out: VoiceCatalogEntry[] = []
  for (const [key, entry] of Object.entries(json)) {
    let modelPath: string | null = null
    let modelSize = 0
    let configPath: string | null = null
    for (const [filePath, meta] of Object.entries(entry.files)) {
      if (filePath.endsWith('.onnx.json')) configPath = filePath
      else if (filePath.endsWith('.onnx')) { modelPath = filePath; modelSize = meta.size_bytes }
    }
    if (!modelPath || !configPath) continue

    const voiceName = prettySpeaker(entry.name)
    const langSuffix = `${entry.language.name_english} (${entry.language.country_english})`
    const sizeMB = Math.max(1, Math.round(modelSize / 1_000_000))
    const modelUrl = `${HF_BASE}/${modelPath}`
    const configUrl = `${HF_BASE}/${configPath}`

    // Collect speakers from either the explicit map or the num_speakers count
    // — some multi-speaker voices ship without an explicit map, in which case
    // we synthesize speaker_0, speaker_1, … keys so they remain selectable.
    const speakerEntries: Array<[string, number]> = Object.entries(entry.speaker_id_map ?? {})
    if (speakerEntries.length === 0 && entry.num_speakers > 1) {
      for (let i = 0; i < entry.num_speakers; i++) speakerEntries.push([`speaker_${i}`, i])
    }
    speakerEntries.sort((a, b) => a[1] - b[1])

    const totalSpeakers = Math.max(1, speakerEntries.length || 1)

    // Always emit the parent entry. For single-speaker voices this is the
    // only entry. For multi-speakers it defaults to Piper's speaker 0 — and
    // keeps any persisted `tts.voice = "<modelId>"` value resolvable.
    out.push({
      id: key,
      speakerName: voiceName,
      displayName: `${voiceName} · ${langSuffix}${totalSpeakers > 1 ? ` · ${totalSpeakers} speakers` : ''}`,
      languageCode: entry.language.code,
      languageFamily: entry.language.family,
      languageEnglish: entry.language.name_english,
      languageNative: entry.language.name_native,
      country: entry.language.country_english,
      quality: entry.quality,
      approxSizeMB: sizeMB,
      modelUrl,
      configUrl,
      parentId: null,
      speakerKey: null,
      speakerIndex: null,
      totalSpeakers
    })

    if (totalSpeakers <= 1) continue

    // Fan out one entry per speaker. They all share the same model files, so
    // downloading any one of them (or the parent) unlocks every sibling.
    for (const [speakerKey, speakerIndex] of speakerEntries) {
      const combinedSpeakerName = `${voiceName} ${speakerKey}`
      out.push({
        id: `${key}#${speakerKey}`,
        speakerName: combinedSpeakerName,
        displayName: `${combinedSpeakerName} · ${langSuffix}`,
        languageCode: entry.language.code,
        languageFamily: entry.language.family,
        languageEnglish: entry.language.name_english,
        languageNative: entry.language.name_native,
        country: entry.language.country_english,
        quality: entry.quality,
        approxSizeMB: sizeMB,
        modelUrl,
        configUrl,
        parentId: key,
        speakerKey,
        speakerIndex,
        totalSpeakers
      })
    }
  }
  // Sort: language family → code → voice (parent before its speakers) →
  // speaker index → quality (high first). The `parentId == null` check keeps
  // each parent grouped above its expanded children.
  out.sort((a, b) => {
    if (a.languageFamily !== b.languageFamily) return a.languageFamily.localeCompare(b.languageFamily)
    if (a.languageCode !== b.languageCode) return a.languageCode.localeCompare(b.languageCode)
    const aModel = a.parentId ?? a.id
    const bModel = b.parentId ?? b.id
    if (aModel !== bModel) return aModel.localeCompare(bModel)
    if (a.parentId === null && b.parentId !== null) return -1
    if (b.parentId === null && a.parentId !== null) return 1
    if (a.speakerIndex !== b.speakerIndex) {
      return (a.speakerIndex ?? 0) - (b.speakerIndex ?? 0)
    }
    return qualityRank(b.quality) - qualityRank(a.quality)
  })
  return out
}

async function fetchVoicesJson(): Promise<PiperVoicesJson> {
  const res = await fetch(VOICES_JSON_URL)
  if (!res.ok) throw new Error(`voices.json fetch failed (${res.status})`)
  return await res.json() as PiperVoicesJson
}

async function readCachedVoicesJson(): Promise<PiperVoicesJson | null> {
  try {
    const buf = await readFile(localVoicesJsonPath(), 'utf-8')
    return JSON.parse(buf) as PiperVoicesJson
  } catch {
    return null
  }
}

async function writeCachedVoicesJson(json: PiperVoicesJson): Promise<void> {
  try {
    await mkdir(piperRootDir(), { recursive: true })
    await writeFile(localVoicesJsonPath(), JSON.stringify(json), 'utf-8')
  } catch { /* cache write is best-effort */ }
}

// Cached on-disk copy is preferred for warm starts; we only hit the network
// when forced or when the cache is missing. Concurrent callers share a single
// in-flight fetch so we don't pull the JSON twice at startup.
async function loadVoicesJson(forceRefresh: boolean): Promise<PiperVoicesJson | null> {
  if (!forceRefresh) {
    const cached = await readCachedVoicesJson()
    if (cached) return cached
  }
  if (inflightFetch) return inflightFetch
  inflightFetch = (async () => {
    try {
      const fresh = await fetchVoicesJson()
      await writeCachedVoicesJson(fresh)
      return fresh
    } catch {
      // Network failed — fall back to cache one more time in case it was
      // written between checks (or by an earlier session).
      return await readCachedVoicesJson()
    } finally {
      inflightFetch = null
    }
  })()
  return inflightFetch
}

export async function getCatalog(forceRefresh = false): Promise<VoiceCatalogEntry[]> {
  if (!forceRefresh && cachedCatalog) return cachedCatalog
  const json = await loadVoicesJson(forceRefresh)
  if (!json) {
    cachedCatalog = FALLBACK_CATALOG
    return cachedCatalog
  }
  cachedCatalog = transformVoicesJson(json)
  cachedFetchedAt = Date.now()
  return cachedCatalog
}

export async function refreshCatalog(): Promise<VoiceCatalogEntry[]> {
  cachedCatalog = null
  return await getCatalog(true)
}

export async function findVoice(id: string): Promise<VoiceCatalogEntry | undefined> {
  const catalog = await getCatalog()
  return catalog.find((v) => v.id === id)
}

export function catalogFetchedAt(): number {
  return cachedFetchedAt
}
