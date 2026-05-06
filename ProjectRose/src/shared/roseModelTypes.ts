export interface MessageAttachment {
  kind: 'screen' | 'webcam'
  mimeType: string
  dataUrl: string
}

export interface Message {
  role: string
  content: string
  attachments?: MessageAttachment[]
}