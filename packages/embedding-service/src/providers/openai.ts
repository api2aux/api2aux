/**
 * OpenAI embedding provider.
 *
 * Uses the OpenAI API to generate embeddings.
 * Reuses the user's chat API key.
 */

import type { EmbeddingProvider } from '../types'

const DEFAULT_MODEL = 'text-embedding-3-small'

const OPENAI_TIMEOUT_MS = 30_000
const MAX_RETRIES = 2

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai'
  readonly name = 'OpenAI API'
  readonly dimensions = 1536

  private apiKey: string
  private model: string

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey
    this.model = model ?? DEFAULT_MODEL
  }

  isReady(): boolean {
    return this.apiKey.length > 0
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    if (!this.apiKey) throw new Error('OpenAI API key not configured for embedding provider')

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.doEmbed(texts)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        // Only retry on transient failures (429 rate limit, 5xx server errors)
        if (lastError.message.includes('(429)') || lastError.message.includes('(5')) {
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
            continue
          }
        }
        break
      }
    }
    throw lastError!
  }

  private async doEmbed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`OpenAI embedding failed (${response.status}): ${errorText}`)
    }

    let data: { data?: Array<{ embedding: number[]; index: number }> }
    try {
      data = await response.json() as typeof data
    } catch (err) {
      throw new Error(`OpenAI embedding returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error(`OpenAI embedding returned unexpected response shape: missing data array`)
    }

    // Sort by index to ensure order matches input
    const sorted = data.data.sort((a, b) => a.index - b.index)
    return sorted.map(d => d.embedding)
  }
}
