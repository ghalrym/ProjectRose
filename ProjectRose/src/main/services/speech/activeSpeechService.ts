import * as speechDB from './speechDB'
import { webmPathToWav, cleanupWav, saveRecording } from './audioService'
import { train, getEmbedder } from './speakerService'
import { openSpeechSession, closeSpeechSession } from './sessionLifecycle'
import { SpeechSessionRegistry } from './sessionRegistry'

// One registry per process. The manifest handlers are the only thing that
// holds SpeechSessions by id; sendChunk / cancelDraft fire-and-forget
// handlers in activeSpeechHandlers.ts reach this same registry via
// activeSpeechSessionRegistry().
const sessionRegistry = new SpeechSessionRegistry()

export function activeSpeechSessionRegistry(): SpeechSessionRegistry {
  return sessionRegistry
}

// Tracks the current phase of in-flight training jobs so the UI can show
// "Downloading model..." vs "Training..." without a DB schema change.
const jobPhases = new Map<number, string>()

export function getTrainingPhase(jobId: number): string | null {
  return jobPhases.get(jobId) ?? null
}

export async function getSpeakers(
  projectPath: string
): Promise<Array<{ id: number; name: string; created_at: string }>> {
  return speechDB.getSpeakers(projectPath) as Array<{ id: number; name: string; created_at: string }>
}

export async function createSpeaker(
  payload: { name: string; projectPath: string }
): Promise<{ id: number; name: string }> {
  return speechDB.createSpeaker(payload.projectPath, payload.name) as { id: number; name: string }
}

export interface AddSamplePayload {
  speakerId: number
  source: string
  audioBuffer: ArrayBuffer
  projectId?: string
  projectPath: string
}

export async function addSample(payload: AddSamplePayload): Promise<{ id: number }> {
  const { speakerId, source, audioBuffer, projectId, projectPath } = payload
  const audioPath = saveRecording(projectPath, speakerId, audioBuffer)
  return speechDB.addRecording(projectPath, speakerId, audioPath, source, projectId ?? null, null) as { id: number }
}

export interface LabelSpeakerPayload {
  utteranceId: number
  speakerId?: number
  speakerName?: string
  projectPath: string
}

export function labelSpeaker(payload: LabelSpeakerPayload): { ok: boolean; speaker_id: number } {
  return speechDB.labelSpeaker(
    payload.projectPath,
    payload.utteranceId,
    payload.speakerId ?? null,
    payload.speakerName ?? null
  ) as { ok: boolean; speaker_id: number }
}

export function startTrainingJob(projectPath: string): { job_id: number } {
  const { job_id } = speechDB.createTrainingJob(projectPath)
  speechDB.updateTrainingJob(projectPath, job_id, { status: 'running' })

  // Run training async so we can return the job_id immediately.
  setImmediate(async () => {
    try {
      const recordings = speechDB.getLabeledRecordings(projectPath)

      jobPhases.set(job_id, 'downloading-model')
      const embedder = await getEmbedder()
      if (!embedder) throw new Error('Speaker model unavailable — check internet connection and try again.')

      jobPhases.set(job_id, 'training')
      const { accuracy, deployed } = await train(projectPath, recordings, webmPathToWav, cleanupWav)

      jobPhases.delete(job_id)
      speechDB.updateTrainingJob(projectPath, job_id, {
        status: 'complete',
        accuracy,
        deployed
      })
      if (deployed) {
        speechDB.createModelVersion(projectPath, accuracy, recordings.length)
      }
    } catch (e) {
      jobPhases.delete(job_id)
      speechDB.updateTrainingJob(projectPath, job_id, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e)
      })
    }
  })

  return { job_id }
}

export interface TrainStatusResult {
  status: string
  accuracy: number | null
  deployed: boolean
  error: string | null
  phase: string | null
}

export function getTrainingStatus(payload: { jobId: number; projectPath: string }): TrainStatusResult {
  const job = speechDB.getTrainingJob(payload.projectPath, payload.jobId) as {
    status: string
    accuracy: number | null
    deployed: number
    error: string | null
  } | undefined
  if (!job) throw new Error(`Training job ${payload.jobId} not found`)
  return {
    status: job.status,
    accuracy: job.accuracy,
    deployed: !!job.deployed,
    error: job.error,
    phase: getTrainingPhase(payload.jobId)
  }
}

export function getTrainingHistory(
  projectPath: string
): Array<{ id: number; accuracy: number; is_active: boolean; trained_at: string; sample_count: number; notes: string | null }> {
  return speechDB.getTrainingJobs(projectPath) as Array<{
    id: number
    accuracy: number
    is_active: boolean
    trained_at: string
    sample_count: number
    notes: string | null
  }>
}

export function getUtterances(
  payload: { sessionId: number; projectPath: string }
): Array<{ id: number; text: string; speaker_name: string | null; speaker_id: number | null; created_at: string }> {
  return speechDB.getUtterances(payload.projectPath, payload.sessionId) as Array<{
    id: number
    text: string
    speaker_name: string | null
    speaker_id: number | null
    created_at: string
  }>
}

export function getSessions(
  projectPath: string
): Array<{ id: number; project_id: string | null; started_at: string; ended_at: string | null; utterance_count: number }> {
  return speechDB.getSessions(projectPath) as Array<{
    id: number
    project_id: string | null
    started_at: string
    ended_at: string | null
    utterance_count: number
  }>
}

export function openSession(payload: { projectPath: string; projectId?: string }): { sessionId: number } {
  return openSpeechSession(sessionRegistry, payload) as { sessionId: number }
}

export async function closeSession(payload: { sessionId: number; projectPath: string }): Promise<{ ok: boolean }> {
  return closeSpeechSession(sessionRegistry, payload)
}
