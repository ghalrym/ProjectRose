import { create } from 'zustand'
import type { MessageAttachment } from '@shared/roseModelTypes'
import { useStatusStore } from '../stores/useStatusStore'

type ShareMode = 'off' | 'screen' | 'webcam'

interface ShareState {
  mode: ShareMode
  stream: MediaStream | null
  sourceLabel: string | null
  pickerOpen: boolean
  pickerResolve: ((sourceId: string | null) => void) | null

  openPicker: () => Promise<string | null>
  resolvePicker: (sourceId: string | null) => void
  startScreen: () => Promise<void>
  startWebcam: (deviceId?: string) => Promise<void>
  stop: () => void
  captureFrame: () => Promise<MessageAttachment | null>
}

const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.85

let offscreenVideo: HTMLVideoElement | null = null

function destroyOffscreenVideo(): void {
  if (!offscreenVideo) return
  offscreenVideo.pause()
  offscreenVideo.srcObject = null
  offscreenVideo.remove()
  offscreenVideo = null
}

function ensureOffscreenVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  if (offscreenVideo && offscreenVideo.srcObject === stream && offscreenVideo.readyState >= 2) {
    return Promise.resolve(offscreenVideo)
  }
  destroyOffscreenVideo()
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.autoplay = true
  v.style.position = 'fixed'
  v.style.top = '-9999px'
  v.style.left = '-9999px'
  v.style.width = '1px'
  v.style.height = '1px'
  v.style.opacity = '0'
  v.style.pointerEvents = 'none'
  v.srcObject = stream
  document.body.appendChild(v)
  offscreenVideo = v
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('error', onErr)
    }
    const onMeta = (): void => {
      cleanup()
      v.play().then(() => resolve(v)).catch(reject)
    }
    const onErr = (): void => {
      cleanup()
      reject(new Error('Failed to load capture stream'))
    }
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('error', onErr)
  })
}

function stopStreamTracks(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}

function watchStreamEnd(stream: MediaStream, onEnd: () => void): void {
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', onEnd, { once: true })
  }
}

export const useScreenWebcamShare = create<ShareState>()((set, get) => ({
  mode: 'off',
  stream: null,
  sourceLabel: null,
  pickerOpen: false,
  pickerResolve: null,

  openPicker: () => {
    return new Promise<string | null>((resolve) => {
      const prev = get().pickerResolve
      if (prev) prev(null)
      set({ pickerOpen: true, pickerResolve: resolve })
    })
  },

  resolvePicker: (sourceId) => {
    const r = get().pickerResolve
    set({ pickerOpen: false, pickerResolve: null })
    r?.(sourceId)
  },

  startScreen: async () => {
    get().stop()
    const sourceId = await get().openPicker()
    if (!sourceId) return
    try {
      await window.api.screen.setActiveSource(sourceId)
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = stream.getVideoTracks()[0]
      const label = track?.label || 'Shared screen'
      watchStreamEnd(stream, () => {
        if (get().stream === stream) get().stop()
      })
      await ensureOffscreenVideo(stream)
      set({ mode: 'screen', stream, sourceLabel: label })
    } catch (err) {
      await window.api.screen.setActiveSource(null)
      const msg = err instanceof Error ? err.message : 'Screen share failed'
      useStatusStore.getState().notify(`Screen share unavailable: ${msg}`, { tone: 'error' })
    }
  },

  startWebcam: async (deviceId) => {
    get().stop()
    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : true
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const track = stream.getVideoTracks()[0]
      const label = track?.label || 'Camera'
      watchStreamEnd(stream, () => {
        if (get().stream === stream) get().stop()
      })
      await ensureOffscreenVideo(stream)
      set({ mode: 'webcam', stream, sourceLabel: label })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera unavailable'
      useStatusStore.getState().notify(`Camera unavailable: ${msg}`, { tone: 'error' })
    }
  },

  stop: () => {
    const { stream, mode } = get()
    if (mode === 'off' && !stream) return
    stopStreamTracks(stream)
    destroyOffscreenVideo()
    void window.api.screen.setActiveSource(null)
    set({ mode: 'off', stream: null, sourceLabel: null })
  },

  captureFrame: async () => {
    const { mode, stream } = get()
    if (mode === 'off' || !stream) return null
    let video: HTMLVideoElement
    try {
      video = await ensureOffscreenVideo(stream)
    } catch {
      return null
    }
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null

    const scale = Math.min(1, MAX_EDGE_PX / Math.max(w, h))
    const outW = Math.max(1, Math.round(w * scale))
    const outH = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, outW, outH)
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    return { kind: mode, mimeType: 'image/jpeg', dataUrl }
  }
}))

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    useScreenWebcamShare.getState().stop()
  })
}
