import { createOpenAICompatProvider } from './openai-compat'

export const groqProvider = createOpenAICompatProvider({
  id: 'groq',
  name: 'Groq',
  baseURL: 'https://api.groq.com/openai/v1',
  browserCors: false,
  keyPlaceholder: 'gsk_...',
  keyHelpUrl: 'https://console.groq.com/keys',
  models: [
    { value: 'openai/gpt-oss-20b', label: 'GPT OSS 20B (fastest)' },
    { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B (reasoning)' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fast)' },
  ],
})
