/**
 * Generates GraphQL query strings from introspection type information.
 * Produces depth-limited selection sets that cover scalar fields and nested objects.
 */

import { TypeKind } from './introspection'
import type { IntrospectionField, IntrospectionInputValue, IntrospectionType, IntrospectionTypeRef } from './introspection'

const DEFAULT_MAX_DEPTH = 2

/**
 * Format a GraphQL type reference as a human-readable string.
 *
 * @example
 * formatTypeRef({ kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'String', ofType: null } })
 * // => 'String!'
 */
export function formatTypeRef(ref: IntrospectionTypeRef): string {
  if (ref.kind === TypeKind.NON_NULL) {
    return ref.ofType ? `${formatTypeRef(ref.ofType)}!` : 'unknown!'
  }
  if (ref.kind === TypeKind.LIST) {
    return ref.ofType ? `[${formatTypeRef(ref.ofType)}]` : '[unknown]'
  }
  return ref.name ?? 'unknown'
}

/**
 * Unwrap NON_NULL and LIST wrappers to find the base (named) type.
 */
export function unwrapType(ref: IntrospectionTypeRef): IntrospectionTypeRef {
  let current = ref
  while ((current.kind === TypeKind.NON_NULL || current.kind === TypeKind.LIST) && current.ofType) {
    current = current.ofType
  }
  return current
}

/**
 * Check if a type reference is non-null (required).
 */
export function isNonNull(ref: IntrospectionTypeRef): boolean {
  return ref.kind === TypeKind.NON_NULL
}

/**
 * Build a GraphQL query/mutation string from introspection field data.
 *
 * @param operationType - 'query' or 'mutation'
 * @param field - The root field from the Query/Mutation type
 * @param typeMap - Map of type names to their introspection definitions
 * @param maxDepth - Maximum depth for nested field selection (default: 2)
 * @returns A complete GraphQL query string
 */
export function buildQueryString(
  operationType: 'query' | 'mutation',
  field: IntrospectionField,
  typeMap: Map<string, IntrospectionType>,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): string {
  const varDefs = buildVariableDefinitions(field.args)
  const fieldArgs = buildFieldArguments(field.args)
  const selection = buildSelectionSet(field.type, typeMap, maxDepth, new Set())

  const varPart = varDefs ? `(${varDefs})` : ''
  const argPart = fieldArgs ? `(${fieldArgs})` : ''
  const selPart = selection ? ` ${selection}` : ''

  return `${operationType} ${field.name}${varPart} { ${field.name}${argPart}${selPart} }`
}

function buildVariableDefinitions(args: IntrospectionInputValue[]): string {
  if (args.length === 0) return ''
  return args.map(a => `$${a.name}: ${formatTypeRef(a.type)}`).join(', ')
}

function buildFieldArguments(args: IntrospectionInputValue[]): string {
  if (args.length === 0) return ''
  return args.map(a => `${a.name}: $${a.name}`).join(', ')
}

function buildSelectionSet(
  typeRef: IntrospectionTypeRef,
  typeMap: Map<string, IntrospectionType>,
  depth: number,
  visited: Set<string>,
): string {
  const base = unwrapType(typeRef)
  if (!base.name) return ''

  const type = typeMap.get(base.name)
  if (!type || !type.fields) return ''

  if (base.kind === TypeKind.UNION || base.kind === TypeKind.INTERFACE) {
    return buildUnionSelection(type, typeMap, depth, visited)
  }

  if (base.kind !== TypeKind.OBJECT) return ''

  // Prevent circular references
  if (visited.has(base.name)) return ''
  visited.add(base.name)

  const fields: string[] = []
  for (const f of type.fields) {
    const fieldBase = unwrapType(f.type)
    if (fieldBase.kind === TypeKind.SCALAR || fieldBase.kind === TypeKind.ENUM) {
      fields.push(f.name)
    } else if (depth > 0 && (fieldBase.kind === TypeKind.OBJECT || fieldBase.kind === TypeKind.UNION || fieldBase.kind === TypeKind.INTERFACE)) {
      const nested = buildSelectionSet(f.type, typeMap, depth - 1, new Set(visited))
      if (nested) {
        fields.push(`${f.name} ${nested}`)
      }
    }
  }

  visited.delete(base.name)

  if (fields.length === 0) return ''
  return `{ ${fields.join(' ')} }`
}

function buildUnionSelection(
  _type: IntrospectionType,
  _typeMap: Map<string, IntrospectionType>,
  _depth: number,
  _visited: Set<string>,
): string {
  // For unions/interfaces, we need the possibleTypes — but introspection query
  // doesn't include them by default. Fall back to __typename only.
  // A more complete introspection query could include possibleTypes.
  return '{ __typename }'
}
