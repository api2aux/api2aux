import { useState, useCallback } from 'react'
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useAuthChainStore, getOrigin } from '../../store/authChainStore'
import { executeRaw } from '@api2aux/api-invoke'
import { proxy } from '../../services/api/proxy'
import { KeyRound, X, Play, Loader2, ChevronRight } from 'lucide-react'

/**
 * Recursively render a JSON object as a clickable tree.
 * Clicking a leaf value selects its dot-notation path as the token path.
 */
function ResponseTree({
  data,
  path,
  onSelect,
  selectedPath,
  depth,
}: {
  data: unknown
  path: string
  onSelect: (path: string) => void
  selectedPath: string
  depth: number
}) {
  const [expanded, setExpanded] = useState(depth < 2)

  if (data === null || data === undefined) {
    return <span className="text-muted-foreground/60 text-xs">null</span>
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>)
    return (
      <div className={depth > 0 ? 'ml-4' : ''}>
        {entries.map(([key, value]) => {
          const fullPath = path ? `${path}.${key}` : key
          const isLeaf = typeof value !== 'object' || value === null
          const isSelected = fullPath === selectedPath
          const isTokenLike = isLeaf && typeof value === 'string' && (value as string).length > 20

          return (
            <div key={key} className="py-0.5">
              <div className="flex items-start gap-1.5 group">
                {!isLeaf ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                  >
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                  </button>
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => onSelect(fullPath)}
                  className={`text-left flex items-baseline gap-1.5 rounded px-1 -mx-1 transition-colors ${
                    isSelected
                      ? 'bg-primary/15 ring-1 ring-primary/40'
                      : isTokenLike
                        ? 'bg-amber-50 hover:bg-amber-100'
                        : 'hover:bg-muted/50'
                  }`}
                  title={`Select "${fullPath}" as token path`}
                >
                  <span className="text-xs font-semibold text-blue-600 shrink-0">{key}:</span>
                  {isLeaf ? (
                    <span className="text-xs text-foreground/70 truncate max-w-xs">
                      {typeof value === 'string'
                        ? (value.length > 60 ? `"${value.substring(0, 60)}..."` : `"${value}"`)
                        : String(value)
                      }
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {Array.isArray(value) ? `[${(value as unknown[]).length}]` : '{...}'}
                    </span>
                  )}
                </button>
              </div>
              {!isLeaf && expanded && (
                <ResponseTree data={value} path={fullPath} onSelect={onSelect} selectedPath={selectedPath} depth={depth + 1} />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return <span className="text-xs text-foreground/70">{JSON.stringify(data)}</span>
}

interface AuthChainDialogProps {
  open: boolean
  onClose: () => void
  endpointUrl: string
  method: string
}

/**
 * Modal dialog for configuring an auth endpoint.
 * Includes a "Test Endpoint" button to preview the response and click to select the token path.
 */
export function AuthChainDialog({ open, onClose, endpointUrl, method }: AuthChainDialogProps) {
  const origin = getOrigin(endpointUrl)
  const { setConfig, getConfig, removeConfig } = useAuthChainStore()

  const existing = getConfig(origin)
  const isThisEndpoint = existing?.url === endpointUrl

  const [tokenPath, setTokenPath] = useState(isThisEndpoint ? existing.tokenPath : '')
  const [requestBody, setRequestBody] = useState(isThisEndpoint ? existing.requestBody : '')
  const [testing, setTesting] = useState(false)
  const [testResponse, setTestResponse] = useState<unknown>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const handleSave = () => {
    if (!tokenPath.trim()) return
    setConfig(origin, {
      url: endpointUrl,
      method,
      tokenPath: tokenPath.trim(),
      requestBody,
    })
    onClose()
  }

  const handleRemove = () => {
    removeConfig(origin)
    setTokenPath('')
    setRequestBody('')
    setTestResponse(null)
    onClose()
  }

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestError(null)
    setTestResponse(null)
    try {
      const result = await executeRaw(endpointUrl, {
        method,
        body: requestBody || undefined,
        headers: requestBody ? { 'Content-Type': 'application/json' } : undefined,
        middleware: [proxy],
      })
      setTestResponse(result.data)
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }, [endpointUrl, method, requestBody])

  const showBody = method.toUpperCase() !== 'GET'

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-5 pb-0">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-5 h-5 text-amber-500" />
              <DialogTitle className="text-base font-semibold text-foreground">
                Auth Endpoint Configuration
              </DialogTitle>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              This endpoint will be called automatically before other requests on the same origin.
              The extracted token will be injected as Bearer auth.
            </p>

            {/* Endpoint URL (read-only) */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Endpoint</label>
              <div className="px-3 py-2 text-sm font-mono bg-muted/40 border border-border rounded-md text-foreground/80 truncate">
                <span className="font-semibold text-foreground mr-2">{method}</span>
                {endpointUrl}
              </div>
            </div>

            {/* Request Body */}
            {showBody && (
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Request Body (JSON)</label>
                <textarea
                  value={requestBody}
                  onChange={(e) => setRequestBody(e.target.value)}
                  placeholder='{"username": "...", "password": "..."}'
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                />
              </div>
            )}

            {/* Test button */}
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              {testing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>
              ) : (
                <><Play className="w-4 h-4" /> Test Endpoint</>
              )}
            </button>

            {/* Test error */}
            {testError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                {testError}
              </div>
            )}

            {/* Test response */}
            {testResponse !== null && (
              <div className="border border-border rounded-md bg-muted/20">
                <div className="px-3 py-2 border-b border-border bg-muted/30 rounded-t-md">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Response — click a field to select as token path
                  </p>
                </div>
                <div className="p-3 max-h-64 overflow-y-auto">
                  <ResponseTree
                    data={testResponse}
                    path=""
                    onSelect={setTokenPath}
                    selectedPath={tokenPath}
                    depth={0}
                  />
                </div>
              </div>
            )}

            {/* Token Path */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Token Path <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={tokenPath}
                onChange={(e) => setTokenPath(e.target.value)}
                placeholder="e.g. authToken, data.access_token"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Dot-notation path to extract the token from the response JSON.
                {testResponse !== null && ' Click a field above to auto-fill.'}
              </p>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center gap-3 p-5 pt-4 border-t border-border">
            {isThisEndpoint && (
              <button
                type="button"
                onClick={handleRemove}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
              >
                Remove
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!tokenPath.trim()}
              className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

/**
 * Key icon button for marking an endpoint as auth provider.
 * Opens the AuthChainDialog modal when clicked.
 */
export function AuthChainKeyIcon({ url, method }: { url: string; method: string }) {
  const [open, setOpen] = useState(false)
  const isAuthEndpoint = useAuthChainStore((s) => s.isAuthEndpointUrl(url))

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        title={isAuthEndpoint ? 'Auth endpoint configured' : 'Set as auth endpoint'}
        className={`p-1 rounded transition-colors cursor-pointer ${
          isAuthEndpoint
            ? 'text-amber-500 hover:text-amber-600'
            : 'text-muted-foreground/40 hover:text-muted-foreground'
        }`}
      >
        <KeyRound className="w-4 h-4" />
      </button>
      <AuthChainDialog
        open={open}
        onClose={() => setOpen(false)}
        endpointUrl={url}
        method={method}
      />
    </>
  )
}
