import { defineIpc, method } from '../../../shared/ipc/defineIpc'
import type {
  AddSamplePayload,
  LabelSpeakerPayload,
  TrainStatusResult
} from './activeSpeechService'

// Request channels only. SEND_CHUNK and CANCEL_DRAFT remain hand-written
// ipcMain.on registrations (fire-and-forget). UTTERANCE and DRAFT are
// event broadcasts emitted via webContents.send.
export const activeSpeechIpc = defineIpc('activeSpeech', {
  getSpeakers: method<[projectPath: string], Array<{ id: number; name: string; created_at: string }>>(),
  createSpeaker: method<[payload: { name: string; projectPath: string }], { id: number; name: string }>(),
  addSample: method<[payload: AddSamplePayload], { id: number }>(),
  labelSpeaker: method<[payload: LabelSpeakerPayload], { ok: boolean; speaker_id: number }>(),
  train: method<[projectPath: string], { job_id: number }>(),
  trainStatus: method<[payload: { jobId: number; projectPath: string }], TrainStatusResult>(),
  trainHistory: method<
    [projectPath: string],
    Array<{ id: number; accuracy: number; is_active: boolean; trained_at: string; sample_count: number; notes: string | null }>
  >(),
  getUtterances: method<
    [payload: { sessionId: number; projectPath: string }],
    Array<{ id: number; text: string; speaker_name: string | null; speaker_id: number | null; created_at: string }>
  >(),
  getSessions: method<
    [projectPath: string],
    Array<{ id: number; project_id: string | null; started_at: string; ended_at: string | null; utterance_count: number }>
  >(),
  openSession: method<[payload: { projectPath: string; projectId?: string }], { sessionId: number }>(),
  closeSession: method<[payload: { sessionId: number; projectPath: string }], { ok: boolean }>(),
  prepareSession: method<[payload: { projectPath: string }], { ok: boolean; error?: string }>()
})
