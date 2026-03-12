import { useMemo } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { TagGroup } from './TagGroup'
import { OperationItem } from './OperationItem'

interface SidebarProps {
  parsedSpec: ParsedAPI
  selectedIndex: number
  onSelect: (index: number) => void
}

export function Sidebar({ parsedSpec, selectedIndex, onSelect }: SidebarProps) {
  // Group operations by tags
  const groupedOperations = useMemo(() => {
    const map = new Map<string, number[]>()

    parsedSpec.operations.forEach((operation, index) => {
      const tags = operation.tags.length > 0 ? operation.tags : ['Uncategorized']

      tags.forEach((tag) => {
        if (!map.has(tag)) {
          map.set(tag, [])
        }
        map.get(tag)!.push(index)
      })
    })

    return map
  }, [parsedSpec.operations])

  // Check if all operations are uncategorized
  const allUncategorized = groupedOperations.size === 1 && groupedOperations.has('Uncategorized')

  // Check if all operations share the same path (e.g. GraphQL: all POST /graphql)
  const firstPath = parsedSpec.operations[0]?.path
  const allSamePath = parsedSpec.operations.length > 1 &&
    parsedSpec.operations.every(op => op.path === firstPath)

  return (
    <nav
      aria-label="API endpoints"
      className="w-64 border-r border-border bg-card overflow-y-auto shrink-0 h-screen sticky top-0"
    >
      {/* Sidebar header */}
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-sm text-foreground mb-1">{parsedSpec.title}</h2>
        <p className="text-xs text-muted-foreground">
          {parsedSpec.operations.length} endpoint{parsedSpec.operations.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Operations list */}
      <ul className="py-2">
        {allUncategorized ? (
          // Flat list for all uncategorized
          parsedSpec.operations.map((operation, index) => (
            <li key={index}>
              <OperationItem
                operation={operation}
                index={index}
                isSelected={index === selectedIndex}
                onSelect={onSelect}
                showNameInsteadOfPath={allSamePath}
              />
            </li>
          ))
        ) : (
          // Grouped by tags
          Array.from(groupedOperations.entries()).map(([tag, indices]) => (
            <li key={tag}>
              <TagGroup
                tag={tag}
                operations={indices.map((i) => parsedSpec.operations[i]!)}
                operationIndices={indices}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                showNameInsteadOfPath={allSamePath}
              />
            </li>
          ))
        )}
      </ul>
    </nav>
  )
}
