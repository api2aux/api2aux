import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { useAPIFetch } from '../hooks/useAPIFetch'
import { useAuthStore } from '../store/authStore'
import { LockIcon } from './auth/LockIcon'
import { AuthPanel } from './auth/AuthPanel'
import { ExamplesCarousel } from './ExamplesCarousel'
import { RequestBodyEditor } from './forms/RequestBodyEditor'
import type { AuthStatus } from '../types/auth'
import type { AuthScheme } from '@api2aux/semantic-analysis'

interface URLInputProps {
  authError?: { status: 401 | 403; message: string } | null
  detectedAuth?: AuthScheme[]
}

export function URLInput({ authError, detectedAuth }: URLInputProps = {}) {
  const { url, setUrl, loading, schema, parsedSpec, error, httpMethod, setHttpMethod, requestBody, setRequestBody, reset } = useAppStore()
  const { fetchAndInfer } = useAPIFetch()
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loadingExampleUrl, setLoadingExampleUrl] = useState<string | null>(null)
  const [authPanelOpen, setAuthPanelOpen] = useState(false)

  // Auth state
  const getAuthStatus = useAuthStore((state) => state.getAuthStatus)
  const getCredentials = useAuthStore((state) => state.getCredentials)

  // Derive lock icon status from auth state
  const authStatus = getAuthStatus(url)
  const apiCreds = getCredentials(url)
  const hasActiveCredential = apiCreds?.activeType !== null && apiCreds?.activeType !== undefined

  const lockStatus: AuthStatus =
    authError
      ? 'failed'
      : authStatus === 'success' || (authStatus === 'untested' && hasActiveCredential)
        ? 'success'
        : authStatus === 'failed'
          ? 'failed'
          : 'untested'

  // Auto-expand panel when auth error occurs
  useEffect(() => {
    if (authError) {
      setAuthPanelOpen(true)
    }
  }, [authError])

  // Auto-expand panel when spec has supported security schemes
  useEffect(() => {
    if (detectedAuth && detectedAuth.some(scheme => scheme.authType !== null)) {
      setAuthPanelOpen(true)
    }
  }, [detectedAuth])

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

    fetchAndInfer(url, httpMethod !== 'GET' ? { method: httpMethod, body: requestBody || undefined } : undefined)
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

  const hasData = schema || parsedSpec
  const urlEmpty = !url.trim()
  const showCarousel = !loading && (urlEmpty || (!schema && !parsedSpec && !error))

  return (
    <div className="w-full max-w-4xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2">
          <select
            value={httpMethod}
            onChange={(e) => setHttpMethod(e.target.value)}
            className="px-2 py-2 border border-input rounded-md bg-background text-sm font-mono focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
            disabled={loading}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
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
            onClick={() => setAuthPanelOpen(!authPanelOpen)}
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Fetching...' : 'Fetch'}
          </button>
        </div>

        {/* Auth Panel */}
        <AuthPanel
          url={url}
          isOpen={authPanelOpen}
          onToggle={() => setAuthPanelOpen(!authPanelOpen)}
          authError={authError}
          detectedAuth={detectedAuth}
          onConfigureClick={() => setAuthPanelOpen(true)}
        />

        {/* Request Body (for non-GET methods) */}
        {httpMethod !== 'GET' && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Request Body (JSON)
            </label>
            <RequestBodyEditor
              value={requestBody}
              onChange={setRequestBody}
              rows={4}
            />
          </div>
        )}

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
