// Settings block for the built-in Piper TTS capability. Lives at
// `AppSettings.tts` — read by the renderer's TtsAutoPlayer and by the
// Settings → General "Text-to-Speech" section. The actual voice files live
// under `~/.rose/cache/piper/voices/<id>/`.

export interface TtsSettings {
  // Master auto-play toggle. When true, every completed assistant message in
  // chat plays through Piper. Flipping this off cancels in-flight playback.
  enabled: boolean
  // Piper voice id, e.g. 'en_US-amy-medium'. Matches the directory name
  // under piper/voices/ and the basename of the .onnx file inside it.
  voice: string
  // Playback speed multiplier — 1.0 = normal, 0.5 = half speed, 2.0 = double.
  // Translated to Piper's --length-scale (inverse) inside the engine.
  speed: number
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled: false,
  voice: 'en_US-amy-medium',
  speed: 1.0
}
