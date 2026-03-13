import { createOpenAICompatProvider } from './openai-compat'

export const openaiProvider = createOpenAICompatProvider({
  id: 'openai',
  name: 'OpenAI',
  baseURL: 'https://api.openai.com/v1',
  browserCors: true,
  keyPlaceholder: 'sk-...',
  keyHelpUrl: 'https://platform.openai.com/api-keys',
  models: [
    { value: 'gpt-5-nano', label: 'GPT-5 Nano (fastest)' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini (fast)' },
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.4', label: 'GPT-5.4 (flagship)' },
    { value: 'o4-mini', label: 'o4-mini (reasoning, fast)' },
    { value: 'o3', label: 'o3 (reasoning)' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
  ],
})
