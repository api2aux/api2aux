import type { RendererProps } from '../../types/components'
import { DrilldownContainer } from '../detail/DrilldownContainer'
import { getHeroImageField } from '../../utils/imageDetection'
import { useItemDrilldown } from '../../hooks/useItemDrilldown'
import { getItemLabel } from '../../utils/itemLabel'

/** Renders arrays of objects as an image-forward masonry gallery */
export function GalleryRenderer({ data, schema, path }: RendererProps) {
  const { selectedItem, handleItemClick, clearSelection } = useItemDrilldown(
    schema.kind === 'array' ? schema.items : schema, path, data, schema
  )

  if (schema.kind !== 'array' || schema.items.kind !== 'object') {
    return <div className="text-red-500">GalleryRenderer expects array of objects</div>
  }

  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-muted-foreground italic p-4">No data</div>
  }

  const fields = Array.from(schema.items.fields.entries())

  const handleClick = (item: unknown, index: number) => {
    handleItemClick(item, index, getItemLabel(item))
  }

  return (
    <div>
      <div className="columns-2 @lg:columns-3 @5xl:columns-4 gap-4 space-y-4">
        {data.map((item, index) => {
          const obj = item as Record<string, unknown>
          const title = getItemLabel(item)
          const heroImage = getHeroImageField(obj, fields)

          return (
            <div
              key={index}
              onClick={() => handleClick(item, index)}
              className="break-inside-avoid rounded-lg overflow-hidden border border-border shadow-sm hover:shadow-md cursor-pointer transition-all"
            >
              {heroImage ? (
                <div className="relative">
                  <img
                    src={heroImage.url}
                    alt={title}
                    loading="lazy"
                    className="w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget.parentElement as HTMLElement).style.display = 'none'
                    }}
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                    <div className="text-white text-sm font-medium truncate">{title}</div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-card">
                  <div className="font-medium text-foreground">{title}</div>
                  {fields.slice(0, 2).map(([fieldName]) => {
                    const val = obj[fieldName]
                    if (val === null || val === undefined) return null
                    return (
                      <div key={fieldName} className="text-xs text-muted-foreground mt-1 truncate">
                        {String(val)}
                      </div>
                    )
                  })}
                </div>
              )}
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
