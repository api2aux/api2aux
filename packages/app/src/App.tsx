import { useEffect, useRef, useState } from 'react'
import { useAppStore } from './store/appStore'
import { useConfigStore } from './store/configStore'
import { useParameterStore } from './store/parameterStore'
import { usePluginStore } from './store/pluginStore'
import { useAPIFetch } from './hooks/useAPIFetch'
import { useSchemaAnalysis } from './hooks/useSchemaAnalysis'
import { hydrateFromHash } from './services/sharing/hydrator'
import { loadAndRegisterPlugins } from './services/plugins/loader'
import { URLInput } from './components/URLInput'
import { DynamicRenderer } from './components/DynamicRenderer'
import { ErrorDisplay } from './components/error/ErrorDisplay'
import { SkeletonTable } from './components/loading/SkeletonTable'
import { OperationSelector } from './components/openapi/OperationSelector'
import { ParameterForm } from './components/forms/ParameterForm'
import { AppliedFilters } from './components/forms/AppliedFilters'
import { ThemeApplier } from './components/config/ThemeApplier'
import { ThemeToggle } from './components/config/ThemeToggle'
import { Badge } from './components/ui/badge'
import { Sidebar } from './components/navigation/Sidebar'
import { LayoutContainer } from './components/layout/LayoutContainer'
import { parseUrlParameters, reconstructQueryString } from './services/urlParser/parser'
import { ShareButton } from './components/ShareButton'
import { MCPButton } from './components/MCPExportDialog'
import { ChatButton } from './components/chat/ChatPanel'
import { AppShell } from './components/layout/AppShell'
import { useChatStore } from './store/chatStore'
import { DrilldownModeToggle } from './components/navigation/DrilldownModeToggle'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { ExamplesPage } from './pages/ExamplesPage'
import { RequestPreview } from './components/forms/RequestPreview'
import { StreamDisplay } from './components/renderers/StreamDisplay'
import { AuthError } from './services/api/errors'
import type { BuiltRequest } from 'api-invoke'
import 'react-loading-skeleton/dist/skeleton.css'

/** Stable empty array to avoid re-render loops when passed as a prop */
const EMPTY_PARAMS: [] = []

/** Toolbar row shown during loading so the UI doesn't shift when data arrives */
function ResultsToolbar() {
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <DrilldownModeToggle />
        <div className="flex items-center gap-2">
          <ChatButton />
          <MCPButton />
          <ShareButton />
        </div>
      </div>
    </>
  )
}

