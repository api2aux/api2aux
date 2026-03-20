import { useState } from 'react'
import type { RendererProps } from '../../types/components'
import type { TypeSignature } from '../../types/schema'
import { PrimitiveRenderer } from './PrimitiveRenderer'
import { DynamicRenderer } from '../DynamicRenderer'
import { isImageUrl } from '@api2aux/data2ui'
import { formatLabel } from '../../utils/formatLabel'

/** Classify a nested object to decide rendering approach */
function classifyNestedObject(typeSig: TypeSignature): 'small' | 'large' {
  if (typeSig.kind !== 'object') return 'large'
  const fields = Array.from(typeSig.fields.values())
  const hasNested = fields.some(f => f.type.kind !== 'primitive')
  if (!hasNested && fields.length <= 4) return 'small'
  return 'large'
}

/** Exact primary field names (highest priority for title) */
const PRIMARY_EXACT = new Set(['name', 'title', 'label', 'heading', 'subject'])

/** Detect compound primary fields like provider_name, lastName (lower priority) */
function isCompoundPrimaryField(fieldName: string): boolean {
  const suffixes = ['_name', '_title', '_label', '-name', '-title', '-label', 'Name', 'Title']
  return suffixes.some(suffix => fieldName.endsWith(suffix))
}

/** Detect subtitle/description fields */
function isSubtitleField(fieldName: string): boolean {
  return /description|bio|summary|subtitle|about|tagline/i.test(fieldName)
}

/** Check if a value is empty (null, undefined, or empty string) */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/** Helper: field has a usable non-null, non-empty value */
function hasValue(obj: Record<string, unknown>, name: string): boolean {
  return obj[name] != null && obj[name] !== ''
}

