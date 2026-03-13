import type { ChatMessage, Tool, StreamResult, ProviderId } from '../types'

export interface ProviderModel {
  value: string
  label: string
}

export interface LLMProvider {
  id: ProviderId
  name: string
  /** Whether this provider works from the browser without a CORS proxy */
  browserCors: boolean
  /** Available models */
  models: ProviderModel[]
  /** Placeholder text for the API key input */
  keyPlaceholder: string
  /** URL where users can get an API key */
  keyHelpUrl?: string
  /** Send a streaming chat completion, calling onToken for each text chunk */
  streamCompletion(
    messages: ChatMessage[],
    tools: Tool[],
    config: { apiKey: string; model: string },
    onToken: (token: string) => void,
  ): Promise<StreamResult>
}
