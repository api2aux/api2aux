/**
 * Grouped detail view with Hero + Overview + Accordion Sections layout.
 * Implements smart grouping based on field importance and detected field groups.
 */

import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import type { TypeSignature, FieldDefinition } from '../../types/schema'
import type { ImportanceScore } from '../../services/analysis/types'
import type { FieldGroup, FieldInfo } from '../../services/analysis/types'
import { FieldRow } from './FieldRow'
import { DynamicRenderer } from '../DynamicRenderer'
import { isImageUrl } from '@api2aux/data2ui'

export interface DetailRendererGroupedProps {
  data: Record<string, unknown>
  schema: TypeSignature  // kind === 'object'
  path: string
  depth: number
  heroImage: { url: string; fieldName: string } | null
  groups: FieldGroup[]
  ungroupedFields: FieldInfo[]
  importance: Map<string, ImportanceScore>
  fieldConfigs: Record<string, any>
  onToggleGrouping: () => void  // switches to ungrouped mode
  showNullFields: boolean
  onToggleNullFields: () => void
  nullFieldCount: number
}

/** Chevron icon that rotates when disclosure is open */
function ChevronIcon() {
  return (
    <svg
      className="w-5 h-5 transition-transform ui-open:rotate-180"
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

/** List icon for ungrouped toggle button */
function ListIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

/** Check if a value is empty (null, undefined, or empty string) */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

export function DetailRendererGrouped({
  data,
  schema,
  path,
  depth,
  heroImage,
  groups,
  ungroupedFields,
  importance,
  fieldConfigs,
  onToggleGrouping,
  showNullFields,
  onToggleNullFields,
  nullFieldCount,
}: DetailRendererGroupedProps) {
  if (schema.kind !== 'object') {
    return <div className="text-red-500">DetailRendererGrouped expects object schema</div>
  }

  // Build a set of grouped field names for quick lookup
  const groupedFieldNames = new Set<string>()
  for (const group of groups) {
    for (const fieldInfo of group.fields) {
      groupedFieldNames.add(fieldInfo.name)
    }
  }

  // Categorize ungrouped fields by tier
  const ungroupedOverview: FieldInfo[] = []  // primary + secondary
  const ungroupedTertiary: FieldInfo[] = []

  for (const fieldInfo of ungroupedFields) {
    const fieldPath = `${path}.${fieldInfo.name}`
    const tier = importance.get(fieldPath)?.tier ?? 'secondary'

    if (tier === 'primary' || tier === 'secondary') {
      ungroupedOverview.push(fieldInfo)
    } else {
      ungroupedTertiary.push(fieldInfo)
    }
  }

  // Helper: Get field definition from schema
  const getFieldDef = (fieldName: string): FieldDefinition | null => {
    return schema.fields.get(fieldName) ?? null
  }

  // Helper: Get display label for a field
  const getDisplayLabel = (fieldName: string): string => {
    const fieldPath = `${path}.${fieldName}`
    const config = fieldConfigs[fieldPath]
    if (config?.label) return config.label

    return fieldName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  }

  // Helper: Render a primitive field using FieldRow
  const renderPrimitiveField = (fieldInfo: FieldInfo) => {
    const fieldDef = getFieldDef(fieldInfo.name)
    if (!fieldDef || fieldDef.type.kind !== 'primitive') return null

    const value = data[fieldInfo.name]
    const fieldPath = `${path}.${fieldInfo.name}`
    const tier = importance.get(fieldPath)?.tier ?? 'secondary'
    const displayLabel = getDisplayLabel(fieldInfo.name)

    return (
      <FieldRow
        key={fieldInfo.name}
        fieldName={fieldInfo.name}
        displayLabel={displayLabel}
        value={value}
        fieldDef={fieldDef}
        fieldPath={fieldPath}
        tier={tier}
        depth={depth + 1}
      />
    )
  }

  // Helper: Render an image field (full-width)
  const renderImageField = (fieldName: string, value: string) => {
    const displayLabel = getDisplayLabel(fieldName)
    return (
      <div
        key={fieldName}
        className="space-y-2"
      >
        <div className="text-sm font-medium text-muted-foreground">
          {displayLabel}
        </div>
        <img
          src={value}
          alt={displayLabel}
          loading="lazy"
          className="max-w-full max-h-64 object-contain rounded-lg border border-border bg-muted"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>
    )
  }

  // Helper: Render a nested field (object/array) using DynamicRenderer
  const renderNestedField = (fieldName: string) => {
    const fieldDef = getFieldDef(fieldName)
    if (!fieldDef) return null

    const value = data[fieldName]
    const fieldPath = `${path}.${fieldName}`
    const displayLabel = getDisplayLabel(fieldName)

    return (
      <div key={fieldName} className="space-y-2">
        <div className="text-sm font-semibold text-muted-foreground">
          {displayLabel}
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

  // Helper: Render fields within a group
  const renderGroupFields = (groupFields: FieldInfo[]) => {
    return groupFields.map((fieldInfo) => {
      const fieldDef = getFieldDef(fieldInfo.name)
      if (!fieldDef) return null

      const value = data[fieldInfo.name]

      // Filter out null/undefined fields when showNullFields is false
      if (!showNullFields && isEmptyValue(value)) {
        return null
      }

      // Image fields render as images
      if (fieldDef.type.kind === 'primitive' && typeof value === 'string' && isImageUrl(value)) {
        return renderImageField(fieldInfo.name, value)
      }

      // Primitive fields use FieldRow
      if (fieldDef.type.kind === 'primitive') {
        return renderPrimitiveField(fieldInfo)
      }

      // Nested fields use DynamicRenderer
      return renderNestedField(fieldInfo.name)
    })
  }

  return (
    <div className="space-y-6 border border-border rounded-lg p-4">
      {/* Toggle buttons at top-right */}
      <div className="flex justify-end items-center gap-2 -mt-2 -mr-2">
        {/* Empty fields toggle — only shown when there are empty fields */}
        {nullFieldCount > 0 && (
        <button
          onClick={onToggleNullFields}
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
        <button
          onClick={onToggleGrouping}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title="Switch to ungrouped view"
        >
          <ListIcon />
          <span>Show all (ungrouped)</span>
        </button>
      </div>

      {/* Hero Image */}
      {heroImage && (
        <div className="w-full -mt-2">
          <img
            src={heroImage.url}
            alt="Detail hero"
            loading="lazy"
            className="max-w-full max-h-64 object-contain rounded-lg border border-border"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
      )}

      {/* Overview section: ungrouped primary + secondary fields */}
      {ungroupedOverview.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {ungroupedOverview.map((fieldInfo) => {
            const fieldDef = getFieldDef(fieldInfo.name)
            if (!fieldDef) return null

            const value = data[fieldInfo.name]

            // Filter out null/undefined fields when showNullFields is false
            if (!showNullFields && isEmptyValue(value)) {
              return null
            }

            // Image fields take full width
            if (fieldDef.type.kind === 'primitive' && typeof value === 'string' && isImageUrl(value)) {
              return (
                <div key={fieldInfo.name} className="md:col-span-2">
                  {renderImageField(fieldInfo.name, value)}
                </div>
              )
            }

            // Primitive fields use FieldRow
            if (fieldDef.type.kind === 'primitive') {
              return renderPrimitiveField(fieldInfo)
            }

            // Nested fields take full width
            return (
              <div key={fieldInfo.name} className="md:col-span-2">
                {renderNestedField(fieldInfo.name)}
              </div>
            )
          })}
        </div>
      )}

      {/* Separator between overview and accordion sections */}
      {ungroupedOverview.length > 0 && groups.length > 0 && (
        <div className="border-b border-border" />
      )}

      {/* Accordion Sections: grouped fields */}
      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group, groupIndex) => {
            // Check if group has any visible fields (when showNullFields is false)
            const hasVisibleFields = showNullFields || group.fields.some(fieldInfo => {
              const value = data[fieldInfo.name]
              return !isEmptyValue(value)
            })

            // Skip empty groups
            if (!hasVisibleFields) {
              return null
            }

            return (
              <Disclosure key={groupIndex} defaultOpen={true}>
                <div className="border border-border rounded-lg overflow-hidden">
                  <DisclosureButton className="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted hover:bg-muted flex items-center justify-between transition-colors">
                    <span>{group.label}</span>
                    <ChevronIcon />
                  </DisclosureButton>
                  <DisclosurePanel className="px-4 py-3 space-y-2 bg-background">
                    {renderGroupFields(group.fields)}
                  </DisclosurePanel>
                </div>
              </Disclosure>
            )
          })}
        </div>
      )}

      {/* Ungrouped tertiary fields (metadata) */}
      {ungroupedTertiary.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Additional Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            {ungroupedTertiary.map((fieldInfo) => {
              const value = data[fieldInfo.name]
              // Filter out null/undefined fields when showNullFields is false
              if (!showNullFields && isEmptyValue(value)) {
                return null
              }
              return renderPrimitiveField(fieldInfo)
            })}
          </div>
        </div>
      )}
    </div>
  )
}
