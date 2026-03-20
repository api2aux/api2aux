import { useMemo } from 'react'
import type { RendererProps } from '../../types/components'
import { PrimitiveRenderer } from './PrimitiveRenderer'
import { DrilldownContainer } from '../detail/DrilldownContainer'
import { getHeroImageField } from '@api2aux/data2ui'
import { useItemDrilldown } from '../../hooks/useItemDrilldown'
import { getItemLabel } from '../../utils/itemLabel'
import { useConfigStore } from '../../store/configStore'
import { usePagination } from '../../hooks/usePagination'
import { PaginationControls } from '../pagination/PaginationControls'

/**
 * CardListRenderer displays arrays of objects as a responsive grid of cards.
 * Each card shows fields filtered by importance tier (primary + secondary only).
 * Click on a card to open the DetailModal.
 */
export function CardListRenderer({ data, schema, path, depth, importance }: RendererProps) {
  const { selectedItem, handleItemClick, clearSelection } = useItemDrilldown(
    schema.kind === 'array' ? schema.items : schema, path, data, schema
  )
  const { getPaginationConfig, setPaginationConfig } = useConfigStore()

  if (schema.kind !== 'array') {
    return <div className="text-red-500">CardListRenderer expects array schema</div>
  }

  if (!Array.isArray(data)) {
    return <div className="text-red-500">CardListRenderer expects array data</div>
  }

  // Handle empty arrays
  if (data.length === 0) {
    return <div className="text-muted-foreground italic p-4">No data</div>
  }

  // Extract fields from the item schema (must be object)
  if (schema.items.kind !== 'object') {
    return <div className="text-red-500">CardListRenderer expects array of objects</div>
  }

  // Pagination state
  const cardPageOptions = [12, 24, 48, 96]
  const paginationConfig = getPaginationConfig(path, 12)
  // Snap to nearest valid option if persisted value isn't in the list (e.g. migrated from old defaults)
  const effectivePerPage = cardPageOptions.includes(paginationConfig.itemsPerPage)
    ? paginationConfig.itemsPerPage
    : cardPageOptions.reduce((a, b) => Math.abs(b - paginationConfig.itemsPerPage) < Math.abs(a - paginationConfig.itemsPerPage) ? b : a)
  const pagination = usePagination({
    totalItems: data.length,
    itemsPerPage: effectivePerPage,
    currentPage: paginationConfig.currentPage,
  })

  const paginatedData = data.slice(pagination.firstIndex, pagination.lastIndex)

  const handlePageChange = (page: number) => {
    setPaginationConfig(path, { currentPage: page })
  }

  const handleItemsPerPageChange = (items: number) => {
    setPaginationConfig(path, { itemsPerPage: items, currentPage: 1 })
  }

  const fields = Array.from(schema.items.fields.entries())

  // Filter fields by importance tier (primary + secondary only)
  const fieldsToDisplay = useMemo(() => {
    if (!importance) {
      // No importance data - show all fields (v1.2 behavior preserved)
      return fields
    }

    const filtered = fields.filter(([fieldName]) => {
      const fieldPath = `${path}[].${fieldName}`
      const score = importance.get(fieldPath)
      // Show primary and secondary, hide tertiary
      return !score || score.tier === 'primary' || score.tier === 'secondary'
    })

    // Safety fallback: if tier filtering removes all fields, show all fields
    // This prevents empty cards when all fields score as tertiary
    return filtered.length > 0 ? filtered : fields
  }, [fields, importance, path])

  return (
    <div>
      <div className="grid grid-cols-1 @lg:grid-cols-2 @5xl:grid-cols-3 gap-4">
        {paginatedData.map((item, paginatedIndex) => {
          const obj = item as Record<string, unknown>
          const globalIndex = pagination.firstIndex + paginatedIndex
          const title = getItemLabel(item)

          // Detect hero image from first image-URL field (use all fields for detection)
          const heroImage = getHeroImageField(obj, fields)

          // Show filtered fields (primary + secondary tier only), limited to first 3
          const displayFields = fieldsToDisplay.slice(0, 3)

          return (
            <div
              key={globalIndex}
              onClick={() => handleItemClick(item, globalIndex, title)}
              className="bg-card border border-border rounded-lg overflow-hidden shadow-sm hover:shadow-md hover:border-foreground/20 hover:-translate-y-0.5 cursor-pointer transition-all duration-150"
            >
              {/* Hero image - full width at top of card */}
              {heroImage && (
                <div className="w-full aspect-video bg-muted overflow-hidden">
                  <img
                    src={heroImage.url}
                    alt={title}
                    loading="lazy"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.currentTarget.parentElement as HTMLElement).style.display = 'none'
                    }}
                  />
                </div>
              )}

              {/* Card content wrapper with padding */}
              <div className="p-3">
                {/* Card header with title */}
                <div className="font-semibold text-lg mb-2 text-foreground">
                  {title}
                </div>

                {/* Card content: key-value pairs */}
                <div className="space-y-1.5">
                  {displayFields.map(([fieldName, fieldDef]) => {
                    // Skip hero image field to avoid duplication
                    if (heroImage && fieldName === heroImage.fieldName) return null

                    const value = obj[fieldName]
                    const fieldPath = `${path}[${globalIndex}].${fieldName}`

                    const displayLabel = fieldName
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, (char) => char.toUpperCase())

                    return (
                      <div
                        key={fieldName}
                        className="text-sm line-clamp-2"
                      >
                        <span className="text-muted-foreground font-medium">
                          {displayLabel}:{' '}
                        </span>
                        {fieldDef.type.kind === 'primitive' ? (
                          <PrimitiveRenderer
                            data={value}
                            schema={fieldDef.type}
                            path={fieldPath}
                            depth={depth + 1}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {Array.isArray(value)
                              ? `[${value.length} items]`
                              : typeof value === 'object'
                              ? '{object}'
                              : String(value)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination controls */}
      {(pagination.totalPages > 1 || data.length > 12) && (
        <PaginationControls
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={data.length}
          itemsPerPage={effectivePerPage}
          pageNumbers={pagination.pageNumbers}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
          itemsPerPageOptions={cardPageOptions}
        />
      )}

      <DrilldownContainer
        selectedItem={selectedItem}
        itemSchema={schema.items}
        onClose={clearSelection}
      />
    </div>
  )
}