function App() {
  const {
    url,
    setUrl,
    loading,
    error,
    data,
    schema,
    parsedSpec,
    selectedOperationIndex,
    setSelectedOperation,
    reset,
    detailPanelOpen
  } = useAppStore()
  const streaming = useAppStore((s) => s.streaming)
  const hasStreamEvents = useAppStore((s) => s.streamEvents.length > 0)
  const clearStream = useAppStore((s) => s.clearStream)
  const chatOpen = useChatStore((s) => s.open)
  const { clearFieldConfigs } = useConfigStore()
  const { getValues, clearValue, clearEndpoint } = useParameterStore()
  const { fetchAndInfer, fetchOperation, fetchOperationStream, previewRequest } = useAPIFetch()

  // AbortController for streaming
  const streamAbortRef = useRef<AbortController | null>(null)

  // Hash-based routing for /examples page
  const [page, setPage] = useState<'main' | 'examples'>(
    window.location.hash === '#/examples' ? 'examples' : 'main'
  )

  useEffect(() => {
    const onHashChange = () => {
      setPage(window.location.hash === '#/examples' ? 'examples' : 'main')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Run semantic analysis pipeline when schema/data changes
  useSchemaAnalysis(schema, data)

  // Load installed external plugins on startup
  useEffect(() => {
    const { installed } = usePluginStore.getState()
    if (installed.length > 0) {
      loadAndRegisterPlugins(installed).then(results => {
        for (const r of results) {
          if (r.error) usePluginStore.getState().setLoadError(r.manifest.id, r.error)
        }
      })
    }
  }, [])

  // Request preview state
  const [previewData, setPreviewData] = useState<BuiltRequest | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Derive auth error from error state
  const authError = error && error instanceof AuthError
    ? { status: error.status, message: error.message }
    : null

  // Hydrate from URL hash (#share=...) or query param (?api=...) on load
  useEffect(() => {
    // Hash share links take priority
    const sharedState = hydrateFromHash()
    if (sharedState) {
      fetchAndInfer(sharedState.apiUrl)
      // Clear the hash to avoid re-hydration on refresh
      history.replaceState(null, '', window.location.pathname + window.location.search)
      return
    }

    // Fallback: legacy ?api= query param
    const params = new URLSearchParams(window.location.search)
    const apiParam = params.get('api')
    if (apiParam) {
      setUrl(apiParam)
      fetchAndInfer(apiParam)
    }
  }, [])

  const handleRetry = () => {
    if (url) {
      fetchAndInfer(url)
    }
  }

  const handleGoHome = () => {
    reset()
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('api')
    cleanUrl.hash = ''
    window.history.pushState({}, '', cleanUrl.toString())
  }

  // Show toast notification on error (skip auth errors — shown in auth panel)
  useEffect(() => {
    if (error && !(error instanceof AuthError)) {
      toast.error('Failed to fetch data', {
        description: String(error),
        duration: 5000,
      })
    }
  }, [error])

  // Auto-invoke first safe endpoint after spec loads
  useEffect(() => {
    if (parsedSpec && parsedSpec.operations.length > 0 && !data && !schema && !loading) {
      // Find a GET operation with no required params (safe to call with empty args)
      const safeOp = parsedSpec.operations.find(op =>
        op.method === 'GET' &&
        !op.parameters.some(p => p.required)
      )
      if (safeOp) {
        const idx = parsedSpec.operations.indexOf(safeOp)
        if (idx !== selectedOperationIndex) setSelectedOperation(idx)
        fetchOperation(parsedSpec.baseUrl, safeOp, {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedSpec])

  // Derive selected operation
  const selectedOperation = parsedSpec?.operations[selectedOperationIndex]

  // Get endpoint for current state
  const getEndpoint = () => {
    if (parsedSpec && selectedOperation) {
      return `${parsedSpec.baseUrl}${selectedOperation.path}`
    }
    if (url) {
      return url.split('?')[0]
    }
    return ''
  }

  // Check if the selected operation produces an SSE stream
  const isStreamingOperation = selectedOperation?.responseContentType === 'text/event-stream'

  // Handle parameter form submission
  const handleParameterSubmit = (values: Record<string, string>, bodyJson?: string) => {
    if (parsedSpec && selectedOperation) {
      if (isStreamingOperation) {
        // Abort any existing stream
        streamAbortRef.current?.abort()
        const controller = new AbortController()
        streamAbortRef.current = controller
        fetchOperationStream(parsedSpec.baseUrl, selectedOperation, values, bodyJson, controller.signal)
      } else {
        fetchOperation(parsedSpec.baseUrl, selectedOperation, values, bodyJson)
      }
    }
  }

  // Stop an active stream
  const handleStopStream = () => {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
  }

  // Handle request preview
  const handlePreview = (values: Record<string, string>, bodyJson?: string) => {
    if (parsedSpec && selectedOperation) {
      const built = previewRequest(parsedSpec.baseUrl, selectedOperation, values, bodyJson)
      setPreviewData(built)
      setPreviewOpen(true)
    }
  }

  // Handle filter removal - clear single filter and re-fetch
  const handleFilterRemove = (key: string) => {
    const endpoint = getEndpoint()
    if (!endpoint) return

    const currentValues = getValues(endpoint)
    clearValue(endpoint, key)

    // Trigger re-fetch with updated values
    const updatedValues = { ...currentValues }
    delete updatedValues[key]

    if (parsedSpec && selectedOperation) {
      fetchOperation(parsedSpec.baseUrl, selectedOperation, updatedValues)
    } else if (url) {
      // Direct API URL flow
      const { parameters: originalParams } = parseUrlParameters(url)
      const queryString = reconstructQueryString(updatedValues, originalParams)
      const newUrl = queryString ? `${endpoint}?${queryString}` : endpoint
      setUrl(newUrl)
      fetchAndInfer(newUrl)
    }
  }

  // Handle clear all filters - clear all and re-fetch
  const handleFilterClearAll = () => {
    const endpoint = getEndpoint()
    if (!endpoint) return

    clearEndpoint(endpoint)

    // Trigger re-fetch with empty values
    if (parsedSpec && selectedOperation) {
      fetchOperation(parsedSpec.baseUrl, selectedOperation, {})
    } else if (url) {
      // Direct API URL flow - fetch base URL with no params
      setUrl(endpoint)
      fetchAndInfer(endpoint)
    }
  }

  const handleSelectOperation = (index: number) => {
    clearFieldConfigs()
    handleStopStream()
    clearStream()
    setSelectedOperation(index)
  }

  // Determine if we should show the sidebar
  const showSidebar = parsedSpec !== null && parsedSpec.operations.length >= 2

  // Examples page route
  if (page === 'examples') {
    return (
      <>
        <ThemeApplier />
        <div className="fixed top-4 right-4 z-50">
          <ThemeToggle />
        </div>
        <ExamplesPage
          onExampleClick={(exampleUrl, method, body) => {
            setUrl(exampleUrl)
            useAppStore.getState().setHttpMethod(method ?? 'GET')
            useAppStore.getState().setRequestBody(body ?? '')
            window.location.hash = ''
            const newBrowserUrl = new URL(window.location.href)
            newBrowserUrl.searchParams.set('api', exampleUrl)
            newBrowserUrl.hash = ''
            window.history.pushState({}, '', newBrowserUrl.toString())
            const fetchOptions = method && method !== 'GET' ? { method, body: body || undefined } : undefined
            fetchAndInfer(exampleUrl, fetchOptions)
          }}
          onBack={() => {
            window.location.hash = ''
          }}
        />
        <Toaster position="bottom-right" />
      </>
    )
  }

  return (
    <>
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded"
      >
        Skip to main content
      </a>

      {/* Theme and style synchronization */}
      <ThemeApplier />

      <AppShell>
      {showSidebar ? (
        // Sidebar layout for multi-endpoint specs
        <div className="flex min-h-screen bg-background text-foreground">
          <Sidebar
            parsedSpec={parsedSpec}
            selectedIndex={selectedOperationIndex}
            onSelect={handleSelectOperation}
          />
          <main
            id="main-content"
            className={`flex-1 overflow-y-auto py-8 px-6 transition-[padding] duration-300 ${detailPanelOpen && !chatOpen ? 'pr-[42rem]' : ''}`}
          >
            <div>
              {/* Header */}
              <div className="relative text-center mb-8">
                <div className="absolute right-0 top-0">
                  <ThemeToggle />
                </div>
                <h1 className="text-2xl font-semibold text-foreground mb-2">
                  <button onClick={handleGoHome} className="cursor-pointer hover:opacity-70 transition-opacity">api2aux</button>
                </h1>
                <p className="text-sm text-muted-foreground">
                  Paste an API URL. Get instant [Agent + User] eXperience.
                </p>
              </div>

              {/* URL Input */}
              <div className="flex justify-center mb-8">
                <URLInput authError={authError} detectedAuth={parsedSpec?.authSchemes} />
              </div>

              {/* Main Content Area */}
              <div className="@container bg-card rounded-lg shadow-md p-6 max-w-6xl mx-auto">
                {/* Standalone error (non-spec, non-parameterized URL failures; skip auth errors — shown in auth panel) */}
                {error && !loading && !parsedSpec && !authError && !(url && url.includes('?')) && (
                  <ErrorDisplay error={error} onRetry={handleRetry} />
                )}

                {/* OpenAPI Spec UI — stays visible even on operation errors */}
                {parsedSpec && !loading && (
                  <div className="space-y-6">
                    {/* Spec Info Header */}
                    <div className="border-b border-border pb-4">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold text-foreground">
                          {parsedSpec.title}
                        </h2>
                        <span className="px-2 py-1 text-xs font-medium text-muted-foreground bg-muted rounded">
                          v{parsedSpec.version}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium text-muted-foreground bg-muted rounded">
                          {parsedSpec.specFormat === 'graphql' ? 'GraphQL' : parsedSpec.specFormat === 'raw-url' ? parsedSpec.title : `OpenAPI ${parsedSpec.rawSpecVersion}`}
                        </span>
                        {parsedSpec.specFormat === 'graphql' && (
                          <Badge variant="warning" className="text-[10px] px-1.5 py-0">beta</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{parsedSpec.baseUrl}</p>
                    </div>

                    {/* No GET operations message */}
                    {parsedSpec.operations.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <p className="text-lg">This API spec has no supported endpoints to display.</p>
                      </div>
                    )}

                    {/* Layout Container with Parameters and Results */}
                    {parsedSpec.operations.length > 0 && selectedOperation && (
                      <LayoutContainer
                        endpoint={`${parsedSpec.baseUrl}${selectedOperation.path}`}
                        parameters={
                          <ParameterForm
                            parameters={selectedOperation.parameters}
                            requestBody={selectedOperation.requestBody}
                            onSubmit={handleParameterSubmit}
                            onPreview={handlePreview}
                            submitLabel={isStreamingOperation ? 'Stream' : undefined}
                            loading={loading}
                            endpoint={`${parsedSpec.baseUrl}${selectedOperation.path}`}
                            baseUrl={`${parsedSpec.baseUrl}${selectedOperation.path}`}
                          />
                        }
                        results={
                          <>
                            {/* Applied Filter Chips */}
                            <AppliedFilters
                              filters={getValues(`${parsedSpec.baseUrl}${selectedOperation.path}`)}
                              onRemove={handleFilterRemove}
                              onClearAll={handleFilterClearAll}
                            />

                            {/* Inline operation error — form stays usable above */}
                            {error && <ErrorDisplay error={error} />}

                            {/* Streaming display */}
                            {(streaming || (isStreamingOperation && hasStreamEvents)) && (
                              <div className="border-t border-border pt-6">
                                <StreamDisplay onStop={handleStopStream} />
                              </div>
                            )}

                            {/* Loading indicator for operation fetch */}
                            {loading && !streaming && <SkeletonTable />}

                            {/* Data Rendering (after fetching operation) */}
                            {!streaming && schema && data !== null && (
                              <div id="response-data" className="border-t border-border pt-6">
                                <h3 className="text-lg font-semibold text-foreground mb-4">Response Data</h3>
                                <DynamicRenderer
                                  data={data}
                                  schema={schema.rootType}
                                  path="$"
                                  depth={0}
                                  hideViewControls
                                />
                              </div>
                            )}
                          </>
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      ) : (
        // Centered layout for single-endpoint and direct URLs
        <div className={`min-h-screen bg-background text-foreground py-8 px-4 transition-[padding] duration-300 ${detailPanelOpen && !chatOpen ? 'pr-[42rem]' : ''}`}>
          <div className={chatOpen ? 'w-full' : 'max-w-6xl mx-auto'}>
            {/* Header */}
            <div className="relative text-center mb-8">
              <div className="absolute right-0 top-0">
                <ThemeToggle />
              </div>
              <h1 className="text-2xl font-semibold text-foreground mb-2">
                <button onClick={handleGoHome} className="cursor-pointer hover:opacity-70 transition-opacity">api2aux</button>
              </h1>
              <p className="text-sm text-muted-foreground">
                Paste an API URL. Get instant [Agent + User] eXperience.
              </p>
            </div>

            {/* URL Input */}
            <div className="flex justify-center mb-8">
              <URLInput authError={authError} detectedAuth={parsedSpec?.authSchemes} />
            </div>

            {/* Main Content Area */}
            <div className="@container bg-card rounded-lg shadow-md p-6">
              {/* Standalone error (non-spec, non-parameterized URL failures; skip auth errors — shown in auth panel) */}
              {error && !loading && !parsedSpec && !authError && !(url && url.includes('?')) && (
                <ErrorDisplay error={error} onRetry={handleRetry} />
              )}

              {/* OpenAPI Spec UI — stays visible even on operation errors */}
              {parsedSpec && !loading && (
                <div className="space-y-6">
                  {/* Spec Info Header */}
                  <div className="border-b border-border pb-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-foreground">
                        {parsedSpec.title}
                      </h2>
                      <span className="px-2 py-1 text-xs font-medium text-muted-foreground bg-muted rounded">
                        v{parsedSpec.version}
                      </span>
                      <span className="px-2 py-1 text-xs font-medium text-muted-foreground bg-muted rounded">
                        {parsedSpec.specFormat === 'graphql' ? 'GraphQL' : parsedSpec.specFormat === 'raw-url' ? parsedSpec.title : `OpenAPI ${parsedSpec.rawSpecVersion}`}
                      </span>
                      {parsedSpec.specFormat === 'graphql' && (
                        <Badge variant="warning" className="text-[10px] px-1.5 py-0">beta</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{parsedSpec.baseUrl}</p>
                  </div>

                  {/* No GET operations message */}
                  {parsedSpec.operations.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-lg">This API spec has no supported endpoints to display.</p>
                    </div>
                  )}

                  {/* Operation Selector (single-endpoint only) */}
                  {parsedSpec.operations.length === 1 && (
                    <OperationSelector
                      operations={parsedSpec.operations}
                      selectedIndex={0}
                      onSelect={() => {}}
                    />
                  )}

                  {/* Layout Container with Parameters and Results */}
                  {parsedSpec.operations.length > 0 && selectedOperation && (
                    <LayoutContainer
                      endpoint={`${parsedSpec.baseUrl}${selectedOperation.path}`}
                      parameters={
                        <ParameterForm
                          parameters={selectedOperation.parameters}
                          requestBody={selectedOperation.requestBody}
                          onSubmit={handleParameterSubmit}
                          onPreview={handlePreview}
                          submitLabel={isStreamingOperation ? 'Stream' : undefined}
                          loading={loading}
                          endpoint={`${parsedSpec.baseUrl}${selectedOperation.path}`}
                          baseUrl={`${parsedSpec.baseUrl}${selectedOperation.path}`}
                        />
                      }
                      results={
                        <>
                          {/* Applied Filter Chips */}
                          <AppliedFilters
                            filters={getValues(`${parsedSpec.baseUrl}${selectedOperation.path}`)}
                            onRemove={handleFilterRemove}
                            onClearAll={handleFilterClearAll}
                          />

                          {/* Inline operation error — form stays usable above */}
                          {error && <ErrorDisplay error={error} />}

                          {/* Streaming display */}
                          {(streaming || (isStreamingOperation && hasStreamEvents)) && (
                            <div className="border-t border-border pt-6">
                              <StreamDisplay onStop={handleStopStream} />
                            </div>
                          )}

                          {/* Loading indicator for operation fetch */}
                          {loading && !streaming && <SkeletonTable />}

                          {/* Data Rendering (after fetching operation) */}
                          {!streaming && schema && data !== null && (
                            <div id="response-data" className="border-t border-border pt-6">
                              <h3 className="text-lg font-semibold text-foreground mb-4">Response Data</h3>
                              <DynamicRenderer
                                data={data}
                                schema={schema.rootType}
                                path="$"
                                depth={0}
                                hideViewControls
                              />
                            </div>
                          )}
                        </>
                      }
                    />
                  )}
                </div>
              )}

              {/* Simple URL result (no query params, just data) */}
              {!parsedSpec && !error && url && !url.includes('?') && (
                <>
                  {loading && <ResultsToolbar />}
                  {loading && <SkeletonTable />}
                  {!loading && schema && data !== null && (
                    <div id="response-data">
                      <DynamicRenderer
                        data={data}
                        schema={schema.rootType}
                        path="$"
                        depth={0}
                      />
                    </div>
                  )}
                </>
              )}

              {/* Direct API URL flow (URLs with query params) */}
              {!parsedSpec && url && url.includes('?') && (() => {
                const currentUrl = url
                const baseUrl = currentUrl.split('?')[0]!
                return (
                  <LayoutContainer
                    endpoint={baseUrl}
                    parameters={
                      <ParameterForm
                        parameters={EMPTY_PARAMS}
                        rawUrl={currentUrl}
                        onSubmit={(values) => {
                          // Parse original URL to get original param keys
                          const { parameters: originalParams } = parseUrlParameters(currentUrl)
                          // Reconstruct preserving original key format (brackets etc)
                          const queryString = reconstructQueryString(values, originalParams)
                          const newUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl
                          fetchAndInfer(newUrl)
                        }}
                        loading={loading}
                        endpoint={baseUrl}
                        baseUrl={baseUrl}
                      />
                    }
                    results={
                      <>
                        {/* Applied Filter Chips */}
                        <AppliedFilters
                          filters={getValues(baseUrl)}
                          onRemove={handleFilterRemove}
                          onClearAll={handleFilterClearAll}
                        />

                        {/* Inline error — form stays usable above */}
                        {error && <ErrorDisplay error={error} onRetry={handleRetry} />}

                        {/* Loading indicator */}
                        {loading && <SkeletonTable />}

                        {/* Data rendering - show when data is present */}
                        {schema && data !== null && (
                          <div id="response-data">
                            <DynamicRenderer
                              data={data}
                              schema={schema.rootType}
                              path="$"
                              depth={0}
                              hideViewControls
                            />
                          </div>
                        )}
                      </>
                    }
                  />
                )
              })()}

              {/* Welcome Message with Feature Highlights */}
              {!loading && !error && !schema && !parsedSpec && (
                <div className="py-10">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
                    <div className="flex gap-3 p-4 rounded-lg">
                      <svg className="w-6 h-6 shrink-0 text-muted-foreground mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                      </svg>
                      <div>
                        <p className="font-medium text-foreground text-base">Explore</p>
                        <p className="text-xs text-muted-foreground">Smart UI that auto-detects prices, dates, ratings, images, and nested data structures</p>
                      </div>
                    </div>
                    <div className="flex gap-3 p-4 rounded-lg">
                      <svg className="w-6 h-6 shrink-0 text-muted-foreground mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                      <div>
                        <p className="font-medium text-foreground text-base">Chat</p>
                        <p className="text-xs text-muted-foreground">Ask questions in plain language &mdash; AI queries the API and shows results inline</p>
                      </div>
                    </div>
                    <div className="flex gap-3 p-4 rounded-lg">
                      <svg className="w-6 h-6 shrink-0 text-muted-foreground mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                      </svg>
                      <div>
                        <p className="font-medium text-foreground text-base">Share</p>
                        <p className="text-xs text-muted-foreground">Export as MCP tools for Claude Desktop, Claude Code, and other AI agents</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </AppShell>

      {/* Request Preview Modal */}
      <RequestPreview
        request={previewData}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </>
  )
}

export default App
