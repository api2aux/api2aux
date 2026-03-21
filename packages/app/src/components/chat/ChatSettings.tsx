import { useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import { getAllProviders, getProvider } from '../../services/llm/providers/registry'
import type { ProviderId } from '../../services/llm/types'

export function ChatSettings() {
  const { config, setConfig, apiCacheEnabled, setApiCacheEnabled, apiCache, clearApiCache, embeddingProvider, setEmbeddingProvider, focusReduction, setFocusReduction } = useChatStore()
  const [showKey, setShowKey] = useState(false)

  const allProviders = getAllProviders()
  const currentProvider = getProvider(config.provider)
  const models = currentProvider?.models ?? []

  const corsProviders = allProviders.filter((p) => p.browserCors)
  const proxyProviders = allProviders.filter((p) => !p.browserCors)

  return (
    <div className="p-3 border-b border-border space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Provider</label>
          <select
            value={config.provider}
            onChange={(e) => {
              const provider = e.target.value as ProviderId
              const p = getProvider(provider)
              const defaultModel = p?.models[0]?.value ?? ''
              setConfig({ provider, model: defaultModel })
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {corsProviders.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {proxyProviders.length > 0 && (
              <optgroup label="Dev only (no browser CORS)">
                {proxyProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Model</label>
          <select
            value={config.model}
            onChange={(e) => setConfig({ model: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">API Key</label>
        <div className="flex gap-2">
          <input
            type={showKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={(e) => setConfig({ apiKey: e.target.value })}
            placeholder={currentProvider?.keyPlaceholder ?? 'sk-...'}
            className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <button
            onClick={() => setShowKey((s) => !s)}
            className="px-2 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        {currentProvider?.keyHelpUrl && (
          <p className="text-xs text-muted-foreground mt-1">
            Get a key at{' '}
            <a href={currentProvider.keyHelpUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              {currentProvider.keyHelpUrl.replace(/^https?:\/\//, '')}
            </a>
          </p>
        )}
        {currentProvider && !currentProvider.browserCors && (
          <p className="text-xs text-amber-500 mt-1">
            This provider doesn't support browser CORS — only works in dev via proxy.
          </p>
        )}
      </div>

      {/* Cache controls */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={apiCacheEnabled}
            onChange={(e) => setApiCacheEnabled(e.target.checked)}
            className="rounded border-border"
          />
          Cache API responses
          {apiCache.size > 0 && (
            <span className="text-[10px]">({apiCache.size} cached)</span>
          )}
        </label>
        {apiCache.size > 0 && (
          <button
            onClick={clearApiCache}
            className="px-2 py-1 rounded-md text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Clear cache
          </button>
        )}
      </div>

      {/* Embedding provider */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Embedding</label>
        <select
          value={embeddingProvider}
          onChange={(e) => setEmbeddingProvider(e.target.value as 'local' | 'openai')}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="local">Local (gte-small, browser)</option>
          <option value="openai">OpenAI (text-embedding-3-small)</option>
        </select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {embeddingProvider === 'local'
            ? 'Runs locally — ~33MB model downloaded on first use.'
            : 'Uses your API key for embeddings (~$0.00006/request).'}
        </p>
      </div>

      {/* Focus reduction strategy */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Focus strategy</label>
        <select
          value={focusReduction}
          onChange={(e) => setFocusReduction(e.target.value as 'truncate-values' | 'embed-fields' | 'llm-fields')}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="truncate-values">Truncate values (default)</option>
          <option value="embed-fields">Embed fields (semantic)</option>
          <option value="llm-fields">LLM fields (most accurate)</option>
        </select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {focusReduction === 'truncate-values' && 'Keeps all fields, truncates long values. No extra calls.'}
          {focusReduction === 'embed-fields' && 'Selects relevant fields via embeddings. Uses embedding service.'}
          {focusReduction === 'llm-fields' && 'Selects relevant fields via LLM reasoning. Extra lightweight LLM call.'}
        </p>
      </div>
    </div>
  )
}
