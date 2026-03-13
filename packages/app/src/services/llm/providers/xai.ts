import { createOpenAICompatProvider } from './openai-compat'

export const xaiProvider = createOpenAICompatProvider({
  id: 'xai',
  name: 'xAI',
  baseURL: 'https://api.x.ai/v1',
  browserCors: true,
  keyPlaceholder: 'xai-...',
  keyHelpUrl: 'https://console.x.ai',
  models: [
    { value: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast' },
    { value: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast (reasoning)' },
    { value: 'grok-4-0709', label: 'Grok 4' },
    { value: 'grok-3-mini', label: 'Grok 3 Mini' },
    { value: 'grok-3', label: 'Grok 3' },
  ],
})
