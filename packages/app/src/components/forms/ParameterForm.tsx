import { useState, useMemo, useEffect, useRef } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import type { Parameter, RequestBody } from '@api2aux/semantic-analysis'

/** Parameter with optional URL-parsing enrichments for form rendering */
type FormParameter = Parameter & { inferredType?: string; isArray?: boolean; values?: string[] }
import { ParameterInput } from './ParameterInput'
import { ParameterGroup } from './ParameterGroup'
import { URLPreview } from './URLPreview'
import { RequestBodyEditor } from './RequestBodyEditor'
import { parseUrlParameters } from '../../services/urlParser/parser'
import { inferParameterType } from '../../services/urlParser/typeInferrer'
import { extractGroupPrefix } from '../../services/urlParser/groupUtils'
import { useParameterStore } from '../../store/parameterStore'
import { useDebouncedPersist } from '../../hooks/useDebouncedPersist'

interface ParameterFormProps {
  parameters: FormParameter[]
  requestBody?: RequestBody
  onSubmit: (values: Record<string, string>, bodyJson?: string) => void
  onPreview?: (values: Record<string, string>, bodyJson?: string) => void
  submitLabel?: string
  loading?: boolean
  endpoint?: string           // For persistence key
  rawUrl?: string             // Raw URL to parse (alternative to parameters)
  baseUrl?: string            // For URL preview construction
}

/**
 * Get default values from parameter schema defaults/examples.
 */
function getDefaultValues(params: FormParameter[]): Record<string, string> {
  const initial: Record<string, string> = {}
  for (const param of params) {
    if (param.schema.default !== undefined) {
      initial[param.name] = String(param.schema.default)
    } else if (param.schema.example !== undefined) {
      initial[param.name] = String(param.schema.example)
    } else {
      initial[param.name] = ''
    }
  }
  return initial
}

