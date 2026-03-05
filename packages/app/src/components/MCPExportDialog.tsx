import { useState, useMemo } from 'react'
import { Dialog, DialogPanel, DialogTitle, Disclosure, DisclosureButton, DisclosurePanel, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { toast } from 'sonner'
import { useAppStore } from '../store/appStore'
import { useAuthStore } from '../store/authStore'
import { parseUrlParameters } from '../services/urlParser/parser'
import { deployAsMcpServer, type DeployResult } from '../services/mcp/deploy'
import type { Credential } from '../types/auth'
import type { ParsedOperation } from '@api2aux/semantic-analysis'

type ExportFormat = 'claude-desktop' | 'claude-code' | 'cli'

interface MCPExportDialogProps {
  open: boolean
  onClose: () => void
}

function sanitizeParamName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function deriveToolName(url: string, serverName?: string): string {
  if (serverName) {
    return `fetch_${sanitizeParamName(serverName)}`
  }
  try {
    const hostname = new URL(url).hostname
    const hostParts = hostname.replace(/^(www|api)\./, '').split('.')
    if (hostParts.length > 0 && hostParts[0]) {
      return `fetch_${sanitizeParamName(hostParts[0])}`
    }
  } catch { /* fallback */ }
  return 'fetch_api'
}

function deriveServerName(url: string): string {
  return deriveToolName(url).replace('fetch_', '')
}

function operationToolName(op: ParsedOperation): string {
  if (op.operationId) {
    return op.operationId
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  }
  const pathSegments = op.path
    .replace(/\{[^}]+\}/g, 'by_id')
    .split('/')
    .filter(Boolean)
    .join('_')
  return `${op.method.toLowerCase()}_${pathSegments}`
}

function operationDescription(op: ParsedOperation): string {
  return op.summary || op.description?.split(/\.\s/)[0]?.concat('.') || `${op.method} ${op.path}`
}

function getMcpCommand(): { command: string; pkg: string } {
  if (import.meta.env.DEV) {
    return { command: 'node', pkg: 'packages/mcp-server/dist/cli.js' }
  }
  return { command: 'npx', pkg: '@api2aux/mcp-server' }
}

