import { createOpenAICompatProvider } from './openai-compat'

export const deepseekProvider = createOpenAICompatProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  baseURL: 'https://api.deepseek.com',
  browserCors: false,
  keyPlaceholder: 'sk-...',
  keyHelpUrl: 'https://platform.deepseek.com/api_keys',
  models: [
    { value: 'deepseek-chat', label: 'DeepSeek V3.2 (Chat)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek V3.2 (Reasoner)' },
  ],
})
