/**
 * OpenAI embedding provider.
 *
 * Uses the OpenAI API to generate embeddings.
 * Reuses the user's chat API key.
 */

import type { EmbeddingProvider } from '../types'

const DEFAULT_MODEL = 'text-embedding-3-small'

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai'
  readonly name = 'OpenAI API'

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
    if (!this.apiKey) throw new Error('OpenAI API key not configured')

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
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`OpenAI embedding failed (${response.status}): ${errorText}`)
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>
    }

    // Sort by index to ensure order matches input
    const sorted = data.data.sort((a, b) => a.index - b.index)
    return sorted.map(d => d.embedding)
  }
}