function buildAuthArgs(cred: Credential | null): string[] {
  if (!cred) return []
  switch (cred.type) {
    case 'bearer':
      return ['--token', cred.token]
    case 'apiKey':
      return ['--header', `${cred.headerName}: ${cred.value}`]
    case 'queryParam':
      return ['--api-key', `${cred.paramName}=${cred.value}`]
    default:
      return []
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  price: 'currency/price',
  email: 'email address',
  phone: 'phone number',
  url: 'URL',
  image_url: 'image URL',
  rating: 'rating score',
  date: 'date/time',
  name: 'name/identity',
  description: 'description',
  status: 'status indicator',
  color: 'color value',
  uuid: 'unique identifier',
  address: 'address',
  coordinates: 'coordinates',
  percentage: 'percentage',
  count: 'count/quantity',
  tags: 'tags/labels',
}

function formatCategory(category: string): string {
  return CATEGORY_LABELS[category] || category
}

/**
 * Infer a useful description from a parameter's key name.
 * Extracts the inner key (e.g. "zipcode" from "filter[zipcode]") and matches
 * against common patterns to produce agent-friendly descriptions.
 */
function inferParamDescription(originalKey: string, defaultValue: string): string {
  // Extract the innermost key name from bracket notation
  const bracketMatch = originalKey.match(/\[([^\]]+)\](?:\[([^\]]+)\])?$/)
  const leafKey = bracketMatch
    ? (bracketMatch[2] ?? bracketMatch[1] ?? originalKey)
    : originalKey
  const lower = leafKey.toLowerCase()

  const PARAM_HINTS: Array<[RegExp, string]> = [
    [/^(zip_?code|zip|postal)$/i, 'ZIP/postal code'],
    [/^lat(itude)?$/i, 'Latitude coordinate'],
    [/^(lng|lon|longitude)$/i, 'Longitude coordinate'],
    [/^(distance|radius)$/i, 'Search radius (distance)'],
    [/^(search_?term|search|query|q)$/i, 'Search text query'],
    [/^page$/i, 'Page number for pagination'],
    [/^(size|limit|per_?page|page_?size|count)$/i, 'Number of results per page'],
    [/^(sort|sort_?by|order_?by)$/i, 'Sort field or order'],
    [/^(sort_?order|order|direction)$/i, 'Sort direction (asc/desc)'],
    [/^(name|provider_?name|user_?name)$/i, 'Name to filter by'],
    [/^(insurance|insurance_?type|insurance_?types)$/i, 'Insurance type filter'],
    [/^(search_?options|options|mode)$/i, 'Search mode or options'],
    [/^(partner|partner_?site|site)_?id$/i, 'Partner/site identifier'],
    [/^(show|enable|display)_?(\w+)$/i, 'Toggle for display option'],
    [/^version$/i, 'API version'],
    [/^(offset|skip)$/i, 'Number of results to skip'],
    [/^(type|category|kind)$/i, 'Type or category filter'],
    [/^(id|_id)$/i, 'Record identifier'],
    [/^(start|from|begin)_?date$/i, 'Start date for range filter'],
    [/^(end|to)_?date$/i, 'End date for range filter'],
    [/^(language|lang|locale)$/i, 'Language or locale code'],
    [/^(country|region|state)$/i, 'Geographic region filter'],
    [/^(city|city_?name)$/i, 'City name'],
    [/^(status|state)$/i, 'Status filter'],
    [/^(fields|select|include)$/i, 'Fields to include in response'],
    [/^(format|output)$/i, 'Response format'],
  ]

  for (const [pattern, hint] of PARAM_HINTS) {
    if (pattern.test(lower)) {
      const desc = defaultValue ? `${hint} (default: "${defaultValue}")` : hint
      if (originalKey !== leafKey) {
        return `${desc} — query param "${originalKey}"`
      }
      return desc
    }
  }

  // Fallback: show the original key mapping if sanitized, otherwise just the default
  if (originalKey !== sanitizeParamName(originalKey)) {
    return `Query param "${originalKey}"${defaultValue ? ` (default: "${defaultValue}")` : ''}`
  }
  return defaultValue ? `(default: "${defaultValue}")` : ''
}

/**
 * Collect semantic response fields from ALL analysis cache paths,
 * not just top-level. Walks nested array paths to find fields in
 * deeply nested structures.
 */
function getResponseFieldDescriptions(
  analysisCache: Map<string, { semantics: Map<string, { detectedCategory?: string; level?: string }> }>
): Array<{ name: string; category: string }> {
  const fields: Array<{ name: string; category: string }> = []
  const seen = new Set<string>()

  // Sort paths by depth (shallower first) so top-level fields take priority
  const sortedPaths = [...analysisCache.entries()].sort(
    (a, b) => a[0].split('.').length - b[0].split('.').length
  )

  for (const [, entry] of sortedPaths) {
    for (const [fieldPath, metadata] of entry.semantics) {
      if (metadata.detectedCategory && (metadata.level === 'high' || metadata.level === 'medium')) {
        const fieldName = fieldPath.split('.').pop() || fieldPath
        if (seen.has(fieldName)) continue
        seen.add(fieldName)
        fields.push({ name: fieldName, category: formatCategory(metadata.detectedCategory) })
      }
    }
  }

  return fields.slice(0, 16)
}

function generateExportConfig(format: ExportFormat, apiUrl: string, name: string, authArgs: string[]): string {
  const { command, pkg } = getMcpCommand()
  const allArgs = [pkg, '--api', apiUrl, '--name', name, ...authArgs]

  if (format === 'cli') {
    return `${command} ${pkg} --api "${apiUrl}" --name ${name}${authArgs.length ? ' ' + authArgs.join(' ') : ''}`
  }

  const config = {
    [name]: {
      command,
      args: allArgs,
    },
  }

  return JSON.stringify(config, null, 2)
}

