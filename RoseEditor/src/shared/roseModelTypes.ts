export interface Message {
  role: string
  content: string
}

export interface ToolParameter {
  type: string
  description?: string
}

export interface Tool {
  name: string
  description?: string
  parameters?: Record<string, ToolParameter>
  callback_url: string
}

export interface GenerateRequest {
  messages: Message[]
  agent_md?: string | null
  tools?: Tool[]
}

export interface CompressRequest {
  messages: Message[]
}

export interface CompressResponse {
  messages: Message[]
}
