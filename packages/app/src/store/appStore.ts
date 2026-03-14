import { create } from 'zustand'
import type { UnifiedSchema, SemanticMetadata } from '../types/schema'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import type { ImportanceScore, GroupingResult } from '../services/analysis/types'
import type { ComponentSelection } from '../services/selection/types'
import type { DeployResult } from '../services/mcp/deploy'
import type { SSEEvent } from 'api-invoke'

const MAX_STREAM_EVENTS = 1000

interface AnalysisCacheEntry {
  semantics: Map<string, SemanticMetadata>
  importance: Map<string, ImportanceScore>
  selection: ComponentSelection | null
  grouping: GroupingResult | null
}

export const UrlMode = {
  AUTO: 'auto',
  SPEC: 'spec',
  GRAPHQL: 'graphql',
  ENDPOINT: 'endpoint',
} as const
export type UrlMode = (typeof UrlMode)[keyof typeof UrlMode]

interface AppState {
  // Input
  url: string
  setUrl: (url: string) => void

  // URL mode & options panel
  urlMode: UrlMode
  setUrlMode: (mode: UrlMode) => void
  optionsOpen: boolean
  setOptionsOpen: (open: boolean) => void

  // Pipeline state
  loading: boolean
  error: Error | null
  data: unknown
  schema: UnifiedSchema | null

  // OpenAPI state
  parsedSpec: ParsedAPI | null
  selectedOperationIndex: number
  parameterValues: Record<string, string>

  // Direct URL method + body (for non-OpenAPI requests)
  httpMethod: string
  requestBody: string
  setHttpMethod: (method: string) => void
  setRequestBody: (body: string) => void

  // Analysis cache (run once per API response)
  analysisCache: Map<string, AnalysisCacheEntry>
  setAnalysisCache: (path: string, data: AnalysisCacheEntry) => void
  getAnalysisCache: (path: string) => AnalysisCacheEntry | null
  clearAnalysisCache: () => void

  // Tab selection memory (session-only, keyed by path)
  tabSelections: Map<string, number>
  setTabSelection: (path: string, index: number) => void
  getTabSelection: (path: string) => number

  // MCP deploy state
  mcpDeployResult: DeployResult | null
  setMcpDeployResult: (result: DeployResult | null) => void

  // Streaming state
  streaming: boolean
  streamEvents: SSEEvent[]
  startStream: () => void
  appendStreamEvents: (events: SSEEvent[]) => void
  streamComplete: () => void
  clearStream: () => void

  // Detail panel state
  detailPanelOpen: boolean
  setDetailPanelOpen: (open: boolean) => void

  // Actions
  startFetch: () => void
  fetchSuccess: (data: unknown, schema: UnifiedSchema) => void
  fetchError: (error: Error) => void
  reset: () => void

  // OpenAPI actions
  clearSpec: () => void
  specSuccess: (spec: ParsedAPI) => void
  setSelectedOperation: (index: number) => void
  setParameterValue: (name: string, value: string) => void
  clearParameters: () => void
}

export const useAppStore = create<AppState>()((set, get) => ({
  url: '',
  urlMode: UrlMode.AUTO,
  optionsOpen: false,
  loading: false,
  error: null,
  data: null,
  schema: null,
  parsedSpec: null,
  selectedOperationIndex: 0,
  parameterValues: {},
  httpMethod: 'GET',
  requestBody: '',
  analysisCache: new Map(),
  tabSelections: new Map(),
  mcpDeployResult: null,
  streaming: false,
  streamEvents: [],
  detailPanelOpen: false,

  setUrl: (url) => set({ url }),
  setUrlMode: (mode) => set({ urlMode: mode }),
  setOptionsOpen: (open) => set({ optionsOpen: open }),
  setHttpMethod: (method) => set({ httpMethod: method }),
  setRequestBody: (body) => set({ requestBody: body }),
  startFetch: () => set({ loading: true, error: null, data: null, schema: null }),
  fetchSuccess: (data, schema) => set({ loading: false, data, schema, error: null }),
  fetchError: (error) => set({ loading: false, error, data: null, schema: null }),
  reset: () => set({
    url: '',
    urlMode: UrlMode.AUTO,
    optionsOpen: false,
    loading: false,
    error: null,
    data: null,
    schema: null,
    parsedSpec: null,
    selectedOperationIndex: 0,
    parameterValues: {},
    httpMethod: 'GET',
    requestBody: '',
    analysisCache: new Map(),
    mcpDeployResult: null,
  }),

  // Analysis cache actions
  setAnalysisCache: (path, data) => set((state) => {
    const newCache = new Map(state.analysisCache)
    newCache.set(path, data)
    return { analysisCache: newCache }
  }),
  getAnalysisCache: (path) => {
    const cache = get().analysisCache
    return cache.get(path) ?? null
  },
  clearAnalysisCache: () => set({ analysisCache: new Map() }),

  // Tab selection memory
  setTabSelection: (path, index) => set((state) => {
    const newSelections = new Map(state.tabSelections)
    newSelections.set(path, index)
    return { tabSelections: newSelections }
  }),
  getTabSelection: (path) => get().tabSelections.get(path) ?? 0,

  // MCP deploy
  setMcpDeployResult: (result) => set({ mcpDeployResult: result }),

  // Streaming
  startStream: () => set({ streaming: true, streamEvents: [], loading: true, error: null, data: null, schema: null }),
  appendStreamEvents: (events) => set((state) => {
    const combined = [...state.streamEvents, ...events]
    return { streamEvents: combined.length > MAX_STREAM_EVENTS ? combined.slice(-MAX_STREAM_EVENTS) : combined }
  }),
  streamComplete: () => set({ streaming: false, loading: false }),
  clearStream: () => set({ streaming: false, streamEvents: [] }),

  // Detail panel
  setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),

  // OpenAPI actions
  clearSpec: () => set({
    parsedSpec: null,
    selectedOperationIndex: 0,
    parameterValues: {},
  }),
  specSuccess: (spec) => set({
    parsedSpec: spec,
    selectedOperationIndex: 0,
    parameterValues: {},
    loading: false,
    error: null
  }),
  setSelectedOperation: (index) => set({
    selectedOperationIndex: index,
    parameterValues: {},
    data: null,
    schema: null
  }),
  setParameterValue: (name, value) => set((state) => ({
    parameterValues: { ...state.parameterValues, [name]: value }
  })),
  clearParameters: () => set({ parameterValues: {} }),
}))
