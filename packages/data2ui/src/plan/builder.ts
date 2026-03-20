/**
 * buildUIPlan() — the main orchestrator.
 *
 * Pipeline:
 * 1. Parse input (JSON/YAML/XML → JS object)
 * 2. Analyze (schema inference, semantic detection, importance, grouping)
 * 3. Recursively build UINode tree (component selection + plugin resolution at each node)
 */
import { analyzeApiResponse } from '@api2aux/semantic-analysis'
import type { TypeSignature, SemanticMetadata, PathAnalysis } from '@api2aux/semantic-analysis'
import type { ImportanceScore } from '@api2aux/semantic-analysis'
import { parseInput } from '../parse'
import { selectComponent, selectObjectComponent, selectPrimitiveArrayComponent } from '../select'
import { detectPrimitiveMode } from '../detect/primitive'
import { NodeKind, ComponentType, SelectionReason } from '../types'
import type { UIPlan, UINode, LayoutNode, FieldNode, CollectionNode, BuildOptions } from './types'
import type { ComponentSelection, SelectionContext } from '../select/types'

/**
 * Build a complete UI plan from raw input data.
 * Stateless function — no framework dependencies, no mutation of inputs.
 */
export function buildUIPlan(
  input: string | unknown,
  options?: BuildOptions,
): UIPlan {
  // 1. Parse input
  const parseResult = parseInput(input, {
    inputFormat: options?.inputFormat,
    xmlOptions: options?.xmlOptions,
  })
  const data = parseResult.data

  // 2. Analyze
  const url = options?.url ?? ''
  let analysisResult
  try {
    analysisResult = analyzeApiResponse(data, url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Schema analysis failed: ${message}`)
  }
  const { schema, paths } = analysisResult

  // 3. Build UINode tree
  const root = buildNode(
    schema.rootType,
    data,
    '$',
    0,
    paths,
    options?.componentOverrides ?? {},
    options?.pluginRegistry ?? null,
    options?.pluginPreferences ?? {},
  )

  return {
    root,
    schema,
    inputFormat: parseResult.inputFormat,
    analysis: paths,
    generatedAt: Date.now(),
  }
}

/**
 * Recursively build a UINode from a TypeSignature and its analysis.
 */
function buildNode(
  typeSignature: TypeSignature,
  data: unknown,
  path: string,
  depth: number,
  paths: Record<string, PathAnalysis>,
  overrides: Record<string, string>,
  pluginRegistry: import('../plugins/registry').PluginRegistry | null,
  pluginPreferences: Record<string, string>,
): UINode {
  const override = overrides[path]

  // Array of objects → LayoutNode
  if (typeSignature.kind === 'array' && typeSignature.items.kind === 'object') {
    return buildArrayOfObjectsNode(typeSignature, data, path, depth, paths, overrides, override, pluginRegistry, pluginPreferences)
  }

  // Array of primitives → CollectionNode
  if (typeSignature.kind === 'array' && typeSignature.items.kind === 'primitive') {
    return buildPrimitiveArrayNode(typeSignature, data, path, paths, override)
  }

  // Object → LayoutNode
  if (typeSignature.kind === 'object') {
    return buildObjectNode(typeSignature, data, path, depth, paths, overrides, override, pluginRegistry, pluginPreferences)
  }

  // Primitive → FieldNode
  if (typeSignature.kind === 'primitive') {
    const fieldName = path.split('.').pop() ?? path
    return buildFieldNode(fieldName, path, typeSignature, data, paths, pluginRegistry, pluginPreferences)
  }

  // Fallback — unhandled schema kind (e.g., nested arrays).
  // If this triggers, it indicates a gap in the engine's coverage.
  return {
    kind: NodeKind.Layout,
    component: ComponentType.Json,
    selection: { componentType: ComponentType.Json, confidence: 0, reason: 'unhandled-schema-kind' },
    path,
    schema: typeSignature,
    children: [],
    importance: new Map(),
    semantics: new Map(),
    grouping: null,
  }
}

function buildArrayOfObjectsNode(
  schema: TypeSignature,
  _data: unknown,
  path: string,
  depth: number,
  paths: Record<string, PathAnalysis>,
  overrides: Record<string, string>,
  override: string | undefined,
  pluginRegistry: import('../plugins/registry').PluginRegistry | null,
  pluginPreferences: Record<string, string>,
): LayoutNode {
  const analysis = paths[path]
  const context: SelectionContext = {
    semantics: analysis?.semantics ?? new Map(),
    importance: analysis?.importance ?? new Map(),
  }

  let selection: ComponentSelection
  if (override) {
    selection = { componentType: override, confidence: 1, reason: SelectionReason.UserOverride }
  } else {
    selection = selectComponent(schema, context)
  }

  // Build children from object fields
  const children: UINode[] = []
  if (schema.kind === 'array' && schema.items.kind === 'object') {
    for (const [fieldName, fieldDef] of schema.items.fields.entries()) {
      const childPath = `${path}[].${fieldName}`
      const child = buildNode(fieldDef.type, undefined, childPath, depth + 1, paths, overrides, pluginRegistry, pluginPreferences)
      children.push(child)
    }
  }

  return {
    kind: NodeKind.Layout,
    component: selection.componentType,
    selection,
    path,
    schema,
    children,
    importance: analysis?.importance ?? new Map(),
    semantics: analysis?.semantics ?? new Map(),
    grouping: analysis?.grouping ?? null,
  }
}

function buildPrimitiveArrayNode(
  schema: TypeSignature,
  data: unknown,
  path: string,
  paths: Record<string, PathAnalysis>,
  override: string | undefined,
): CollectionNode {
  const analysis = paths[path]
  const context: SelectionContext = {
    semantics: analysis?.semantics ?? new Map(),
    importance: analysis?.importance ?? new Map(),
  }

  let selection: ComponentSelection
  if (override) {
    selection = { componentType: override, confidence: 1, reason: SelectionReason.UserOverride }
  } else {
    selection = selectPrimitiveArrayComponent(schema, data, context)
  }

  // Get semantic metadata for this collection path
  const semantics = analysis?.semantics.get(path) ?? null

  return {
    kind: NodeKind.Collection,
    component: selection.componentType,
    selection,
    path,
    schema,
    semantics,
  }
}

function buildObjectNode(
  schema: TypeSignature,
  data: unknown,
  path: string,
  depth: number,
  paths: Record<string, PathAnalysis>,
  overrides: Record<string, string>,
  override: string | undefined,
  pluginRegistry: import('../plugins/registry').PluginRegistry | null,
  pluginPreferences: Record<string, string>,
): LayoutNode {
  const analysis = paths[path]
  const context: SelectionContext = {
    semantics: analysis?.semantics ?? new Map(),
    importance: analysis?.importance ?? new Map(),
  }

  let selection: ComponentSelection
  if (override) {
    selection = { componentType: override, confidence: 1, reason: SelectionReason.UserOverride }
  } else {
    selection = selectObjectComponent(schema, context)
  }

  // Build children from object fields
  const children: UINode[] = []
  if (schema.kind === 'object') {
    for (const [fieldName, fieldDef] of schema.fields.entries()) {
      const childPath = path === '$' ? `$.${fieldName}` : `${path}.${fieldName}`
      const childData = data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)[fieldName]
        : undefined
      const child = buildNode(fieldDef.type, childData, childPath, depth + 1, paths, overrides, pluginRegistry, pluginPreferences)
      children.push(child)
    }
  }

  return {
    kind: NodeKind.Layout,
    component: selection.componentType,
    selection,
    path,
    schema,
    children,
    importance: analysis?.importance ?? new Map(),
    semantics: analysis?.semantics ?? new Map(),
    grouping: analysis?.grouping ?? null,
  }
}

function buildFieldNode(
  fieldName: string,
  path: string,
  schema: TypeSignature,
  value: unknown,
  paths: Record<string, PathAnalysis>,
  pluginRegistry: import('../plugins/registry').PluginRegistry | null,
  pluginPreferences: Record<string, string>,
): FieldNode {
  // Find semantics and importance from the parent path's analysis
  let semantics: SemanticMetadata | null = null
  let importance: ImportanceScore | null = null

  for (const analysis of Object.values(paths)) {
    const sem = analysis.semantics.get(path)
    if (sem) semantics = sem
    const imp = analysis.importance.get(path)
    if (imp) importance = imp
  }

  // Resolve render hint via primitive detection
  const renderHint = detectPrimitiveMode(value, fieldName)

  // Resolve plugin ID
  let pluginId: string | null = null
  if (semantics?.detectedCategory) {
    // Check user preference first
    const preferredPlugin = pluginPreferences[semantics.detectedCategory]
    if (preferredPlugin) {
      pluginId = preferredPlugin
    } else if (pluginRegistry) {
      // Check registry default
      const defaultPlugin = pluginRegistry.getDefault(semantics.detectedCategory)
      if (defaultPlugin) {
        pluginId = defaultPlugin.id
      }
    }
  }

  return {
    kind: NodeKind.Field,
    name: fieldName,
    path,
    pluginId,
    renderHint,
    schema,
    semantics,
    importance,
  }
}
