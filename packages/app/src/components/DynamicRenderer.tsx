import { useState, useEffect, useCallback } from 'react'
import type { TypeSignature } from '../types/schema'
import type { NavStackEntry } from '../types/navigation'
import { getComponent } from './registry/ComponentRegistry'
import { JsonFallback } from './renderers/JsonFallback'
import { useConfigStore } from '../store/configStore'
import { useAppStore } from '../store/appStore'
import { NavigationProvider } from '../contexts/NavigationContext'
import { Breadcrumb } from './navigation/Breadcrumb'
import { DrilldownModeToggle } from './navigation/DrilldownModeToggle'
import { ShareButton } from './ShareButton'
import { MCPButton } from './MCPExportDialog'
import { ChatButton } from './chat/ChatPanel'
import { ThemeToggle } from './config/ThemeToggle'
import { getDefaultTypeName } from '../services/selection'

/** Normalize indexed array paths to generic paths for cache lookup.
 *  e.g. "$[0].tags" → "$[].tags", "$[2].reviews[1]" → "$[].reviews[]" */
function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]')
}

interface DynamicRendererProps {
  data: unknown
  schema: TypeSignature
  path?: string
  depth?: number
  /** When true, suppresses Share + DrilldownModeToggle (rendered externally by LayoutContainer) */
  hideViewControls?: boolean
}

const MAX_DEPTH = 5

export function DynamicRenderer({
  data,
  schema,
  path = '$',
  depth = 0,
  hideViewControls = false,
}: DynamicRendererProps) {
  const { fieldConfigs, drilldownMode } = useConfigStore()
  const { getAnalysisCache } = useAppStore()

  // Navigation stack — only meaningful at depth=0
  const [navStack, setNavStack] = useState<NavStackEntry[]>([])

  // Reset nav stack when root data changes
  useEffect(() => {
    if (depth === 0) setNavStack([])
  }, [data, depth])

  // Clear stack when switching to dialog or panel mode
  useEffect(() => {
    if (depth === 0 && (drilldownMode === 'dialog' || drilldownMode === 'panel')) setNavStack([])
  }, [drilldownMode, depth])

  // Drill-down handler passed via context
  const handleDrillDown = useCallback(
    (item: unknown, itemSchema: TypeSignature, label: string, itemPath: string) => {
      setNavStack(prev => {
        // Prevent duplicate entries with the same path (e.g. section breadcrumb pushed twice)
        if (prev.some(entry => entry.path === itemPath)) return prev
        return [...prev, { data: item, schema: itemSchema, label, path: itemPath }]
      })
    },
    []
  )

  // Breadcrumb navigation: pop stack to index (-1 = root)
  const handleBreadcrumbNav = useCallback((index: number) => {
    if (index < 0) {
      setNavStack([])
    } else {
      setNavStack(prev => prev.slice(0, index + 1))
    }
  }, [])

  // Guard against excessive depth
  if (depth > MAX_DEPTH) {
    return (
      <JsonFallback
        data={data}
        schema={schema}
        path={path}
        depth={depth}
      />
    )
  }

  // Determine active data: if page mode with nav stack, render stack top
  const isPageMode = drilldownMode === 'page'
  const stackTop = depth === 0 && isPageMode && navStack.length > 0
    ? navStack[navStack.length - 1]
    : null
  const activeData = stackTop ? stackTop.data : data
  const activeSchema = stackTop ? stackTop.schema : schema
  const activePath = stackTop ? stackTop.path : path

  // Look up component override for the active path
  const config = fieldConfigs[activePath]
  const override = config?.componentType

  // Determine current component type with precedence: User override > Smart default > Type-based default
  let currentType: string
  if (override) {
    // User override always wins (INT-01, INT-05)
    currentType = override
  } else {
    // Try smart selection from cache (normalize indexed paths for drill-down)
    const cached = getAnalysisCache(activePath) || getAnalysisCache(normalizePath(activePath))
    if (cached?.selection && cached.selection.confidence >= 0.75) {
      // High-confidence smart default
      currentType = cached.selection.componentType
    } else {
      // Fall back to type-based default (v1.2 behavior preserved)
      currentType = getDefaultTypeName(activeSchema)
    }
  }

  // Get the appropriate component from the registry - use currentType which includes smart selection
  const Component = getComponent(activeSchema, currentType)

  const content = (
    <div>
      {/* Navigation bar: breadcrumb + view controls — only at depth=0 when data exists */}
      {depth === 0 && data != null && (hideViewControls ? (
        /* Breadcrumb only — view controls rendered externally by LayoutContainer */
        navStack.length > 0 ? (
          <div className="mb-2">
            <Breadcrumb
              rootLabel="Results"
              stack={navStack}
              onNavigate={handleBreadcrumbNav}
            />
          </div>
        ) : null
      ) : (
        <div className="flex items-center justify-between mb-2">
          {navStack.length > 0 ? (
            <Breadcrumb
              rootLabel="Results"
              stack={navStack}
              onNavigate={handleBreadcrumbNav}
            />
          ) : (
            <DrilldownModeToggle />
          )}
          <div className="flex items-center gap-2">
            <ChatButton />
            <MCPButton />
            <ShareButton />
            <ThemeToggle />
          </div>
        </div>
      ))}

      <Component
        data={activeData}
        schema={activeSchema}
        path={activePath}
        depth={depth}
        importance={(getAnalysisCache(activePath) || getAnalysisCache(normalizePath(activePath)))?.importance}
      />
    </div>
  )

  // At depth=0, wrap in NavigationProvider
  if (depth === 0) {
    return (
      <NavigationProvider value={{ drilldownMode, onDrillDown: handleDrillDown }}>
        {content}
      </NavigationProvider>
    )
  }

  return content
}