function getInstructions(format: ExportFormat): string {
  switch (format) {
    case 'claude-desktop':
      return 'Add to "mcpServers" in ~/Library/Application Support/Claude/claude_desktop_config.json, then restart Claude Desktop.'
    case 'claude-code':
      return 'Add to "mcpServers" in ~/.claude.json or your project .claude/settings.json.'
    case 'cli':
      return 'Run this command to start the MCP server directly.'
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export function MCPExportDialog({ open, onClose }: MCPExportDialogProps) {
  const url = useAppStore((s) => s.url)
  const data = useAppStore((s) => s.data)
  const parsedSpec = useAppStore((s) => s.parsedSpec)
  const analysisCache = useAppStore((s) => s.analysisCache)
  const [format, setFormat] = useState<ExportFormat>('claude-desktop')
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)

  const toolInfo = useMemo(() => {
    if (!url) return null

    const toolName = deriveToolName(url)
    const { parameters } = parseUrlParameters(url)

    let baseUrl = url
    try {
      const parsed = new URL(url)
      baseUrl = `${parsed.origin}${parsed.pathname}`
    } catch { /* keep original */ }

    const toolParams = [
      { name: 'path', type: 'string', description: 'Additional path segment to append (e.g., "/users/1")' },
      ...parameters.map(p => ({
        name: p.originalKey !== sanitizeParamName(p.originalKey) ? sanitizeParamName(p.originalKey) : p.originalKey,
        type: p.isArray ? 'array' : 'string',
        description: inferParamDescription(p.originalKey, String(p.schema.default ?? '')),
      })),
      { name: 'debug', type: 'boolean', description: 'Show request URL, headers, and timing' },
      { name: 'full_response', type: 'boolean', description: 'Disable truncation, return full response' },
    ]

    const responseFields = getResponseFieldDescriptions(analysisCache as Map<string, { semantics: Map<string, { detectedCategory?: string; level?: string }> }>)

    const paramCount = parameters.length
    let description = paramCount > 0
      ? `Fetch data from ${baseUrl} with ${paramCount} configurable query parameters. Each parameter has a default value that can be overridden.`
      : `Fetch data from ${url}. Optionally append a path.`

    if (responseFields.length > 0) {
      const fieldStr = responseFields.map(f => `${f.name} (${f.category})`).join(', ')
      description = `${description.replace(/\.$/, '')}. Returns: ${fieldStr}`
    }

    const authStore = useAuthStore.getState()
    const cred = authStore.getActiveCredential(url)
    const authArgs = buildAuthArgs(cred)
    const serverName = deriveServerName(url)

    return {
      toolName,
      description,
      params: toolParams,
      responseFields,
      serverName,
      cred,
      authArgs,
      hasData: data !== null && data !== undefined,
    }
  }, [url, data, analysisCache])

  if (!url || !toolInfo) return null

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.info(label, { description: text, duration: 10000 })
    }
  }

  const exportConfigText = generateExportConfig(format, url, toolInfo.serverName, toolInfo.authArgs)
  const instructions = getInstructions(format)

  const handleDeploy = async () => {
    if (!parsedSpec) return
    setDeploying(true)
    setDeployError(null)
    try {
      const authStore = useAuthStore.getState()
      const cred = authStore.getActiveCredential(url)
      const authType = cred
        ? cred.type === 'bearer' ? 'bearer' as const
        : cred.type === 'apiKey' ? 'header' as const
        : cred.type === 'queryParam' ? 'apikey' as const
        : 'none' as const
        : 'none' as const
      const result = await deployAsMcpServer({
        apiUrl: parsedSpec.baseUrl,
        baseUrl: parsedSpec.baseUrl,
        name: toolInfo.serverName,
        authType,
        authParamName: cred?.type === 'apiKey' ? cred.headerName : cred?.type === 'queryParam' ? cred.paramName : undefined,
        operations: parsedSpec.operations,
      })
      setDeployResult(result)
      toast.success('Deployed as MCP server')
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Deployment failed')
      toast.error('Deployment failed')
    } finally {
      setDeploying(false)
    }
  }

  const formats: Array<{ value: ExportFormat; label: string }> = [
    { value: 'claude-desktop', label: 'Claude Desktop' },
    { value: 'claude-code', label: 'Claude Code' },
    { value: 'cli', label: 'CLI' },
  ]

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      <div className="fixed inset-0 flex items-start justify-center pt-[10vh] px-4 pb-4">
        <DialogPanel className="max-w-3xl w-full bg-background rounded-xl shadow-2xl border border-border flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
            <DialogTitle className="text-lg font-semibold">
              MCP Tools
            </DialogTitle>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <TabGroup className="flex flex-col min-h-0 flex-1">
            <TabList className="flex gap-1 px-6 border-b border-border shrink-0">
              <Tab className="px-3 py-2 text-sm font-medium text-muted-foreground data-selected:text-foreground data-selected:border-b-2 data-selected:border-primary -mb-px outline-none transition-colors hover:text-foreground">
                Preview
              </Tab>
              <Tab className="px-3 py-2 text-sm font-medium text-muted-foreground data-selected:text-foreground data-selected:border-b-2 data-selected:border-primary -mb-px outline-none transition-colors hover:text-foreground">
                Export
              </Tab>
              <Tab className="px-3 py-2 text-sm font-medium text-muted-foreground data-selected:text-foreground data-selected:border-b-2 data-selected:border-primary -mb-px outline-none transition-colors hover:text-foreground">
                Hosted
              </Tab>
            </TabList>

            <TabPanels className="flex-1 overflow-y-auto min-h-0">
              {/* Preview Tab */}
              <TabPanel className="px-6 py-4 space-y-5">
                {parsedSpec && parsedSpec.operations.length > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {parsedSpec.operations.length} tools generated from {parsedSpec.title}
                    </p>
                    {/* Group by tag */}
                    {(() => {
                      const grouped = new Map<string, ParsedOperation[]>()
                      for (const op of parsedSpec.operations) {
                        const tag = op.tags[0] || 'other'
                        if (!grouped.has(tag)) grouped.set(tag, [])
                        grouped.get(tag)!.push(op)
                      }
                      return [...grouped.entries()].map(([tag, ops]) => (
                        <Disclosure key={tag} defaultOpen={grouped.size <= 3}>
                          <DisclosureButton className="flex items-center justify-between w-full text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                            {({ open: isOpen }) => (
                              <>
                                {tag} ({ops.length})
                                <ChevronIcon open={isOpen} />
                              </>
                            )}
                          </DisclosureButton>
                          <DisclosurePanel className="mt-2 space-y-0.5">
                            {ops.map((op) => (
                              <Disclosure key={`${op.method}-${op.path}`}>
                                {({ open: opOpen }) => (
                                  <>
                                    <DisclosureButton className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-muted/30 text-xs w-full text-left">
                                      <span className={`shrink-0 font-mono font-bold w-10 ${
                                        op.method === 'GET' ? 'text-green-500'
                                          : op.method === 'POST' ? 'text-blue-500'
                                          : op.method === 'PUT' ? 'text-amber-500'
                                          : 'text-purple-500'
                                      }`}>
                                        {op.method}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <code className="font-mono text-foreground">{operationToolName(op)}</code>
                                          {(op.parameters.length > 0 || op.requestBody) && (
                                            <ChevronIcon open={opOpen} />
                                          )}
                                        </div>
                                        <p className="text-muted-foreground mt-0.5">{operationDescription(op)}</p>
                                      </div>
                                    </DisclosureButton>
                                    {(op.parameters.length > 0 || op.requestBody) && (
                                      <DisclosurePanel className="ml-12 mr-3 mb-2">
                                        <div className="border border-border rounded-lg overflow-hidden">
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="bg-muted/50 text-muted-foreground">
                                                <th className="text-left px-2 py-1.5 font-medium">Name</th>
                                                <th className="text-left px-2 py-1.5 font-medium w-14">Type</th>
                                                <th className="text-left px-2 py-1.5 font-medium w-10">In</th>
                                                <th className="text-left px-2 py-1.5 font-medium">Description</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {op.parameters.map((p) => (
                                                <tr key={p.name} className="border-t border-border">
                                                  <td className="px-2 py-1.5">
                                                    <code className="font-mono text-foreground">{p.name}</code>
                                                    {p.required && <span className="text-red-400 ml-0.5">*</span>}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-muted-foreground/70">{p.schema.type}</td>
                                                  <td className="px-2 py-1.5 text-muted-foreground/50">{p.in}</td>
                                                  <td className="px-2 py-1.5 text-muted-foreground">
                                                    {p.description}
                                                    {p.schema.enum && (
                                                      <span className="ml-1 text-muted-foreground/50">
                                                        [{p.schema.enum.map(String).join(', ')}]
                                                      </span>
                                                    )}
                                                    {p.schema.default !== undefined && (
                                                      <span className="ml-1 text-muted-foreground/50">
                                                        default: {String(p.schema.default)}
                                                      </span>
                                                    )}
                                                  </td>
                                                </tr>
                                              ))}
                                              {op.requestBody && (
                                                <tr className="border-t border-border">
                                                  <td className="px-2 py-1.5">
                                                    <code className="font-mono text-foreground">body</code>
                                                    {op.requestBody.required && <span className="text-red-400 ml-0.5">*</span>}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-muted-foreground/70">JSON</td>
                                                  <td className="px-2 py-1.5 text-muted-foreground/50">body</td>
                                                  <td className="px-2 py-1.5 text-muted-foreground">
                                                    {op.requestBody.description || 'Request body'}
                                                  </td>
                                                </tr>
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </DisclosurePanel>
                                    )}
                                  </>
                                )}
                              </Disclosure>
                            ))}
                          </DisclosurePanel>
                        </Disclosure>
                      ))
                    })()}
                  </>
                ) : (
                  <>
                    {/* Fallback: single fetch tool for raw URLs */}
                    <section>
                      <div className="flex items-center gap-2 mb-2">
                        <code className="text-sm font-mono font-semibold text-foreground bg-muted px-2 py-0.5 rounded">
                          {toolInfo.toolName}
                        </code>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {toolInfo.description}
                      </p>
                    </section>

                    <Disclosure defaultOpen>
                      <DisclosureButton className="flex items-center justify-between w-full text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        {({ open: isOpen }) => (
                          <>
                            Parameters ({toolInfo.params.length})
                            <ChevronIcon open={isOpen} />
                          </>
                        )}
                      </DisclosureButton>
                      <DisclosurePanel className="mt-2">
                        <div className="border border-border rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-muted/50 text-muted-foreground">
                                <th className="text-left px-3 py-2 font-medium">Name</th>
                                <th className="text-left px-3 py-2 font-medium w-16">Type</th>
                                <th className="text-left px-3 py-2 font-medium">Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {toolInfo.params.map((param) => (
                                <tr key={param.name} className="border-t border-border hover:bg-muted/30">
                                  <td className="px-3 py-2">
                                    <code className="font-mono text-foreground">{param.name}</code>
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground/70">{param.type}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{param.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </DisclosurePanel>
                    </Disclosure>

                    {toolInfo.responseFields.length > 0 && (
                      <Disclosure defaultOpen>
                        <DisclosureButton className="flex items-center justify-between w-full text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                          {({ open: isOpen }) => (
                            <>
                              Response Fields ({toolInfo.responseFields.length})
                              <ChevronIcon open={isOpen} />
                            </>
                          )}
                        </DisclosureButton>
                        <DisclosurePanel className="mt-2 flex flex-wrap gap-2">
                          {toolInfo.responseFields.map((field) => (
                            <div
                              key={field.name}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs"
                            >
                              <code className="font-mono text-foreground">{field.name}</code>
                              <span className="text-muted-foreground/70">{field.category}</span>
                            </div>
                          ))}
                        </DisclosurePanel>
                      </Disclosure>
                    )}

                    {!toolInfo.hasData && (
                      <p className="text-xs text-muted-foreground italic">
                        Fetch the API to see response field semantics.
                      </p>
                    )}
                  </>
                )}
              </TabPanel>

              {/* Export Tab */}
              <TabPanel className="px-6 py-4 flex flex-col gap-4 h-full">
                <p className="text-sm text-muted-foreground shrink-0">
                  Use this API as MCP tools in your AI assistant.
                </p>

                {/* Format selector */}
                <div className="inline-flex border border-border rounded-lg text-xs shrink-0" role="group">
                  {formats.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setFormat(value)}
                      className={`px-3 py-1.5 transition-colors ${
                        format === value
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted'
                      } ${value === 'claude-desktop' ? 'rounded-l-lg' : ''} ${
                        value === 'cli' ? 'rounded-r-lg' : ''
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Config display */}
                <div className="relative flex-1 min-h-0">
                  <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto h-full overflow-y-auto whitespace-pre-wrap break-all">
                    {exportConfigText}
                  </pre>
                  <button
                    onClick={() => handleCopy(exportConfigText, 'Config')}
                    className="absolute top-2 right-2 px-2 py-1 text-xs bg-background border border-border rounded hover:bg-muted transition-colors"
                    title="Copy to clipboard"
                  >
                    Copy
                  </button>
                </div>

                {/* Instructions */}
                <p className="text-xs text-muted-foreground shrink-0">
                  {instructions}
                </p>

                {/* Auth warning */}
                {toolInfo.cred && (
                  <p className="text-xs text-amber-500 shrink-0">
                    This config includes your API credentials. Keep it private.
                  </p>
                )}
              </TabPanel>

              {/* Hosted Tab */}
              <TabPanel className="px-6 py-4 flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Deploy this API as a hosted MCP server. External clients connect via Streamable HTTP — no local install needed.
                </p>

                {!parsedSpec ? (
                  <p className="text-sm text-muted-foreground italic">
                    This API needs an OpenAPI spec to deploy as hosted MCP. Raw URL APIs are not yet supported.
                  </p>
                ) : !deployResult ? (
                  <div className="space-y-3">
                    <button
                      onClick={handleDeploy}
                      disabled={deploying}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {deploying ? 'Deploying...' : 'Deploy as MCP Server'}
                    </button>
                    {deployError && (
                      <p className="text-sm text-red-500">{deployError}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                      <p className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">Deployed successfully</p>
                      <p className="text-xs text-muted-foreground">Expires: {new Date(deployResult.expiresAt).toLocaleDateString()}</p>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MCP URL</label>
                      <div className="flex gap-2 mt-1">
                        <code className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono break-all">
                          {deployResult.mcpUrl}
                        </code>
                        <button
                          onClick={() => handleCopy(deployResult.mcpUrl, 'MCP URL')}
                          className="px-3 py-2 text-xs bg-background border border-border rounded-lg hover:bg-muted transition-colors shrink-0"
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Connect from</p>

                      <div className="bg-muted rounded-lg p-3 space-y-2">
                        <p className="text-xs font-medium text-foreground">Claude Code</p>
                        <code className="block text-xs font-mono text-muted-foreground break-all">
                          claude mcp add --transport http {toolInfo.serverName} {deployResult.mcpUrl}
                        </code>
                        <button
                          onClick={() => handleCopy(`claude mcp add --transport http ${toolInfo.serverName} ${deployResult.mcpUrl}`, 'Claude Code command')}
                          className="text-xs text-primary hover:underline"
                        >
                          Copy command
                        </button>
                      </div>

                      <div className="bg-muted rounded-lg p-3 space-y-2">
                        <p className="text-xs font-medium text-foreground">Claude Desktop / Cursor</p>
                        <pre className="text-xs font-mono text-muted-foreground break-all whitespace-pre-wrap">
{JSON.stringify({ [toolInfo.serverName]: { url: deployResult.mcpUrl } }, null, 2)}
                        </pre>
                        <button
                          onClick={() => handleCopy(JSON.stringify({ [toolInfo.serverName]: { url: deployResult.mcpUrl } }, null, 2), 'Config')}
                          className="text-xs text-primary hover:underline"
                        >
                          Copy config
                        </button>
                      </div>
                    </div>

                    {toolInfo.cred && (
                      <p className="text-xs text-amber-500">
                        This API requires authentication. Pass your API key as a header when connecting:
                        <code className="block mt-1 bg-muted px-2 py-1 rounded text-foreground">
                          --header &quot;X-Forwarded-Api-Key: YOUR_KEY&quot;
                        </code>
                      </p>
                    )}
                  </div>
                )}
              </TabPanel>
            </TabPanels>
          </TabGroup>

          {/* Footer */}
          <div className="border-t border-border px-6 py-3 shrink-0 mt-auto">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors text-sm"
            >
              Done
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

/**
 * MCP button for the toolbar — matches ShareButton styling.
 */
export function MCPButton() {
  const [open, setOpen] = useState(false)
  const url = useAppStore((s) => s.url)

  if (!url) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus-visible:ring-ring/50 focus:ring-offset-1"
        title="MCP Tools"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12 20.5h.01"
          />
        </svg>
        MCP Tools
      </button>
      <MCPExportDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
