import { useState, useEffect } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import type { RendererProps } from '../../types/components'
import type { FieldDefinition } from '../../types/schema'
import { PrimitiveRenderer } from './PrimitiveRenderer'
import { DynamicRenderer } from '../DynamicRenderer'
import { useConfigStore } from '../../store/configStore'
import { useAppStore } from '../../store/appStore'
import { isImageUrl, getHeroImageField } from '@api2aux/data2ui'
import { DetailRendererGrouped } from './DetailRendererGrouped'
import { FieldRow } from './FieldRow'
import type { TypeSignature } from '../../types/schema'
import { formatLabel } from '../../utils/formatLabel'

/** Normalize path for cache lookup (convert indexed paths to generic) */
function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]')
}

/** Detect primary fields (name, title, label, heading, subject) for typography hierarchy */
function isPrimaryField(fieldName: string): boolean {
  const nameLower = fieldName.toLowerCase()
  const primaryExact = ['name', 'title', 'label', 'heading', 'subject']
  if (primaryExact.includes(nameLower)) return true

  const primarySuffixes = ['_name', '_title', '_label', '-name', '-title', '-label', 'Name', 'Title']
  return primarySuffixes.some(suffix => fieldName.endsWith(suffix))
}

/** Detect metadata fields (created, updated, timestamps) */
function isMetadataField(fieldName: string): boolean {
  return /created|updated|modified|timestamp|date/i.test(fieldName)
}

