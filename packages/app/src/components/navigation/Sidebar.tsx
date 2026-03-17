import { useMemo } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { TagGroup } from './TagGroup'
import { OperationItem } from './OperationItem'
import { useWorkflowAnalysis } from '../../hooks/useWorkflowAnalysis'
import type { RelatedOperation } from '../../hooks/useWorkflowAnalysis'
import { ArrowRight, ArrowLeft } from 'lucide-react'

interface SidebarProps {
  parsedSpec: ParsedAPI
  selectedIndex: number
  onSelect: (index: number) => void
}

export function Sidebar({ parsedSpec, selectedIndex, onSelect }: SidebarProps) {
  const workflowAnalysis = useWorkflowAnalysis(parsedSpec)

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

  // Selected operation and its related operations
  const selectedOp = parsedSpec.operations[selectedIndex]
  const related = selectedOp && workflowAnalysis
    ? (workflowAnalysis.relatedOperations.get(selectedOp.id) ?? [])
        .sort((a, b) => b.score - a.score)
    : []

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

      {/* Related Operations — shown when an operation is selected */}
      {selectedOp && related.length > 0 && (
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">Related</p>
          <div className="space-y-1">
            {related.slice(0, 5).map((rel) => {
              const targetIndex = parsedSpec.operations.findIndex(o => o.id === rel.operationId)
              if (targetIndex === -1) return null
              const targetOp = parsedSpec.operations[targetIndex]!
              return (
                <button
                  key={`${rel.direction}-${rel.operationId}`}
                  onClick={() => onSelect(targetIndex)}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
                >
                  {rel.direction === 'next'
                    ? <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    : <ArrowLeft className="w-3 h-3 text-muted-foreground shrink-0" />
                  }
                  <span className="font-mono text-foreground truncate">{targetOp.id || targetOp.path}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

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
                workflows={workflowAnalysis?.operationWorkflows.get(operation.id)}
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
                operationWorkflows={workflowAnalysis?.operationWorkflows}
              />
            </li>
          ))
        )}
      </ul>
    </nav>
  )
}
