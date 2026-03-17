import { useMemo, useRef, useEffect } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { TagGroup } from './TagGroup'
import { OperationItem } from './OperationItem'
import { useWorkflowAnalysis } from '../../hooks/useWorkflowAnalysis'
import type { RelatedOperation } from '../../hooks/useWorkflowAnalysis'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-700 dark:text-green-400',
  POST: 'text-blue-700 dark:text-blue-400',
  PUT: 'text-orange-700 dark:text-orange-400',
  PATCH: 'text-yellow-700 dark:text-yellow-400',
  DELETE: 'text-red-700 dark:text-red-400',
}

interface SidebarProps {
  parsedSpec: ParsedAPI
  selectedIndex: number
  onSelect: (index: number) => void
}

/** Compact related endpoint item */
function RelatedItem({
  rel,
  onClick,
}: {
  rel: RelatedOperation
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-1 rounded hover:bg-background/60 transition-colors flex items-baseline gap-1.5 group"
    >
      <span className={`text-[10px] font-semibold uppercase shrink-0 ${METHOD_COLORS[rel.method] ?? METHOD_COLORS.GET}`}>
        {rel.method}
      </span>
      <span className="text-xs font-mono text-foreground truncate group-hover:underline">{rel.path}</span>
    </button>
  )
}

/** Inline related card shown directly below a selected endpoint */
function InlineRelatedCard({
  related,
  parsedSpec,
  onSelect,
}: {
  related: RelatedOperation[]
  parsedSpec: ParsedAPI
  onSelect: (index: number) => void
}) {
  const prevOps = related.filter(r => r.direction === 'prev').slice(0, 2)
  const nextOps = related.filter(r => r.direction === 'next').slice(0, 3)

  if (prevOps.length === 0 && nextOps.length === 0) return null

  const handleClick = (operationId: string) => {
    const idx = parsedSpec.operations.findIndex(o => o.id === operationId)
    if (idx !== -1) onSelect(idx)
  }

  return (
    <div className="mx-3 my-1 px-2 py-1.5 rounded-md bg-muted/50 border border-border/50">
      {prevOps.length > 0 && (
        <div className="mb-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Previous</p>
          {prevOps.map(rel => (
            <RelatedItem key={rel.operationId} rel={rel} onClick={() => handleClick(rel.operationId)} />
          ))}
        </div>
      )}
      {nextOps.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Next</p>
          {nextOps.map(rel => (
            <RelatedItem key={rel.operationId} rel={rel} onClick={() => handleClick(rel.operationId)} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ parsedSpec, selectedIndex, onSelect }: SidebarProps) {
  const workflowAnalysis = useWorkflowAnalysis(parsedSpec)
  const listRef = useRef<HTMLUListElement>(null)

  // Group operations by tags
  const groupedOperations = useMemo(() => {
    const map = new Map<string, number[]>()
    parsedSpec.operations.forEach((operation, index) => {
      const tags = operation.tags.length > 0 ? operation.tags : ['Uncategorized']
      tags.forEach((tag) => {
        if (!map.has(tag)) map.set(tag, [])
        map.get(tag)!.push(index)
      })
    })
    return map
  }, [parsedSpec.operations])

  const allUncategorized = groupedOperations.size === 1 && groupedOperations.has('Uncategorized')

  const selectedOp = parsedSpec.operations[selectedIndex]
  const related = selectedOp && workflowAnalysis
    ? (workflowAnalysis.relatedOperations.get(selectedOp.id) ?? []).sort((a, b) => b.score - a.score)
    : []

  const firstPath = parsedSpec.operations[0]?.path
  const allSamePath = parsedSpec.operations.length > 1 &&
    parsedSpec.operations.every(op => op.path === firstPath)

  // Scroll to selected operation when changed via Related click
  useEffect(() => {
    if (!listRef.current) return
    const target = listRef.current.querySelector(`[data-operation-index="${selectedIndex}"]`)
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }, [selectedIndex])

  /** Render an operation item + inline related card if selected */
  const renderOperation = (index: number) => {
    const operation = parsedSpec.operations[index]!
    const isSelected = index === selectedIndex
    return (
      <div key={index} data-operation-index={index}>
        <OperationItem
          operation={operation}
          index={index}
          isSelected={isSelected}
          onSelect={onSelect}
          showNameInsteadOfPath={allSamePath}
        />
        {isSelected && related.length > 0 && (
          <InlineRelatedCard
            related={related}
            parsedSpec={parsedSpec}
            onSelect={onSelect}
          />
        )}
      </div>
    )
  }

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
      <ul ref={listRef} className="py-2">
        {allUncategorized ? (
          parsedSpec.operations.map((_, index) => (
            <li key={index}>{renderOperation(index)}</li>
          ))
        ) : (
          Array.from(groupedOperations.entries()).map(([tag, indices]) => (
            <li key={tag}>
              <TagGroup
                tag={tag}
                operations={indices.map((i) => parsedSpec.operations[i]!)}
                operationIndices={indices}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                showNameInsteadOfPath={allSamePath}
                renderRelated={(index) => {
                  if (index !== selectedIndex || related.length === 0) return null
                  return (
                    <InlineRelatedCard
                      related={related}
                      parsedSpec={parsedSpec}
                      onSelect={onSelect}
                    />
                  )
                }}
              />
            </li>
          ))
        )}
      </ul>
    </nav>
  )
}
