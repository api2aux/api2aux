import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UIMessage, ChatConfig, CallLogEntry } from '../services/llm/types'
import { getProvider } from '../services/llm/providers/registry'

interface ChatState {
  /** Whether the chat panel is open */
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void

  /** Chat messages for current session */
  messages: UIMessage[]
  addMessage: (message: UIMessage) => void
  updateMessage: (id: string, updates: Partial<UIMessage>) => void
  clearMessages: () => void

  /** The API URL this chat session belongs to (base URL without query params) */
  chatApiUrl: string
  setChatApiUrl: (url: string) => void

  /** LLM configuration (persisted) */
  config: ChatConfig
  setConfig: (config: Partial<ChatConfig>) => void

  /** Chat panel width as percentage (persisted) */
  panelSize: number
  setPanelSize: (size: number) => void

  /** Whether a request is in flight */
  sending: boolean
  setSending: (sending: boolean) => void

  /** API response cache (session-only, not persisted) */
  apiCacheEnabled: boolean
  apiCache: Map<string, unknown>
  setApiCacheEnabled: (enabled: boolean) => void
  clearApiCache: () => void

  /** Embedding provider for semantic context reduction (persisted) */
  embeddingProvider: 'local' | 'openai'
  setEmbeddingProvider: (provider: 'local' | 'openai') => void

  /** Focus reduction strategy (persisted) */
  focusReduction: 'truncate-values' | 'embed-fields' | 'llm-fields'
  setFocusReduction: (strategy: 'truncate-values' | 'embed-fields' | 'llm-fields') => void

  /** Debug call log (session-only, not persisted) */
  callLog: CallLogEntry[]
  addCallLogEntry: (entry: CallLogEntry) => void
  clearCallLog: () => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      open: false,
      messages: [],
      chatApiUrl: '',
      config: {
        apiKey: '',
        model: getProvider('openrouter')?.models[0]?.value ?? 'anthropic/claude-haiku',
        provider: 'openrouter',
      },
      panelSize: 30,
      sending: false,
      apiCacheEnabled: true,
      apiCache: new Map(),
      embeddingProvider: 'local' as const,
      focusReduction: 'truncate-values' as const,
      callLog: [],

      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),

      addMessage: (message) => set((s) => ({
        messages: [...s.messages, message],
      })),
      updateMessage: (id, updates) => set((s) => ({
        messages: s.messages.map((m) =>
          m.id === id ? { ...m, ...updates } : m
        ),
      })),
      clearMessages: () => set({ messages: [], chatApiUrl: '' }),
      setChatApiUrl: (chatApiUrl) => set({ chatApiUrl }),

      setConfig: (partial) => set((s) => ({
        config: { ...s.config, ...partial },
      })),
      setPanelSize: (panelSize) => set({ panelSize }),
      setSending: (sending) => set({ sending }),
      setApiCacheEnabled: (apiCacheEnabled) => set({ apiCacheEnabled }),
      clearApiCache: () => set({ apiCache: new Map() }),
      setEmbeddingProvider: (embeddingProvider) => set({ embeddingProvider }),
      setFocusReduction: (focusReduction) => set({ focusReduction }),
      addCallLogEntry: (entry) => set((s) => ({ callLog: [...s.callLog, entry] })),
      clearCallLog: () => set({ callLog: [] }),
    }),
    {
      name: 'api2aux-chat',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        config: state.config,
        panelSize: state.panelSize,
        apiCacheEnabled: state.apiCacheEnabled,
        embeddingProvider: state.embeddingProvider,
        focusReduction: state.focusReduction,
      }),
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>
        // v2→v3: reset panelSize (was saved as pixels, now percentage)
        if (version < 3) {
          state.panelSize = 30
        }
        return state
      },
    }
  )
)
