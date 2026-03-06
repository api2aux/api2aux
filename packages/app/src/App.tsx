import { useEffect, useState } from 'react'
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
import { AuthError } from './services/api/errors'
import 'react-loading-skeleton/dist/skeleton.css'

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
          <ThemeToggle />
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
  const chatOpen = useChatStore((s) => s.open)
  const { clearFieldConfigs } = useConfigStore()
  const { getValues, clearValue, clearEndpoint } = useParameterStore()
  const { fetchAndInfer, fetchOperation } = useAPIFetch()

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

  // Handle parameter form submission
  const handleParameterSubmit = (values: Record<string, string>, bodyJson?: string) => {
    if (parsedSpec && selectedOperation) {
      fetchOperation(parsedSpec.baseUrl, selectedOperation, values, bodyJson)
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
    setSelectedOperation(index)
  }

  // Determine if we should show the sidebar
  const showSidebar = parsedSpec !== null && parsedSpec.operations.length >= 2

  // Examples page route
  if (page === 'examples') {
    return (
      <>
        <ThemeApplier />
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
            className={`flex-1 overflow-y-auto py-8 px-6 transition-[padding] duration-300 ${detailPanelOpen ? 'pr-[42rem]' : ''}`}
          >
            <div>
              {/* Header */}
              <div className="text-center mb-8">
                <h1 className="text-2xl font-semibold text-foreground mb-2">
                  <button onClick={handleGoHome} className="cursor-pointer hover:opacity-70 transition-opacity">api2aux</button>
                </h1>
                <p className="text-sm text-muted-foreground">
                  Paste an API URL. See it. Chat it. Share it with agents.
                </p>
              </div>

              {/* URL Input */}
              <div className="flex justify-center mb-8">
                <URLInput authError={authError} detectedAuth={parsedSpec?.securitySchemes} />
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
                          OpenAPI {parsedSpec.specVersion}
                        </span>
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

                            {/* Loading indicator for operation fetch */}
                            {loading && <SkeletonTable />}

                            {/* Data Rendering (after fetching operation) */}
                            {schema && data !== null && (
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
        <div className={`min-h-screen bg-background text-foreground py-8 px-4 transition-[padding] duration-300 ${detailPanelOpen ? 'pr-[42rem]' : ''}`}>
          <div className={chatOpen ? 'w-full' : 'max-w-6xl mx-auto'}>
            {/* Header */}
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold text-foreground mb-2">
                <button onClick={handleGoHome} className="cursor-pointer hover:opacity-70 transition-opacity">api2aux</button>
              </h1>
              <p className="text-sm text-muted-foreground">
                Paste an API URL. See it. Chat it. Share it with agents.
              </p>
            </div>

            {/* URL Input */}
            <div className="flex justify-center mb-8">
              <URLInput authError={authError} detectedAuth={parsedSpec?.securitySchemes} />
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
                        OpenAPI {parsedSpec.specVersion}
                      </span>
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
                          onSubmit={handleParameterSubmit}
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

                          {/* Loading indicator for operation fetch */}
                          {loading && <SkeletonTable />}

                          {/* Data Rendering (after fetching operation) */}
                          {schema && data !== null && (
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
                        parameters={[]}
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
                  <p className="text-center text-xl text-muted-foreground mb-8">
                    [Agent + User] eXperience for any API
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
                    <div className="flex gap-3 p-4 rounded-lg">
                      <span className="text-2xl flex-shrink-0" aria-hidden="true">~</span>
                      <div>
                        <p className="font-medium text-foreground text-base">Smart Rendering</p>
                        <p className="text-xs text-muted-foreground">Semantic detection auto-formats prices, dates, emails, ratings, images, and more</p>
                      </div>
                    </div>
                    <div className="flex gap-3 p-4 rounded-lg">
                      <span className="text-2xl flex-shrink-0" aria-hidden="true">{'>'}_</span>
                      <div>
                        <p className="font-medium text-foreground text-base">AI Chat</p>
                        <p className="text-xs text-muted-foreground">Converse with any API in natural language &mdash; the AI reads docs and calls endpoints for you</p>
                      </div>
                    </div>
                    <div className="flex gap-3 p-4 rounded-lg">
                      <span className="text-2xl flex-shrink-0" aria-hidden="true">{'->'}</span>
                      <div>
                        <p className="font-medium text-foreground text-base">MCP Export</p>
                        <p className="text-xs text-muted-foreground">Turn any API into tools for Claude Desktop, Claude Code, and other AI agents</p>
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

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </>
  )
}

export default App
