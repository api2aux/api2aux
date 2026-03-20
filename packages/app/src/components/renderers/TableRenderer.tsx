import type { RendererProps } from '../../types/components'
import { PrimitiveRenderer } from './PrimitiveRenderer'
import { DrilldownContainer } from '../detail/DrilldownContainer'
import { useConfigStore } from '../../store/configStore'
import { isImageUrl } from '@api2aux/data2ui'
import { useItemDrilldown } from '../../hooks/useItemDrilldown'
import { usePagination } from '../../hooks/usePagination'
import { PaginationControls } from '../pagination/PaginationControls'

/** Compact inline display for non-primitive values in table cells */
function CompactValue({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <span className="text-muted-foreground italic">null</span>
  }
  if (Array.isArray(data)) {
    return (
      <span className="text-muted-foreground text-xs" title={JSON.stringify(data)}>
        [{data.length} items]
      </span>
    )
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data)
    return (
      <span className="text-muted-foreground text-xs" title={JSON.stringify(data)}>
        {'{'}
        {keys.slice(0, 2).join(', ')}
        {keys.length > 2 ? ', ...' : ''}
        {'}'}
      </span>
    )
  }
  return <span>{String(data)}</span>
}

/**
 * TableRenderer displays arrays of objects as a scrollable table.
 * Uses CSS-based scrolling with good performance for large datasets.
 * Note: react-window 2.x has API changes that are incompatible with the plan's expectations.
 * This implementation provides the same UX with simpler, more reliable code.
 */
export function TableRenderer({ data, schema, path, depth }: RendererProps) {
  const { fieldConfigs, getPaginationConfig, setPaginationConfig } = useConfigStore()
  const { selectedItem, handleItemClick, clearSelection } = useItemDrilldown(
    schema.kind === 'array' ? schema.items : schema, path, data, schema
  )

  // All hooks must be called before any early returns (React Rules of Hooks)
  const dataArray = Array.isArray(data) ? data : []
  const paginationConfig = getPaginationConfig(path, 20)
  const pagination = usePagination({
    totalItems: dataArray.length,
    itemsPerPage: paginationConfig.itemsPerPage,
    currentPage: paginationConfig.currentPage,
  })

  if (schema.kind !== 'array') {
    return <div className="text-red-500">TableRenderer expects array schema</div>
  }

  if (!Array.isArray(data)) {
    return <div className="text-red-500">TableRenderer expects array data</div>
  }

  // Handle empty arrays
  if (data.length === 0) {
    return <div className="text-muted-foreground italic p-4">No data</div>
  }

  // Extract columns from the item schema (must be object)
  if (schema.items.kind !== 'object') {
    return <div className="text-red-500">TableRenderer expects array of objects</div>
  }

  const paginatedData = data.slice(pagination.firstIndex, pagination.lastIndex)

  const handlePageChange = (page: number) => {
    setPaginationConfig(path, { currentPage: page })
  }

  const handleItemsPerPageChange = (items: number) => {
    setPaginationConfig(path, { itemsPerPage: items, currentPage: 1 })
  }

  const allColumns = Array.from(schema.items.fields.entries())

  // Apply field ordering: sort by order if set, maintain original order otherwise
  const sortedColumns = [...allColumns].sort((a, b) => {
    const pathA = `${path}[].${a[0]}`
    const pathB = `${path}[].${b[0]}`
    const configA = fieldConfigs[pathA]
    const configB = fieldConfigs[pathB]

    const orderA = configA?.order ?? Number.MAX_SAFE_INTEGER
    const orderB = configB?.order ?? Number.MAX_SAFE_INTEGER

    if (orderA !== orderB) {
      return orderA - orderB
    }

    // Preserve original order for fields with same/no order
    return allColumns.findIndex(col => col[0] === a[0]) - allColumns.findIndex(col => col[0] === b[0])
  })

  // Filter columns based on visibility
  const visibleColumns = sortedColumns.filter(([fieldName]) => {
    const fieldPath = `${path}[].${fieldName}`
    const config = fieldConfigs[fieldPath]
    return config?.visible !== false
  })

  if (visibleColumns.length === 0) {
    return <div className="text-muted-foreground italic p-4">All fields hidden</div>
  }

  const columnWidth = Math.max(150, Math.floor(900 / visibleColumns.length))
  const totalWidth = columnWidth * visibleColumns.length

  const renderHeader = () => {
    return (
      <div className="flex bg-background border-b-2 border-border font-semibold sticky top-0 z-10" style={{ minWidth: totalWidth }}>
        {visibleColumns.map(([fieldName]) => {
          const fieldPath = `${path}[].${fieldName}`
          const config = fieldConfigs[fieldPath]

          // Format column header: use custom label if set, otherwise auto-format
          const defaultLabel = fieldName
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase())
          const displayLabel = config?.label || defaultLabel

          return (
            <div key={fieldName}>
              <div
                data-field-path={fieldPath}
                className="px-4 py-3 border-r border-border text-sm"
                style={{ width: columnWidth, minWidth: columnWidth }}
              >
                {displayLabel}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Single scroll container — header and body scroll horizontally together */}
      <div className="overflow-auto" style={{ maxHeight: '600px' }}>
        {renderHeader()}

        {paginatedData.map((item, paginatedIndex) => {
          const row = item as Record<string, unknown>
          const globalIndex = pagination.firstIndex + paginatedIndex
          const isEven = paginatedIndex % 2 === 0

          return (
            <div
              key={globalIndex}
              onClick={() => handleItemClick(item, globalIndex)}
              className={`flex border-b border-border cursor-pointer hover:bg-muted ${
                isEven ? 'bg-muted' : 'bg-background'
              }`}
              style={{ minWidth: totalWidth }}
            >
              {visibleColumns.map(([fieldName, fieldDef]) => {
                const value = row[fieldName]
                const cellPath = `${path}[${globalIndex}].${fieldName}`
                // Check if this cell contains an image URL
                const isImage = fieldDef.type.kind === 'primitive' &&
                               typeof value === 'string' &&
                               isImageUrl(value)

                return (
                  <div
                    key={fieldName}
                    className="px-4 py-2 border-r border-border flex items-center overflow-hidden"
                    style={{ width: columnWidth, minWidth: columnWidth, height: '40px' }}
                  >
                    {isImage ? (
                      <div className="flex items-center gap-2 w-full">
                        <img
                          src={value as string}
                          alt={fieldName}
                          loading="lazy"
                          className="h-8 w-8 rounded object-cover flex-shrink-0"
                          onError={(e) => { e.currentTarget.style.display = 'none' }}
                        />
                        <span className="text-xs text-muted-foreground truncate" title={value as string}>
                          {(value as string).split('/').pop() || value}
                        </span>
                      </div>
                    ) : (
                      <div className="truncate w-full">
                        {fieldDef.type.kind === 'primitive' ? (
                          <PrimitiveRenderer
                            data={value}
                            schema={fieldDef.type}
                            path={cellPath}
                            depth={depth + 1}
                          />
                        ) : (
                          <CompactValue data={value} />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Pagination controls */}
      {(pagination.totalPages > 1 || data.length > 20) && (
        <PaginationControls
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={data.length}
          itemsPerPage={paginationConfig.itemsPerPage}
          pageNumbers={pagination.pageNumbers}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
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