/** Check if a value is empty (null, undefined, or empty string) */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/** Chevron icon that rotates when disclosure is open */
function ChevronIcon() {
  return (
    <svg
      className="w-4 h-4 transition-transform ui-open:rotate-180"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** Get a summary label for a nested field */
function getFieldSummary(fieldDef: { type: { kind: string } }, value: unknown): string {
  if (fieldDef.type.kind === 'array') {
    const length = Array.isArray(value) ? value.length : 0
    return `(${length} items)`
  }
  return '(object)'
}

/** Classify a nested object to decide rendering approach */
function classifyNestedObject(typeSig: TypeSignature): 'small' | 'large' {
  if (typeSig.kind !== 'object') return 'large'
  const fields = Array.from(typeSig.fields.values())
  const hasNested = fields.some(f => f.type.kind !== 'primitive')
  // Small: <=4 primitive fields, no nested sub-objects — safe to flat merge
  if (!hasNested && fields.length <= 4) return 'small'
  return 'large'
}

export function DetailRenderer({ data, schema, path, depth }: RendererProps) {
  const [showGrouped, setShowGrouped] = useState(true)
  const [showNullFields, setShowNullFields] = useState(false)
  const { fieldConfigs } = useConfigStore()
  const { getAnalysisCache } = useAppStore()

  // Reset showNullFields when data changes
  useEffect(() => {
    setShowNullFields(false)
  }, [data])

  if (schema.kind !== 'object') {
    return <div className="text-red-500">DetailRenderer expects object schema</div>
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return <div className="text-red-500">DetailRenderer expects object data</div>
  }

  const obj = data as Record<string, unknown>
  const allFields = Array.from(schema.fields.entries())

  if (allFields.length === 0) {
    return <div className="text-muted-foreground italic">Empty object</div>
  }

  // Apply field ordering: sort by order if set, maintain original order otherwise
  const sortedFields = [...allFields].sort((a, b) => {
    const pathA = `${path}.${a[0]}`
    const pathB = `${path}.${b[0]}`
    const configA = fieldConfigs[pathA]
    const configB = fieldConfigs[pathB]

    const orderA = configA?.order ?? Number.MAX_SAFE_INTEGER
    const orderB = configB?.order ?? Number.MAX_SAFE_INTEGER

    if (orderA !== orderB) {
      return orderA - orderB
    }

    // Preserve original order for fields with same/no order
    return allFields.findIndex(f => f[0] === a[0]) - allFields.findIndex(f => f[0] === b[0])
  })

  // Filter fields based on visibility
  const visibilityFiltered = sortedFields.filter(([fieldName]) => {
    const fieldPath = `${path}.${fieldName}`
    const config = fieldConfigs[fieldPath]
    return config?.visible !== false
  })

  // Second filter: null/undefined values (when showNullFields is false)
  const visibleFields = showNullFields
    ? visibilityFiltered
    : visibilityFiltered.filter(([fieldName]) => {
        return !isEmptyValue(obj[fieldName])
      })

  // Count null fields that are hidden (for toggle button text)
  const nullFieldCount = visibilityFiltered.filter(([fieldName]) => {
    return isEmptyValue(obj[fieldName])
  }).length

  if (visibleFields.length === 0) {
    return <div className="text-muted-foreground italic">All fields hidden</div>
  }

  // Detect hero image
  const heroImage = getHeroImageField(obj, allFields)

  // Read analysis cache for grouping data (in view mode only)
  const cached = getAnalysisCache(path) || getAnalysisCache(normalizePath(path))
  const grouping = cached?.grouping ?? null
  const importance = cached?.importance ?? new Map()

  // Determine if grouped view should apply
  const shouldGroup = showGrouped &&
    grouping !== null &&
    grouping.groups.length > 0 &&
    visibleFields.length > 8

  // Group fields for structured layout in view mode
  const primaryFields: Array<[string, FieldDefinition]> = []
  const regularFields: Array<[string, FieldDefinition]> = []
  const imageFields: Array<[string, FieldDefinition]> = []
  const metaFields: Array<[string, FieldDefinition]> = []
  const nestedFields: Array<[string, FieldDefinition]> = []

  for (const field of visibleFields) {
    const [fieldName, fieldDef] = field

    // Skip hero image field to avoid duplication
    if (heroImage && fieldName === heroImage.fieldName) continue

    if (fieldDef.type.kind === 'primitive') {
      const value = obj[fieldName]
      const isImage = typeof value === 'string' && isImageUrl(value)

      if (isPrimaryField(fieldName)) {
        primaryFields.push(field)
      } else if (isMetadataField(fieldName)) {
        metaFields.push(field)
      } else if (isImage) {
        imageFields.push(field)
      } else {
        regularFields.push(field)
      }
    } else {
      nestedFields.push(field)
    }
  }

  // Helper to render a primitive field (uses FieldRow with tier styling)
  const renderPrimitiveField = (fieldName: string, fieldDef: FieldDefinition, value: unknown) => {
    const fieldPath = `${path}.${fieldName}`
    const config = fieldConfigs[fieldPath]
    const defaultLabel = fieldName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
    const displayLabel = config?.label || defaultLabel

    // Use importance tier if available, fallback to isPrimaryField heuristic
    // At depth > 0 (nested objects), normalize all tiers to secondary for visual uniformity
    // This prevents jarring size differences between fields in nested objects (e.g., Street vs Suite)
    const rawTier = importance.get(fieldPath)?.tier ?? (isPrimaryField(fieldName) ? 'primary' : 'secondary')
    const tier = depth > 0 ? 'secondary' : rawTier

    return (
      <FieldRow
        key={fieldName}
        fieldName={fieldName}
        displayLabel={displayLabel}
        value={value}
        fieldDef={fieldDef}
        fieldPath={fieldPath}
        tier={tier}
        depth={depth}
      />
    )
  }

  // Helper to render an image field
  const renderImageField = (fieldName: string, _fieldDef: FieldDefinition, value: unknown) => {
    const fieldPath = `${path}.${fieldName}`
    const config = fieldConfigs[fieldPath]
    const defaultLabel = fieldName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
    const displayLabel = config?.label || defaultLabel

    return (
      <div
        key={fieldName}
        className="space-y-2"
      >
        <div className="text-sm font-medium text-muted-foreground">
          {displayLabel}
        </div>
        <img
          src={value as string}
          alt={displayLabel}
          loading="lazy"
          className="max-w-full max-h-64 object-contain rounded-lg border border-border bg-muted"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>
    )
  }

  // Helper to render nested fields
  const renderNestedField = (fieldName: string, fieldDef: FieldDefinition, value: unknown) => {
    const fieldPath = `${path}.${fieldName}`
    const config = fieldConfigs[fieldPath]
    const defaultLabel = fieldName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
    const displayLabel = config?.label || defaultLabel

    // Use DynamicRenderer for arrays of objects (enables smart selection + click handling)
    if (
      fieldDef.type.kind === 'array' &&
      fieldDef.type.items.kind === 'object' &&
      Array.isArray(value) &&
      value.length > 0
    ) {
      return (
        <div key={fieldName}>
          <div className="text-sm text-muted-foreground mb-2">
            {displayLabel} ({value.length})
          </div>
          <DynamicRenderer
            data={value}
            schema={fieldDef.type}
            path={fieldPath}
            depth={depth + 1}
          />
        </div>
      )
    }

    // Classify nested objects for rendering approach
    const classification = classifyNestedObject(fieldDef.type)

    // Small objects (<=4 primitives, no sub-nesting): flat merge with divider + heading
    if (
      classification === 'small' &&
      fieldDef.type.kind === 'object' &&
      typeof value === 'object' && value !== null && !Array.isArray(value)
    ) {
      const nestedObj = value as Record<string, unknown>
      const nestedEntries = Array.from(fieldDef.type.fields.entries())
        .filter(([, fd]) => fd.type.kind === 'primitive')

      return (
        <div key={fieldName} className="border-t border-border pt-4 mt-2">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">{displayLabel}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            {nestedEntries.map(([name, fd]) => {
              const nestedPath = `${fieldPath}.${name}`
              return (
                <div key={name} className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline min-w-0">
                  <div className="text-sm font-medium text-muted-foreground py-0.5 whitespace-nowrap">{formatLabel(name)}:</div>
                  <div className="py-0.5 min-w-0">
                    <PrimitiveRenderer data={nestedObj[name]} schema={fd.type} path={nestedPath} depth={depth + 2} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    // Deep nesting (depth >= 3): collapsible Disclosure as last resort
    if (depth >= 3) {
      return (
        <div key={fieldName}>
          <Disclosure defaultOpen={false}>
            <DisclosureButton className="flex items-center gap-2 text-primary hover:text-primary/80 text-sm font-medium">
              <ChevronIcon />
              {displayLabel} {getFieldSummary(fieldDef, value)}
            </DisclosureButton>
            <DisclosurePanel className="ml-4 mt-2 border-l-2 border-border pl-4">
              <DynamicRenderer
                data={value}
                schema={fieldDef.type}
                path={fieldPath}
                depth={depth + 1}
              />
            </DisclosurePanel>
          </Disclosure>
        </div>
      )
    }

    // Medium/Large: divider + heading + DynamicRenderer (no wrapper border)
    return (
      <div key={fieldName} className="border-t border-border pt-4 mt-2">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">{displayLabel}</h3>
        <DynamicRenderer
          data={value}
          schema={fieldDef.type}
          path={fieldPath}
          depth={depth + 1}
        />
      </div>
    )
  }

  const renderFields = () => {
    return visibleFields.map(([fieldName, fieldDef]) => {
      const value = obj[fieldName]
      const fieldPath = `${path}.${fieldName}`
      const config = fieldConfigs[fieldPath]

      // Format label: use custom label if set, otherwise auto-format
      const defaultLabel = fieldName
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
      const displayLabel = config?.label || defaultLabel

      // Render primitive fields inline
      if (fieldDef.type.kind === 'primitive') {
        // Check if this is an image URL — render full-width
        const isImage = typeof value === 'string' && isImageUrl(value)

        if (isImage) {
          return (
            <div key={fieldName}>
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">
                  {displayLabel}
                </div>
                <img
                  src={value as string}
                  alt={displayLabel}
                  loading="lazy"
                  className="max-w-full max-h-64 object-contain rounded-lg border border-border bg-muted"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              </div>
            </div>
          )
        }

        // At depth > 0, disable primary field emphasis for visual uniformity
        const primary = depth === 0 && isPrimaryField(fieldName)

        return (
          <div key={fieldName}>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline min-w-0">
              <div className={primary
                ? "text-base font-semibold text-foreground py-1 whitespace-nowrap"
                : "text-sm font-medium text-muted-foreground py-1 whitespace-nowrap"
              }>
                {displayLabel}:
              </div>
              <div className={primary
                ? "py-1 text-lg font-semibold text-foreground min-w-0"
                : "py-1 min-w-0"
              }>
                <PrimitiveRenderer
                  data={value}
                  schema={fieldDef.type}
                  path={fieldPath}
                  depth={depth + 1}
                />
              </div>
            </div>
          </div>
        )
      }

      // Render nested objects/arrays - use hybrid logic
      const classification = classifyNestedObject(fieldDef.type)

      // Small objects: flat merge with divider + heading
      if (
        classification === 'small' &&
        fieldDef.type.kind === 'object' &&
        typeof value === 'object' && value !== null && !Array.isArray(value)
      ) {
        const nestedObj = value as Record<string, unknown>
        const nestedEntries = Array.from(fieldDef.type.fields.entries())
          .filter(([, fd]) => fd.type.kind === 'primitive')

        return (
          <div key={fieldName} className="border-t border-border pt-4 mt-2">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">{displayLabel}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
              {nestedEntries.map(([name, fd]) => {
                const nestedPath = `${fieldPath}.${name}`
                return (
                  <div key={name} className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline min-w-0">
                    <div className="text-sm font-medium text-muted-foreground py-0.5 whitespace-nowrap">{formatLabel(name)}:</div>
                    <div className="py-0.5 min-w-0">
                      <PrimitiveRenderer data={nestedObj[name]} schema={fd.type} path={nestedPath} depth={depth + 2} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      }

      // Deep nesting: collapsible Disclosure fallback
      if (depth >= 3) {
        return (
          <div key={fieldName}>
            <Disclosure defaultOpen={false}>
              <DisclosureButton className="flex items-center gap-2 text-primary hover:text-primary/80 text-sm font-medium">
                <ChevronIcon />
                {displayLabel} {getFieldSummary(fieldDef, value)}
              </DisclosureButton>
              <DisclosurePanel className="ml-4 mt-2 border-l-2 border-border pl-4">
                <DynamicRenderer
                  data={value}
                  schema={fieldDef.type}
                  path={fieldPath}
                  depth={depth + 1}
                />
              </DisclosurePanel>
            </Disclosure>
          </div>
        )
      }

      // Medium/Large: divider + heading + DynamicRenderer (no wrapper border)
      return (
        <div key={fieldName} className="border-t border-border pt-4 mt-2">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">{displayLabel}</h3>
          <DynamicRenderer
            data={value}
            schema={fieldDef.type}
            path={fieldPath}
            depth={depth + 1}
          />
        </div>
      )
    })
  }

  renderFields()

  // Conditional grouped/ungrouped rendering
  if (shouldGroup) {
    return (
      <DetailRendererGrouped
        data={obj}
        schema={schema}
        path={path}
        depth={depth}
        heroImage={heroImage}
        groups={grouping.groups}
        ungroupedFields={grouping.ungrouped}
        importance={importance}
        fieldConfigs={fieldConfigs}
        onToggleGrouping={() => setShowGrouped(false)}
        showNullFields={showNullFields}
        onToggleNullFields={() => setShowNullFields(prev => !prev)}
        nullFieldCount={nullFieldCount}
      />
    )
  }

  // View mode: flat ungrouped layout
  // Depth 0: card with border for top-level framing
  // Depth > 0: borderless — parent already provides visual context
  return (
    <div className={depth === 0 ? "space-y-6 border border-border rounded-lg p-4" : "space-y-4"}>
      {/* Toggle buttons: null fields and grouping */}
      <div className="flex justify-end items-center gap-2 -mt-2 -mr-2 mb-2">
          {/* Empty fields toggle — only shown when there are empty fields */}
          {nullFieldCount > 0 && (
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
          )}
          {/* Grouping toggle */}
          {grouping && grouping.groups.length > 0 && !showGrouped && visibleFields.length > 8 && (
            <button
              onClick={() => setShowGrouped(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Switch to grouped view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <span>Show grouped</span>
            </button>
          )}
        </div>
      {heroImage && (
        <div className="w-full">
          <img
            src={heroImage.url}
            alt="Detail hero"
            loading="lazy"
            className="max-w-full max-h-64 object-contain rounded-lg border border-border"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {primaryFields.map(([fieldName, fieldDef]) =>
          renderPrimitiveField(fieldName, fieldDef, obj[fieldName])
        )}
        {primaryFields.length > 0 && (
          <div className="md:col-span-2 border-b border-border" />
        )}
        {regularFields.map(([fieldName, fieldDef]) =>
          renderPrimitiveField(fieldName, fieldDef, obj[fieldName])
        )}
        {imageFields.map(([fieldName, fieldDef]) => (
          <div key={fieldName} className="md:col-span-2">
            {renderImageField(fieldName, fieldDef, obj[fieldName])}
          </div>
        ))}
        {nestedFields.map(([fieldName, fieldDef]) => (
          <div key={fieldName} className="md:col-span-2">
            {renderNestedField(fieldName, fieldDef, obj[fieldName])}
          </div>
        ))}
        {metaFields.length > 0 && (
          <div className="md:col-span-2 border-t border-border pt-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Metadata</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              {metaFields.map(([fieldName, fieldDef]) =>
                renderPrimitiveField(fieldName, fieldDef, obj[fieldName])
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
