import type { UIMessage, ToolResultEntry } from '../../services/llm/types'
import type { StructuredResponse } from '@api2aux/chat-engine'
import { useAppStore } from '../../store/appStore'
import { useParameterStore } from '../../store/parameterStore'
import { generateToolName } from '@api2aux/tool-utils'
import { inferSchema } from '../../services/schema/inferrer'

interface ChatMessageProps {
  message: UIMessage
}

/** Scroll the response data panel into view with a highlight flash. */
function scrollToResponseData() {
  setTimeout(() => {
    const el = document.getElementById('response-data')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('highlight-flash')
      setTimeout(() => el.classList.remove('highlight-flash'), 1500)
    }
  }, 50)
}

/** Turn a tool name + args into a short, human-readable label */
function friendlyLabel(entry: ToolResultEntry): string {
  // Extract the key arg value (e.g. index="fighter" → "Fighter")
  const mainArg = Object.values(entry.toolArgs).find(v => typeof v === 'string' && v.length > 0) as string | undefined
  const prettyArg = mainArg
    ? mainArg.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : null

  // Extract a readable action from the tool name
  // e.g. "GET_api_classes_index_proficiencies" → "proficiencies"
  //      "GET_api_classes_index" → "classes"
  const parts = entry.toolName.replace(/^(GET|POST|PUT|PATCH|DELETE)_/i, '').split('_').filter(Boolean)
  // Remove "api" prefix and "index"/"by_id" noise
  const meaningful = parts.filter(p => !['api', 'index', 'by', 'id'].includes(p.toLowerCase()))
  const resource = meaningful.length > 0
    ? meaningful[meaningful.length - 1]!.replace(/\b\w/g, c => c.toUpperCase())
    : entry.toolName

  // Count info from summary (e.g. "→ 13 fields" or "→ 6 items")
  const countMatch = entry.summary.match(/→ (\d+ \w+)/)
  const countInfo = countMatch ? ` (${countMatch[1]})` : ''

  if (prettyArg) {
    return `${prettyArg} ${resource}${countInfo}`
  }
  return `${resource}${countInfo}`
}

function ToolResultLinks({ results, contextText }: { results: ToolResultEntry[], contextText?: string }) {
  const url = useAppStore((s) => s.url)

  const handleClick = (entry: ToolResultEntry) => {
    // Sync operation selector + parameter chips in the UI
    const { parsedSpec } = useAppStore.getState()
    if (parsedSpec && entry.toolName) {
      const opIndex = parsedSpec.operations.findIndex(op => generateToolName(op) === entry.toolName)
      if (opIndex >= 0) {
        const operation = parsedSpec.operations[opIndex]!
        // Set index directly — don't use setSelectedOperation which clears data/schema
        useAppStore.setState({ selectedOperationIndex: opIndex })
        const endpoint = `${parsedSpec.baseUrl}${operation.path}`
        const paramValues: Record<string, string> = {}
        for (const [key, value] of Object.entries(entry.toolArgs)) {
          if (value !== undefined && value !== '') paramValues[key] = String(value)
        }
        if (Object.keys(paramValues).length > 0) {
          useParameterStore.getState().setValues(endpoint, paramValues)
        }
      }
    }

    const schema = inferSchema(entry.data, url || '')
    useAppStore.getState().fetchSuccess(entry.data, schema)

    // Auto-select the most relevant tab based on the surrounding message text
    if (contextText && entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)) {
      const fields = Object.entries(entry.data as Record<string, unknown>)
        .filter(([, v]) => v !== null && typeof v === 'object')
        .map(([k]) => k)
      if (fields.length >= 2) {
        const tokenize = (s: string) =>
          s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-/]+/).filter(w => w.length > 2)
        const words = new Set(tokenize(contextText))
        let bestIdx = 0, bestScore = 0
        for (let i = 0; i < fields.length; i++) {
          const score = tokenize(fields[i]!).reduce((s, w) => s + (words.has(w) ? 1 : 0), 0)
          if (score > bestScore) { bestScore = score; bestIdx = i }
        }
        if (bestScore > 0) useAppStore.getState().setTabSelection('$', bestIdx)
      }
    }

    scrollToResponseData()
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1 mt-2 pt-2 border-t border-border/50">
      <span className="text-[10px] text-muted-foreground">Sources:</span>
      {results.map((entry, i) => (
        <button
          key={i}
          onClick={() => handleClick(entry)}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          title={`Show in main view: ${entry.summary}`}
        >
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {friendlyLabel(entry)}
        </button>
      ))}
    </div>
  )
}

function MergedDataButton({ structured }: { structured: StructuredResponse }) {
  const url = useAppStore((s) => s.url)

  const handleClick = () => {
    const schema = inferSchema(structured.data, url || '')
    useAppStore.getState().fetchSuccess(structured.data, schema)
    scrollToResponseData()
  }

  const sourceCount = structured.sources.length

  return (
    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/50">
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground hover:bg-accent/80 transition-colors cursor-pointer"
        title="Show merged data from all API calls in the main view"
      >
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        {`Merged data (${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'})`}
      </button>
    </div>
  )
}

export function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end px-4 py-2">
        <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm">
          {message.text}
        </div>
      </div>
    )
  }

  if (message.role === 'tool-result') {
    return (
      <div className="px-4 py-1.5">
        <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2.5 py-1.5 font-mono">
          {message.text}
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="flex justify-start px-4 py-2">
      <div className="max-w-[85%] rounded-lg bg-muted text-foreground px-3 py-2 text-sm">
        {message.loading && !message.text ? (
          <span className="inline-flex items-center gap-1">
            <span className="animate-pulse">Thinking</span>
            <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
          </span>
        ) : message.error && !message.text?.startsWith('Error:') ? (
          <span className="text-destructive">{message.text || message.error}</span>
        ) : (
          <>
            <span className="whitespace-pre-wrap">{message.text}</span>
            {message.structured && message.toolResults && message.toolResults.length >= 2 && (
              <MergedDataButton structured={message.structured} />
            )}
            {message.toolResults && message.toolResults.length > 0 && (
              <ToolResultLinks results={message.toolResults} contextText={message.text || undefined} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
