import { createOpenAICompatProvider } from './openai-compat'

export const moonshotProvider = createOpenAICompatProvider({
  id: 'moonshot',
  name: 'Moonshot (Kimi)',
  baseURL: 'https://api.moonshot.cn/v1',
  browserCors: false,
  keyPlaceholder: 'sk-...',
  keyHelpUrl: 'https://platform.moonshot.cn/console/api-keys',
  models: [
    { value: 'kimi-k2.5', label: 'Kimi K2.5 (flagship)' },
    { value: 'kimi-k2-thinking-turbo', label: 'Kimi K2 Thinking Turbo' },
    { value: 'kimi-k2-thinking', label: 'Kimi K2 Thinking (reasoning)' },
    { value: 'moonshot-v1-128k', label: 'Moonshot V1 128K (legacy)' },
  ],
})
