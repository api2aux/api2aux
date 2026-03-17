import { useMemo, useRef, useEffect, useState } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { TagGroup } from './TagGroup'
import { OperationItem } from './OperationItem'
import { useWorkflowAnalysis } from '../../hooks/useWorkflowAnalysis'
import type { RelatedOperation } from '../../hooks/useWorkflowAnalysis'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

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
  onCollapse?: () => void
}

/** Compact clickable related endpoint item */
function RelatedItem({ rel, onClick }: { rel: RelatedOperation; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-0.5 rounded hover:bg-background/60 transition-colors flex items-baseline gap-1.5 group"
    >
      <span className={`text-[10px] font-semibold uppercase shrink-0 ${METHOD_COLORS[rel.method] ?? METHOD_COLORS.GET}`}>
        {rel.method}
      </span>
      <span className="text-xs font-mono text-foreground truncate group-hover:underline">{rel.path}</span>
    </button>
  )
}

/** Related endpoints section — reused for both inline and bottom */
function RelatedSection({
  related,
  parsedSpec,
  onSelect,
  className,
}: {
  related: RelatedOperation[]
  parsedSpec: ParsedAPI
  onSelect: (index: number) => void
  className?: string
}) {
  const prevOps = related.filter(r => r.direction === 'prev').slice(0, 2)
  const nextOps = related.filter(r => r.direction === 'next').slice(0, 3)

  if (prevOps.length === 0 && nextOps.length === 0) return null

  const handleClick = (operationId: string) => {
    const idx = parsedSpec.operations.findIndex(o => o.id === operationId)
    if (idx !== -1) onSelect(idx)
  }

  return (
    <div className={className}>
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

export function Sidebar({ parsedSpec, selectedIndex, onSelect, onCollapse }: SidebarProps) {
  const workflowAnalysis = useWorkflowAnalysis(parsedSpec)
  const listRef = useRef<HTMLUListElement>(null)
  const [relatedExpanded, setRelatedExpanded] = useState(true)

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

  // Scroll to selected operation when changed (e.g., via Related click)
  useEffect(() => {
    if (!listRef.current) return
    const target = listRef.current.querySelector(`[data-operation-index="${selectedIndex}"]`)
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }, [selectedIndex])

  /** Render inline related card if this operation is selected */
  const renderInlineRelated = (index: number) => {
    if (index !== selectedIndex || related.length === 0 || !relatedExpanded) return null
    return (
      <RelatedSection
        related={related}
        parsedSpec={parsedSpec}
        onSelect={onSelect}
        className="mx-3 my-1 px-2 py-1.5 rounded-md bg-muted/50 border border-border/50"
      />
    )
  }

  return (
    <nav
      aria-label="API endpoints"
      className="w-64 border-r border-border bg-card flex flex-col shrink-0 h-screen sticky top-0"
    >
      {/* Sidebar header — stays pinned */}
      <div className="p-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-sm text-foreground">{parsedSpec.title}</h2>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -mr-1"
              title="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {parsedSpec.operations.length} endpoint{parsedSpec.operations.length !== 1 ? 's' : ''}
          </p>
          {/* Toggle for inline related visibility */}
          {related.length > 0 && (
            <button
              onClick={() => setRelatedExpanded(!relatedExpanded)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
              title={relatedExpanded ? 'Hide related endpoints' : 'Show related endpoints'}
            >
              {relatedExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Related
            </button>
          )}
        </div>
      </div>

      {/* Operations list — scrollable */}
      <ul ref={listRef} className="py-2 overflow-y-auto flex-1 min-h-0">
        {allUncategorized ? (
          parsedSpec.operations.map((operation, index) => (
            <li key={index} data-operation-index={index}>
              <OperationItem
                operation={operation}
                index={index}
                isSelected={index === selectedIndex}
                onSelect={onSelect}
                showNameInsteadOfPath={allSamePath}
              />
              {renderInlineRelated(index)}
            </li>
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
                renderRelated={renderInlineRelated}
                forceOpen={indices.includes(selectedIndex)}
              />
            </li>
          ))
        )}
      </ul>

    </nav>
  )
}
