import { createOpenAICompatProvider } from './openai-compat'

export const openrouterProvider = createOpenAICompatProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  baseURL: 'https://openrouter.ai/api/v1',
  browserCors: true,
  keyPlaceholder: 'sk-or-...',
  keyHelpUrl: 'https://openrouter.ai/keys',
  defaultHeaders: {
    'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
    'X-Title': 'api2aux',
  },
  models: [
    { value: 'anthropic/claude-haiku-4-5', label: 'Claude 4.5 Haiku (fast)' },
    { value: 'anthropic/claude-sonnet-4-6', label: 'Claude 4.6 Sonnet' },
    { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
    { value: 'openai/gpt-5', label: 'GPT-5' },
    { value: 'openai/o4-mini', label: 'o4-mini (reasoning)' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'deepseek/deepseek-chat', label: 'DeepSeek V3.2' },
    { value: 'x-ai/grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast' },
  ],
})
