import type { TypeSignature } from '../../types/schema'
import { getHeroImageField } from '@api2aux/data2ui'
import { getItemLabel } from '../../utils/itemLabel'

interface HorizontalCardScrollerProps {
  items: unknown[]
  schema: TypeSignature  // The items schema (should be object kind)
  path: string
  depth: number
  label: string
}

/** Format field names for display labels */
function formatLabel(fieldName: string): string {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function HorizontalCardScroller({ items, schema, path: _path, depth: _depth, label }: HorizontalCardScrollerProps) {
  // Guard: only handle object schemas
  if (schema.kind !== 'object') {
    return null
  }

  const fields = Array.from(schema.fields.entries())

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground mb-2">
        {label} ({items.length})
      </div>
      <div className="relative">
        <div className="overflow-x-auto scroll-smooth pb-2" style={{ scrollSnapType: 'x proximity' }}>
          <div className="inline-flex gap-4 p-1">
            {items.map((item, idx) => {
              if (typeof item !== 'object' || item === null) return null

              const obj = item as Record<string, unknown>
              const heroImage = getHeroImageField(obj, fields)
              const itemLabel = getItemLabel(item, `Item ${idx + 1}`)

              // Get first 3 primitive fields (skip hero field)
              const displayFields = fields
                .filter(([fieldName, fieldDef]) => {
                  if (heroImage && fieldName === heroImage.fieldName) return false
                  return fieldDef.type.kind === 'primitive'
                })
                .slice(0, 3)

              return (
                <div
                  key={idx}
                  className="flex-none w-64 border border-border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  {heroImage && (
                    <div className="w-full h-36 bg-muted">
                      <img
                        src={heroImage.url}
                        alt={label}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const parent = e.currentTarget.parentElement
                          if (parent) parent.style.display = 'none'
                        }}
                      />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="font-medium text-sm mb-1 truncate">
                      {itemLabel}
                    </div>
                    {displayFields.map(([fieldName, _fieldDef]) => {
                      const value = obj[fieldName]
                      if (value === null || value === undefined) return null
                      return (
                        <div key={fieldName} className="text-xs text-muted-foreground truncate">
                          <span className="font-medium">{formatLabel(fieldName)}:</span> {String(value)}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-white to-transparent" />
      </div>
    </div>
  )
}
