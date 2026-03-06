import type { RendererProps } from '../../types/components'
import { PrimitiveRenderer } from './PrimitiveRenderer'
import { DrilldownContainer } from '../detail/DrilldownContainer'
import { useItemDrilldown } from '../../hooks/useItemDrilldown'
import { getItemLabel } from '../../utils/itemLabel'

/**
 * ListRenderer displays arrays of objects as a simple vertical list.
 * Each item shows the title + 2-3 key field values inline.
 * Click on an item to open the DetailModal.
 */
export function ListRenderer({ data, schema, path, depth }: RendererProps) {
  const { selectedItem, handleItemClick, clearSelection } = useItemDrilldown(
    schema.kind === 'array' ? schema.items : schema, path, data, schema
  )

  if (schema.kind !== 'array') {
    return <div className="text-red-500">ListRenderer expects array schema</div>
  }

  if (!Array.isArray(data)) {
    return <div className="text-red-500">ListRenderer expects array data</div>
  }

  // Handle empty arrays
  if (data.length === 0) {
    return <div className="text-muted-foreground italic p-4">No data</div>
  }

  // Extract fields from the item schema (must be object)
  if (schema.items.kind !== 'object') {
    return <div className="text-red-500">ListRenderer expects array of objects</div>
  }

  const fields = Array.from(schema.items.fields.entries())

  return (
    <div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {data.map((item, index) => {
          const obj = item as Record<string, unknown>
          const title = getItemLabel(item)

          // Show first 2-3 non-title fields inline
          const titleField = ['name', 'title', 'label', 'id'].find((name) => {
            const value = obj[name]
            return typeof value === 'string' && value.length > 0
          })

          const displayFields = fields
            .filter(([fieldName]) => fieldName !== titleField)
            .slice(0, 3)

          return (
            <div
              key={index}
              onClick={() => handleItemClick(item, index, title)}
              className="border-b border-border last:border-b-0 px-4 py-3 hover:bg-muted cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className="font-medium text-foreground">{title}</span>
                {displayFields.map(([fieldName, fieldDef]) => {
                  const value = obj[fieldName]
                  const fieldPath = `${path}[${index}].${fieldName}`

                  return (
                    <span
                      key={fieldName}
                      className="text-sm text-muted-foreground"
                    >
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
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <DrilldownContainer
        selectedItem={selectedItem}
        itemSchema={schema.items}
        onClose={clearSelection}
      />
    </div>
  )
}
