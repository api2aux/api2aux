import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore, UrlMode, BodyFormat } from '../store/appStore'
import { useAPIFetch } from '../hooks/useAPIFetch'
import { useAuthStore } from '../store/authStore'
import { Badge } from './ui/badge'
import { LockIcon } from './auth/LockIcon'
import { AuthPanel } from './auth/AuthPanel'
import { ExamplesCarousel } from './ExamplesCarousel'
import { RequestBodyEditor } from './forms/RequestBodyEditor'
import type { AuthStatus } from '../types/auth'
import type { AuthScheme } from '@api2aux/semantic-analysis'

const BODY_FORMATS = [
  { value: BodyFormat.JSON, label: 'JSON' },
  { value: BodyFormat.FORM_URLENCODED, label: 'Form' },
  { value: BodyFormat.FORM_DATA, label: 'Multipart' },
  { value: BodyFormat.TEXT, label: 'Text' },
] as const

const BODY_FORMAT_CONTENT_TYPE: Record<BodyFormat, string> = {
  [BodyFormat.JSON]: 'application/json',
  [BodyFormat.FORM_URLENCODED]: 'application/x-www-form-urlencoded',
  [BodyFormat.FORM_DATA]: 'multipart/form-data',
  [BodyFormat.TEXT]: 'text/plain',
}

const URL_MODES = [
  { value: UrlMode.AUTO, label: 'Auto', tooltip: 'Auto-detect format from URL and content' },
  { value: UrlMode.SPEC, label: 'API Spec', tooltip: 'Treat as an OpenAPI or Swagger specification' },
  { value: UrlMode.GRAPHQL, label: 'GraphQL', tooltip: 'Discover operations via GraphQL introspection (beta)', beta: true as const },
  { value: UrlMode.ENDPOINT, label: 'Endpoint', tooltip: 'Treat as a direct API endpoint' },
] as const

interface URLInputProps {
  authError?: { status: 401 | 403; message: string } | null
  detectedAuth?: AuthScheme[]
}