/** Renders a single object as a hero/profile layout */
export function HeroRenderer({ data, schema, path, depth }: RendererProps) {
  // Hooks must be called before any early returns
  // Use a data-derived key to reset state when data changes instead of useEffect
  const dataKey = typeof data === 'object' && data !== null ? Object.keys(data as object).join(',') : ''
  const [nullFieldState, setNullFieldState] = useState({ key: dataKey, show: false })
  if (nullFieldState.key !== dataKey) {
    setNullFieldState({ key: dataKey, show: false })
  }
  const showNullFields = nullFieldState.show
  const setShowNullFields = (fn: (prev: boolean) => boolean) => setNullFieldState(prev => ({ ...prev, show: fn(prev.show) }))

  if (schema.kind !== 'object') {
    return <div className="text-red-500">HeroRenderer expects object schema</div>
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return <div className="text-red-500">HeroRenderer expects object data</div>
  }

  const obj = data as Record<string, unknown>
  const allFields = Array.from(schema.fields.entries())

  if (allFields.length === 0) {
    return <div className="text-muted-foreground italic">Empty object</div>
  }

  // Categorize fields
  const imageField = allFields.find(([name, def]) =>
    def.type.kind === 'primitive' && typeof obj[name] === 'string' && isImageUrl(obj[name] as string)
  )

  // Title field detection with priority tiers:
  // 1. Exact match (name, title, label) with value
  // 2. Compound match (provider_name, lastName) with value
  // 3. Any field containing "name" with value
  const titleField =
    allFields.find(([name]) => PRIMARY_EXACT.has(name.toLowerCase()) && hasValue(obj, name))
    ?? allFields.find(([name]) => isCompoundPrimaryField(name) && hasValue(obj, name))
    ?? allFields.find(([name, def]) =>
      def.type.kind === 'primitive'
      && /name/i.test(name) && name !== imageField?.[0]
      && hasValue(obj, name)
    )

  const subtitleField = allFields.find(([name, def]) =>
    def.type.kind === 'primitive' &&
    name !== titleField?.[0] &&
    name !== imageField?.[0] &&
    isSubtitleField(name)
  )

  const numberFields = allFields.filter(([name, def]) =>
    def.type.kind === 'primitive' &&
    def.type.type === 'number' &&
    name !== titleField?.[0] &&
    name !== imageField?.[0]
  )

  const usedFieldNames = new Set([
    imageField?.[0],
    titleField?.[0],
    subtitleField?.[0],
    ...numberFields.map(([n]) => n),
  ].filter(Boolean) as string[])

  const remainingPrimitives = allFields.filter(([name, def]) =>
    def.type.kind === 'primitive' && !usedFieldNames.has(name)
  )

  const nestedFields = allFields.filter(([, def]) =>
    def.type.kind !== 'primitive'
  )

  const title = titleField ? String(obj[titleField[0]] ?? '') : ''
  const subtitle = subtitleField ? String(obj[subtitleField[0]] ?? '') : ''
  const hasHeader = title || subtitle || imageField

  // Null-field filtering
  const visibleNumberFields = showNullFields
    ? numberFields
    : numberFields.filter(([name]) => !isEmptyValue(obj[name]))

  const visiblePrimitives = showNullFields
    ? remainingPrimitives
    : remainingPrimitives.filter(([name]) => !isEmptyValue(obj[name]))

  const visibleNested = showNullFields
    ? nestedFields
    : nestedFields.filter(([name]) => !isEmptyValue(obj[name]))

  const nullFieldCount = [
    ...numberFields.filter(([name]) => isEmptyValue(obj[name])),
    ...remainingPrimitives.filter(([name]) => isEmptyValue(obj[name])),
    ...nestedFields.filter(([name]) => isEmptyValue(obj[name])),
  ].length

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Hero header */}
      {hasHeader && (
        <div className="flex items-center gap-6 p-6 bg-muted">
          {imageField && (
            <img
              src={obj[imageField[0]] as string}
              alt={title || 'Image'}
              loading="lazy"
              className="w-24 h-24 rounded-full object-cover border-2 border-white shadow shrink-0"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <div className="min-w-0">
            {title && <h2 className="text-2xl font-bold text-foreground truncate">{title}</h2>}
            {subtitle && (
              <p className="text-muted-foreground mt-1 line-clamp-2">{subtitle}</p>
            )}
          </div>
        </div>
      )}

      {/* Empty fields toggle — only shown when there are empty fields */}
      {nullFieldCount > 0 && (
      <div className="flex justify-end px-4 pt-2 border-t border-border">
        <button
          onClick={() => setShowNullFields(prev => !prev)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title={showNullFields ? "Hide empty fields" : `Show ${nullFieldCount} empty field${nullFieldCount === 1 ? '' : 's'}`}
        >
          {showNullFields ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
          <span>{showNullFields ? 'Hide empty' : `Show ${nullFieldCount} empty`}</span>
        </button>
      </div>
      )}

      {/* Stats row */}
      {visibleNumberFields.length > 0 && (
        <div
          className="grid gap-4 p-4 border-t border-border bg-background"
          style={{ gridTemplateColumns: `repeat(${Math.min(visibleNumberFields.length, 5)}, 1fr)` }}
        >
          {visibleNumberFields.slice(0, 5).map(([name]) => (
            <div key={name} className="text-center">
              <div className="text-2xl font-bold text-foreground">
                {typeof obj[name] === 'number' ? (obj[name] as number).toLocaleString() : '--'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{formatLabel(name)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Remaining primitive fields */}
      {visiblePrimitives.length > 0 && (
        <div className="p-4 border-t border-border space-y-2">
          {visiblePrimitives.map(([name, def]) => (
            <div key={name} className="grid grid-cols-[8rem_1fr] gap-x-4 text-sm">
              <span className="font-medium text-muted-foreground">{formatLabel(name)}:</span>
              <PrimitiveRenderer
                data={obj[name]}
                schema={def.type}
                path={`${path}.${name}`}
                depth={depth + 1}
              />
            </div>
          ))}
        </div>
      )}

      {/* Nested objects/arrays */}
      {visibleNested.map(([name, def]) => {
        const classification = classifyNestedObject(def.type)
        const nestedValue = obj[name]

        // Small objects: flat merge into parent
        if (
          classification === 'small' &&
          def.type.kind === 'object' &&
          typeof nestedValue === 'object' && nestedValue !== null && !Array.isArray(nestedValue)
        ) {
          const nestedObj = nestedValue as Record<string, unknown>
          const nestedEntries = Array.from(def.type.fields.entries())
            .filter(([, fd]) => fd.type.kind === 'primitive')

          return (
            <div key={name} className="border-t border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">{formatLabel(name)}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                {nestedEntries.map(([fieldName, fd]) => (
                  <div key={fieldName} className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline min-w-0">
                    <div className="text-sm font-medium text-muted-foreground py-0.5 whitespace-nowrap">{formatLabel(fieldName)}:</div>
                    <div className="py-0.5 min-w-0">
                      <PrimitiveRenderer data={nestedObj[fieldName]} schema={fd.type} path={`${path}.${name}.${fieldName}`} depth={depth + 2} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        }

        // Medium/Large: heading + DynamicRenderer
        return (
          <div key={name} className="border-t border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">{formatLabel(name)}</h3>
            <DynamicRenderer
              data={nestedValue}
              schema={def.type}
              path={`${path}.${name}`}
              depth={depth + 1}
            />
          </div>
        )
      })}
    </div>
  )
}
