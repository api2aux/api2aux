import type { LLMProvider } from './types'
import type { ProviderId } from '../types'
import { openrouterProvider } from './openrouter'
import { anthropicProvider } from './anthropic'
import { openaiProvider } from './openai'
import { groqProvider } from './groq'
import { deepseekProvider } from './deepseek'
import { xaiProvider } from './xai'
import { moonshotProvider } from './moonshot'

const providers: LLMProvider[] = [
  openrouterProvider,
  anthropicProvider,
  openaiProvider,
  xaiProvider,
  groqProvider,
  deepseekProvider,
  moonshotProvider,
]

const providerMap = new Map<string, LLMProvider>(
  providers.map((p) => [p.id, p]),
)

export function getProvider(id: ProviderId): LLMProvider | undefined {
  return providerMap.get(id)
}

export function getAllProviders(): LLMProvider[] {
  return providers
}