export function URLInput({ authError, detectedAuth }: URLInputProps = {}) {
  const { url, setUrl, loading, schema, parsedSpec, error, httpMethod, setHttpMethod, requestBody, setRequestBody, requestBodyFormat, setRequestBodyFormat, reset, urlMode, setUrlMode, additionalEndpoints, addEndpoint, removeEndpoint, updateEndpoint, clearEndpoints } = useAppStore()
  const { fetchAndInfer, fetchMultiEndpoints } = useAPIFetch()
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loadingExampleUrl, setLoadingExampleUrl] = useState<string | null>(null)
  const authPanelOpen = useAppStore((s) => s.authPanelOpen)
  const setAuthPanelOpen = useAppStore((s) => s.setAuthPanelOpen)
  const authPanelDismissedForUrl = useAppStore((s) => s.authPanelDismissedForUrl)
  const baseUrlOverride = useAppStore((s) => s.baseUrlOverride)

  // Use effective base URL for auth when a spec is loaded (credentials are stored by origin)
  const authUrl = (parsedSpec ? (baseUrlOverride ?? parsedSpec.baseUrl) : url) || url

  // Auth state
  const getAuthStatus = useAuthStore((state) => state.getAuthStatus)
  const getCredentials = useAuthStore((state) => state.getCredentials)

  // Derive lock icon status from auth state
  const authStatus = getAuthStatus(authUrl)
  const apiCreds = getCredentials(authUrl)
  const hasActiveCredential = apiCreds?.activeType !== null && apiCreds?.activeType !== undefined

  const lockStatus: AuthStatus =
    authError
      ? 'failed'
      : authStatus === 'success' || (authStatus === 'untested' && hasActiveCredential)
        ? 'success'
        : authStatus === 'failed'
          ? 'failed'
          : 'untested'

  // Derive a stable boolean: does this spec have supported auth schemes?
  const specHasAuth = !!(detectedAuth && detectedAuth.some(scheme => scheme.authType !== null))

  // Auto-expand panel when auth error occurs — but respect manual dismiss
  useEffect(() => {
    if (authError && authPanelDismissedForUrl !== url) {
      setAuthPanelOpen(true)
    }
  }, [authError, authPanelDismissedForUrl, url, setAuthPanelOpen])

  // Auto-expand panel when spec has supported security schemes — once per URL
  useEffect(() => {
    if (specHasAuth && authPanelDismissedForUrl !== url) {
      setAuthPanelOpen(true)
    }
  }, [specHasAuth, authPanelDismissedForUrl, url, setAuthPanelOpen])

  const handleAuthPanelToggle = () => {
    const newState = !authPanelOpen
    setAuthPanelOpen(newState)
    if (!newState) {
      useAppStore.setState({ authPanelDismissedForUrl: url })
    }
  }

  const isMultiEndpoint = urlMode === UrlMode.ENDPOINT && additionalEndpoints.length > 0

  const handleModeChange = (mode: UrlMode) => {
    setUrlMode(mode)
    if (mode === UrlMode.GRAPHQL && !sessionStorage.getItem('graphql-beta-toast-shown')) {
      toast.info('GraphQL support is in beta', {
        description: 'Some features may be incomplete. Feedback is welcome!',
        duration: 5000,
      })
      sessionStorage.setItem('graphql-beta-toast-shown', '1')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!url.trim()) {
      setValidationError('Please enter a URL')
      return
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setValidationError('URL must start with http:// or https://')
      return
    }

    setValidationError(null)

    const newUrl = new URL(window.location.href)
    newUrl.searchParams.set('api', url)
    window.history.pushState({}, '', newUrl.toString())

    if (urlMode === UrlMode.ENDPOINT && isMultiEndpoint) {
      fetchMultiEndpoints()
      return
    }

    const useCustomMethod = urlMode === UrlMode.ENDPOINT && httpMethod !== 'GET'
    fetchAndInfer(url, useCustomMethod ? {
      method: httpMethod,
      body: requestBody || undefined,
      contentType: BODY_FORMAT_CONTENT_TYPE[requestBodyFormat],
    } : undefined)
  }

  const handleExampleClick = async (exampleUrl: string, method?: string, body?: string) => {
    setUrl(exampleUrl)
    setHttpMethod(method ?? 'GET')
    setRequestBody(body ?? '')
    setValidationError(null)
    setLoadingExampleUrl(exampleUrl)

    const newUrl = new URL(window.location.href)
    newUrl.searchParams.set('api', exampleUrl)
    window.history.pushState({}, '', newUrl.toString())

    const fetchOptions = method && method !== 'GET' ? { method, body: body || undefined } : undefined
    await fetchAndInfer(exampleUrl, fetchOptions)
    setLoadingExampleUrl(null)
  }

  const handleClear = () => {
    reset()
    setValidationError(null)
    setAuthPanelOpen(false)
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('api')
    cleanUrl.hash = ''
    window.history.pushState({}, '', cleanUrl.toString())
  }

  // Auto-clear stale data when user empties the URL input
  useEffect(() => {
    if (!url.trim() && (schema || parsedSpec)) {
      handleClear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const handleAddMultipleEndpoints = () => {
    if (urlMode !== UrlMode.ENDPOINT) setUrlMode(UrlMode.ENDPOINT)
    addEndpoint()
  }

  const hasData = schema || parsedSpec
  const urlEmpty = !url.trim()
  const showCarousel = !loading && (urlEmpty || (!schema && !parsedSpec && !error))

  return (
    <div className="w-full max-w-4xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Single endpoint: URL bar with method dropdown */}
        {!isMultiEndpoint && (
          <div className="flex gap-2">
            <select
              value={httpMethod}
              onChange={(e) => setHttpMethod(e.target.value)}
              className="px-2 py-2 border border-input rounded-md bg-background text-sm font-mono focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
              disabled={loading}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setValidationError(null)
              }}
              placeholder="https://jsonplaceholder.typicode.com/users"
              className="flex-1 px-4 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus-visible:ring-ring/50 focus:border-transparent"
              disabled={loading}
            />
            {(url || hasData) && !loading && (
              <button
                type="button"
                onClick={handleClear}
                className="px-2 py-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Clear and start over"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <LockIcon
              status={lockStatus}
              activeType={apiCreds?.activeType}
              onClick={handleAuthPanelToggle}
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Loading...' : 'Go'}
            </button>
          </div>
        )}

        {/* Multi-endpoint view */}
        {isMultiEndpoint && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Endpoints</span>
              <button
                type="button"
                onClick={clearEndpoints}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                disabled={loading}
              >
                Single endpoint
              </button>
            </div>
            {/* Primary endpoint row */}
            <div className="flex items-center gap-2">
              <select
                value={httpMethod}
                onChange={(e) => setHttpMethod(e.target.value)}
                className="px-2 py-1.5 border border-input rounded-md bg-background text-xs font-mono focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
                disabled={loading}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setValidationError(null)
                }}
                placeholder="https://api.example.com/resource"
                className="flex-1 px-3 py-1.5 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
                disabled={loading}
              />
              <LockIcon
                status={lockStatus}
                activeType={apiCreds?.activeType}
                onClick={handleAuthPanelToggle}
              />
            </div>
            {/* Additional endpoint rows */}
            {additionalEndpoints.map((ep, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={ep.method}
                  onChange={(e) => updateEndpoint(i, 'method', e.target.value)}
                  className="px-2 py-1.5 border border-input rounded-md bg-background text-xs font-mono focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
                  disabled={loading}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
                <input
                  type="text"
                  value={ep.url}
                  onChange={(e) => updateEndpoint(i, 'url', e.target.value)}
                  placeholder="https://api.example.com/resource"
                  className="flex-1 px-3 py-1.5 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => removeEndpoint(i)}
                  className="px-1 py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Remove endpoint"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addEndpoint}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              disabled={loading}
            >
              + Add endpoint
            </button>
          </div>
        )}

        {/* Mode toggle row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {URL_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  title={mode.tooltip}
                  onClick={() => handleModeChange(mode.value)}
                  className={`px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    urlMode === mode.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {mode.label}
                  {'beta' in mode && mode.beta && (
                    <Badge variant="warning" className="ml-1 text-[9px] px-1 py-0 rounded">
                      beta
                    </Badge>
                  )}
                </button>
              ))}
            </div>
            {/* "Add multiple endpoints" — right next to mode toggle, Endpoint mode only */}
            {urlMode === UrlMode.ENDPOINT && !isMultiEndpoint && (
              <button
                type="button"
                onClick={handleAddMultipleEndpoints}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                disabled={loading}
              >
                + Add multiple endpoints
              </button>
            )}
          </div>
          {/* Go button in multi-endpoint view */}
          {isMultiEndpoint && (
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Loading...' : 'Go'}
            </button>
          )}
        </div>

        {/* Endpoint mode: body format + editor (single endpoint, non-GET) */}
        {urlMode === UrlMode.ENDPOINT && !isMultiEndpoint && httpMethod !== 'GET' && (
          <div className="space-y-3 p-3 border border-border rounded-md bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">Body</span>
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {BODY_FORMATS.map((fmt) => (
                  <button
                    key={fmt.value}
                    type="button"
                    onClick={() => setRequestBodyFormat(fmt.value)}
                    className={`px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      requestBodyFormat === fmt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>
            {!parsedSpec && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Request Body
                </label>
                <RequestBodyEditor
                  value={requestBody}
                  onChange={setRequestBody}
                  rows={4}
                />
              </div>
            )}
          </div>
        )}

        {/* Auth Panel */}
        <AuthPanel
          url={authUrl}
          isOpen={authPanelOpen}
          onToggle={handleAuthPanelToggle}
          authError={authError}
          detectedAuth={detectedAuth}
          onConfigureClick={() => setAuthPanelOpen(true)}
        />

        {validationError && (
          <div className="text-red-600 text-sm">{validationError}</div>
        )}
      </form>

      {/* Compact examples carousel (only when no data loaded) */}
      {showCarousel && (
        <div className="mt-4">
          <ExamplesCarousel
            onExampleClick={handleExampleClick}
            loading={loading}
            loadingUrl={loadingExampleUrl}
          />
        </div>
      )}

      {/* "Try an example" link when data is loaded */}
      {hasData && !loading && !urlEmpty && (
        <div className="mt-2 text-center">
          <button
            onClick={() => {
              window.location.hash = '#/examples'
              window.dispatchEvent(new HashChangeEvent('hashchange'))
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Try another example &rarr;
          </button>
        </div>
      )}
    </div>
  )
}
