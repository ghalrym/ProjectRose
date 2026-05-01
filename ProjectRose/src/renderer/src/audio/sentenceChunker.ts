export interface SentenceChunker {
  push(text: string): string[]
  flush(): string | null
  reset(): void
}

const BOUNDARY_RE = /[^.!?\n]*[.!?\n]+/g
const MIN_CHUNK_CHARS = 4

export function makeSentenceChunker(): SentenceChunker {
  let buffer = ''

  return {
    push(text: string): string[] {
      buffer += text
      const sentences: string[] = []
      let lastEnd = 0
      BOUNDARY_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = BOUNDARY_RE.exec(buffer))) {
        const piece = m[0].trim()
        if (piece.length >= MIN_CHUNK_CHARS) sentences.push(piece)
        lastEnd = m.index + m[0].length
      }
      buffer = buffer.slice(lastEnd)
      return sentences
    },

    flush(): string | null {
      const r = buffer.trim()
      buffer = ''
      return r.length >= MIN_CHUNK_CHARS ? r : null
    },

    reset(): void {
      buffer = ''
    }
  }
}