export function ParameterForm({
  parameters,
  requestBody,
  onSubmit,
  onPreview,
  submitLabel,
  loading = false,
  endpoint,
  rawUrl,
  baseUrl,
}: ParameterFormProps) {
  // Store operations
  const { getValues, clearValue, clearEndpoint, getTypeOverride, setTypeOverride } = useParameterStore()

  // Reactively subscribe to store values for this endpoint (detects external removals)
  const storeEndpointValues = useParameterStore(
    (state) => state.values[endpoint ?? '']
  )
  const prevStoreValuesRef = useRef<Record<string, string> | undefined>(storeEndpointValues)

  // Parse URL if provided, otherwise use parameters prop
  const { effectiveParams, warnings } = useMemo(() => {
    if (rawUrl) {
      const parsed = parseUrlParameters(rawUrl)
      // Convert ParsedUrlParameter to FormParameter (compatible types)
      return {
        effectiveParams: parsed.parameters as FormParameter[],
        warnings: parsed.warnings,
      }
    }
    return { effectiveParams: parameters, warnings: [] as string[] }
  }, [rawUrl, parameters])

  // Load persisted values
  const persistedValues = endpoint ? getValues(endpoint) : {}

  // Initialize state with defaults merged with persisted values
  // For Direct API URLs (rawUrl provided), URL values take precedence over persisted
  // For OpenAPI endpoints, persisted values take precedence (user's previous inputs)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults = getDefaultValues(effectiveParams)
    if (rawUrl) {
      // Direct API URL: URL values override persisted (URL is source of truth)
      return { ...persistedValues, ...defaults }
    }
    // OpenAPI endpoint: persisted values override defaults
    return { ...defaults, ...persistedValues }
  })

  // Re-initialize values when effectiveParams changes (e.g., new URL pasted)
  useEffect(() => {
    setValues((prevValues) => {
      const defaults = getDefaultValues(effectiveParams)
      const userEnteredValues = Object.fromEntries(
        Object.entries(prevValues).filter(([key]) =>
          effectiveParams.some((p) => p.name === key)
        )
      )

      if (rawUrl) {
        // Direct API URL: URL values are source of truth, override everything
        // Only keep user-entered values for params that DON'T have URL values
        return {
          ...persistedValues,
          ...userEnteredValues,
          ...defaults,  // URL values override last
        }
      }
      // OpenAPI endpoint: persisted/user values take precedence
      return {
        ...defaults,
        ...persistedValues,
        ...userEnteredValues,
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveParams])

  // Sync local state when values are externally removed from the store
  // (e.g., when AppliedFilters chip X button triggers clearValue in App.tsx)
  useEffect(() => {
    if (!endpoint) return
    const prevStore = prevStoreValuesRef.current ?? {}
    const currentStore = storeEndpointValues ?? {}

    const removedKeys = Object.keys(prevStore).filter(key => !(key in currentStore))

    if (removedKeys.length > 0) {
      setValues(prev => {
        const next = { ...prev }
        for (const key of removedKeys) {
          delete next[key]
        }
        return next
      })
    }

    prevStoreValuesRef.current = currentStore
  }, [storeEndpointValues, endpoint])

  // Auto-save with debounce when endpoint is provided
  useDebouncedPersist(endpoint ?? '', values)

  // Track version of quick values for debounce trigger
  const [quickValuesVersion, setQuickValuesVersion] = useState(0)

  // Request body state
  const [bodyRawJson, setBodyRawJson] = useState('')
  const [bodyFormValues, setBodyFormValues] = useState<Record<string, string>>(() => {
    if (!requestBody?.schema.properties) return {}
    const initial: Record<string, string> = {}
    for (const [name, prop] of Object.entries(requestBody.schema.properties)) {
      if (prop.default !== undefined) initial[name] = String(prop.default)
      else if (prop.example !== undefined) initial[name] = String(prop.example)
      else initial[name] = ''
    }
    return initial
  })
  const [useRawBody, setUseRawBody] = useState(() => {
    // Default to raw mode for non-object schemas or schemas with nested properties
    if (!requestBody) return false
    if (requestBody.schema.type !== 'object' || !requestBody.schema.properties) return true
    return Object.values(requestBody.schema.properties).some(p => p.nested)
  })

  // Build body JSON string from current mode
  const getBodyJson = (): string | undefined => {
    if (!requestBody) return undefined
    if (useRawBody) return bodyRawJson || undefined
    // Serialize form values to JSON
    const obj: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(bodyFormValues)) {
      if (!val && !requestBody.schema.required?.includes(key)) continue
      const prop = requestBody.schema.properties?.[key]
      if (prop?.type === 'integer' || prop?.type === 'number') {
        const num = Number(val)
        if (!isNaN(num)) { obj[key] = num; continue }
      }
      if (prop?.type === 'boolean') { obj[key] = val === 'true'; continue }
      obj[key] = val
    }
    return Object.keys(obj).length > 0 ? JSON.stringify(obj) : undefined
  }

  // Convert request body properties to FormParameter for reuse with ParameterInput
  const bodyParams: FormParameter[] = useMemo(() => {
    if (!requestBody?.schema.properties || useRawBody) return []
    return Object.entries(requestBody.schema.properties)
      .filter(([, prop]) => !prop.nested)
      .map(([name, prop]) => ({
        name,
        in: 'query' as const,
        required: requestBody.schema.required?.includes(name) ?? false,
        description: prop.description ?? '',
        schema: {
          type: prop.type,
          format: prop.format,
          enum: prop.enum,
          default: prop.default,
          example: prop.example,
        },
      }))
  }, [requestBody, useRawBody])

  // Apply type inference to all params
  const paramsWithTypes = useMemo(() => {
    return effectiveParams.map((param) => ({
      ...param,
      inferredType:
        param.inferredType ?? inferParameterType(param.name, values[param.name]).type,
    }))
  }, [effectiveParams, values])

  // Extract groups from parameters
  const { grouped, ungrouped } = useMemo(() => {
    const groups = new Map<string, FormParameter[]>()
    const ungroupedList: FormParameter[] = []

    for (const param of paramsWithTypes) {
      if (!param.name) { ungroupedList.push(param); continue }
      const prefix = extractGroupPrefix(param.name)
      if (prefix) {
        if (!groups.has(prefix)) groups.set(prefix, [])
        groups.get(prefix)!.push(param)
      } else {
        ungroupedList.push(param)
      }
    }

    return { grouped: groups, ungrouped: ungroupedList }
  }, [paramsWithTypes])

  // Filter to show only query and path parameters
  const visibleUngrouped = ungrouped.filter(
    (p) => p.in === 'query' || p.in === 'path'
  )

  // Split ungrouped into required and optional
  const ungroupedRequired = visibleUngrouped.filter((p) => p.required)
  const ungroupedOptional = visibleUngrouped.filter((p) => !p.required)

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  // Handler for quick value changes (selects, checkboxes, etc.) - triggers debounced fetch
  const handleQuickChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setQuickValuesVersion((v) => v + 1)  // Trigger debounced fetch
  }

  const handleClear = (name: string) => {
    setValues((prev) => {
      const { [name]: _, ...rest } = prev
      return { ...rest, [name]: '' }
    })
    if (endpoint) {
      clearValue(endpoint, name)
    }
  }

  const handleResetAll = () => {
    setValues(getDefaultValues(effectiveParams))
    if (endpoint) {
      clearEndpoint(endpoint)
    }
  }

  const handleTypeOverride = (name: string, type: string) => {
    if (endpoint) {
      setTypeOverride(endpoint, name, type)
    }
  }

  // Auto-fetch on quick value changes (debounced 300ms)
  useEffect(() => {
    if (quickValuesVersion === 0) return  // Skip initial render

    const timer = setTimeout(() => {
      const nonEmpty = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== '')
      )
      onSubmit(nonEmpty, getBodyJson())
    }, 300)

    return () => clearTimeout(timer)
  }, [quickValuesVersion])  // Only trigger on version bump, not on values change

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Filter out empty values so they don't become empty query params (e.g., limit=)
    const nonEmpty = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== '')
    )
    onSubmit(nonEmpty, getBodyJson())
  }

  // Check if there are any values to reset
  const hasValues = Object.values(values).some((v) => v !== '')

  // Construct preview URL from current values
  const constructPreviewUrl = () => {
    if (!baseUrl && !endpoint) return ''

    const base = baseUrl ?? endpoint ?? ''
    const params = new URLSearchParams()

    for (const [key, value] of Object.entries(values)) {
      if (value) {
        params.set(key, value)
      }
    }

    const queryString = params.toString()
    return queryString ? `${base}?${queryString}` : base
  }

  const previewUrl = constructPreviewUrl()

  // If no visible parameters, no groups, and no request body, just show submit button
  if (visibleUngrouped.length === 0 && grouped.size === 0 && !requestBody) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2">
          {onPreview && (
            <button
              type="button"
              onClick={() => onPreview(values, getBodyJson())}
              className="px-4 py-2 border border-border text-muted-foreground rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
            >
              Preview
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {loading && (
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {loading ? 'Fetching...' : (submitLabel ?? 'Fetch Data')}
          </button>
        </div>

        {/* URL Preview */}
        {previewUrl && (
          <URLPreview url={previewUrl} />
        )}
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Parse warnings (if any) */}
      {warnings.length > 0 && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-yellow-800">
              {warnings.map((warning, idx) => (
                <p key={idx}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Ungrouped Required Parameters */}
      {ungroupedRequired.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Required Parameters</h3>
          <div className="space-y-3">
            {ungroupedRequired.map((param) => (
              <ParameterInput
                key={param.name}
                parameter={param}
                value={values[param.name] ?? ''}
                onChange={(value) => {
                  // Check if this is a "quick" input type (enum select or boolean)
                  if (param.schema.enum || param.schema.type === 'boolean') {
                    handleQuickChange(param.name, value)
                  } else {
                    handleChange(param.name, value)  // Manual - needs Apply
                  }
                }}
                inferredType={param.inferredType}
                typeOverride={endpoint ? getTypeOverride(endpoint, param.name) : undefined}
                onTypeOverride={endpoint ? (t) => handleTypeOverride(param.name, t) : undefined}
                onClear={() => handleClear(param.name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Ungrouped Optional Parameters (Collapsible) */}
      {ungroupedOptional.length > 0 && (
        <Disclosure>
          {({ open }) => (
            <>
              <DisclosureButton className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground">
                <svg
                  className={`h-5 w-5 transition-transform ${open ? 'rotate-90' : ''}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>
                  {ungroupedOptional.length} Optional Parameter{ungroupedOptional.length !== 1 ? 's' : ''}
                </span>
              </DisclosureButton>
              <DisclosurePanel className="mt-3 space-y-3">
                {ungroupedOptional.map((param) => (
                  <ParameterInput
                    key={param.name}
                    parameter={param}
                    value={values[param.name] ?? ''}
                    onChange={(value) => {
                      // Check if this is a "quick" input type (enum select or boolean)
                      if (param.schema.enum || param.schema.type === 'boolean') {
                        handleQuickChange(param.name, value)
                      } else {
                        handleChange(param.name, value)  // Manual - needs Apply
                      }
                    }}
                    inferredType={param.inferredType}
                    typeOverride={endpoint ? getTypeOverride(endpoint, param.name) : undefined}
                    onTypeOverride={endpoint ? (t) => handleTypeOverride(param.name, t) : undefined}
                    onClear={() => handleClear(param.name)}
                  />
                ))}
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}

      {/* Grouped Parameters in Accordions */}
      {grouped.size > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Parameter Groups</h3>
          {Array.from(grouped.entries()).map(([groupName, groupParams]) => (
            <ParameterGroup key={groupName} groupName={groupName}>
              {groupParams.map((param) => (
                <ParameterInput
                  key={param.name}
                  parameter={param}
                  value={values[param.name] ?? ''}
                  onChange={(value) => {
                    // Check if this is a "quick" input type (enum select or boolean)
                    if (param.schema.enum || param.schema.type === 'boolean') {
                      handleQuickChange(param.name, value)
                    } else {
                      handleChange(param.name, value)  // Manual - needs Apply
                    }
                  }}
                  inferredType={param.inferredType}
                  typeOverride={endpoint ? getTypeOverride(endpoint, param.name) : undefined}
                  onTypeOverride={endpoint ? (t) => handleTypeOverride(param.name, t) : undefined}
                  onClear={() => handleClear(param.name)}
                />
              ))}
            </ParameterGroup>
          ))}
        </div>
      )}

      {/* Request Body Section */}
      {requestBody && (
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Request Body
              {requestBody.required && <span className="text-red-500 ml-1">*</span>}
            </h3>
            {requestBody.schema.type === 'object' && requestBody.schema.properties && (
              <button
                type="button"
                onClick={() => setUseRawBody(!useRawBody)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {useRawBody ? 'Form mode' : 'Raw JSON'}
              </button>
            )}
          </div>
          {requestBody.description && (
            <p className="text-xs text-muted-foreground mb-3">{requestBody.description}</p>
          )}
          {useRawBody ? (
            <RequestBodyEditor
              value={bodyRawJson}
              onChange={setBodyRawJson}
            />
          ) : (
            <div className="space-y-3">
              {bodyParams.map((param) => (
                <ParameterInput
                  key={param.name}
                  parameter={param}
                  value={bodyFormValues[param.name] ?? ''}
                  onChange={(value) => setBodyFormValues(prev => ({ ...prev, [param.name]: value }))}
                  onClear={() => setBodyFormValues(prev => ({ ...prev, [param.name]: '' }))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        {/* Reset all button (only when endpoint is provided and has values) */}
        {endpoint && hasValues && (
          <button
            type="button"
            onClick={handleResetAll}
            className="px-4 py-2 border border-border text-muted-foreground rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
          >
            Reset All
          </button>
        )}

        {/* Preview Button */}
        {onPreview && (
          <button
            type="button"
            onClick={() => onPreview(values, getBodyJson())}
            className="px-4 py-2 border border-border text-muted-foreground rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
          >
            Preview
          </button>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {loading && (
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          )}
          {loading ? 'Fetching...' : (submitLabel ?? 'Fetch Data')}
        </button>
      </div>

      {/* URL Preview */}
      {previewUrl && (
        <URLPreview url={previewUrl} />
      )}
    </form>
  )
}
