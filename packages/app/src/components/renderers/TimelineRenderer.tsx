import type { RendererProps } from '../../types/components'
import { PrimitiveRenderer } from './PrimitiveRenderer'
import { DrilldownContainer } from '../detail/DrilldownContainer'
import { useItemDrilldown } from '../../hooks/useItemDrilldown'
import { getItemLabel } from '../../utils/itemLabel'
import { formatLabel } from '../../utils/formatLabel'

/** Find the best date field from schema fields */
function findDateField(fields: Array<[string, { type: { kind: string; type?: string } }]>): string | null {
  // Prefer fields with date type
  const dateTyped = fields.find(([, def]) =>
    def.type.kind === 'primitive' && def.type.type === 'date'
  )
  if (dateTyped) return dateTyped[0]

  // Fall back to field name heuristics
  const dateKeywords = ['created_at', 'createdAt', 'date', 'created', 'updated_at', 'updatedAt', 'updated', 'timestamp', 'time']
  for (const keyword of dateKeywords) {
    const match = fields.find(([name]) => name.toLowerCase() === keyword.toLowerCase())
    if (match) return match[0]
  }

  // Broader match
  const broad = fields.find(([name]) => /date|time|created|updated/i.test(name))
  return broad ? broad[0] : null
}

/** Renders arrays of objects as a vertical timeline */
export function TimelineRenderer({ data, schema, path, depth }: RendererProps) {
  const { selectedItem, handleItemClick, clearSelection } = useItemDrilldown(
    schema.kind === 'array' ? schema.items : schema, path, data, schema
  )

  if (schema.kind !== 'array' || schema.items.kind !== 'object') {
    return <div className="text-red-500">TimelineRenderer expects array of objects</div>
  }

  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-muted-foreground italic p-4">No data</div>
  }

  const fields = Array.from(schema.items.fields.entries())
  const dateFieldName = findDateField(fields)

  const handleClick = (item: unknown, index: number) => {
    handleItemClick(item, index, getItemLabel(item))
  }

  // Fields to show in the content card (exclude date and title-like fields)
  const contentFields = fields.filter(([name, def]) => {
    if (name === dateFieldName) return false
    if (def.type.kind !== 'primitive') return false
    return true
  }).slice(0, 3)

  return (
    <div>
      <div className="relative ml-4">
        {/* Vertical line */}
        <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-muted" />

        <div className="space-y-6">
          {data.map((item, index) => {
            const obj = item as Record<string, unknown>
            const title = getItemLabel(item)
            const dateValue = dateFieldName ? obj[dateFieldName] : null

            let dateDisplay = `#${index + 1}`
            if (dateValue && typeof dateValue === 'string') {
              try {
                const date = new Date(dateValue)
                if (!isNaN(date.getTime())) {
                  dateDisplay = date.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                }
              } catch {
                dateDisplay = String(dateValue)
              }
            }

            return (
              <div
                key={index}
                onClick={() => handleClick(item, index)}
                className="flex items-start cursor-pointer group"
              >
                {/* Dot on the timeline */}
                <div className="w-3 h-3 rounded-full bg-primary border-2 border-white shadow shrink-0 mt-1.5 relative z-10 -ml-[5px]" />

                {/* Content card */}
                <div className="ml-4 flex-1 border border-border rounded-lg p-3 group-hover:border-foreground/20 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-foreground">{title}</div>
                    <div className="text-xs text-muted-foreground shrink-0 ml-2">{dateDisplay}</div>
                  </div>
                  {contentFields.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {contentFields.map(([fieldName, fieldDef]) => {
                        const value = obj[fieldName]
                        if (value === null || value === undefined) return null
                        return (
                          <div key={fieldName} className="text-sm flex gap-2">
                            <span className="text-muted-foreground shrink-0">{formatLabel(fieldName)}:</span>
                            <PrimitiveRenderer
                              data={value}
                              schema={fieldDef.type}
                              path={`${path}[${index}].${fieldName}`}
                              depth={depth + 1}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <DrilldownContainer
        selectedItem={selectedItem}
        itemSchema={schema.items}
        onClose={clearSelection}
      />
    </div>
  )
}
