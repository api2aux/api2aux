import { useMemo, useRef, useEffect, useState } from 'react'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { TagGroup } from './TagGroup'
import { OperationItem } from './OperationItem'
import { useWorkflowAnalysis } from '../../hooks/useWorkflowAnalysis'
import type { RelatedOperation } from '../../hooks/useWorkflowAnalysis'
import { useRuntimeDiscovery } from '../../hooks/useRuntimeDiscovery'
import { DiscoveryDialog } from '../DiscoveryDialog'
import { ChevronLeft, Radar, Loader2 } from 'lucide-react'
import { methodColorClass } from '../../lib/method-colors'

interface SidebarProps {
  parsedSpec: ParsedAPI
  selectedIndex: number
  onSelect: (index: number) => void
  onCollapse?: () => void
  /** Base URL for auth chain config */
  baseUrl?: string
}

/** Compact clickable related endpoint item */
function RelatedItem({ rel, onClick }: { rel: RelatedOperation; onClick: () => void }) {
  const displayPath = rel.path
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-0.5 rounded hover:bg-background/60 transition-colors group"
      title={rel.path}
    >
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[10px] font-semibold uppercase shrink-0 ${methodColorClass(rel.method)}`}>
          {rel.method}
        </span>
        <span className="text-xs font-mono text-foreground truncate group-hover:underline">{displayPath}</span>
      </div>
      <p className="text-[10px] text-muted-foreground/70 truncate ml-[calc(0.375rem+1ch)]">
        {rel.binding}{rel.summary ? ` — ${rel.summary}` : ''}
      </p>
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
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Depends on</p>
          {prevOps.map(rel => (
            <RelatedItem key={rel.operationId} rel={rel} onClick={() => handleClick(rel.operationId)} />
          ))}
        </div>
      )}
      {nextOps.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Feeds into</p>
          {nextOps.map(rel => (
            <RelatedItem key={rel.operationId} rel={rel} onClick={() => handleClick(rel.operationId)} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ parsedSpec, selectedIndex, onSelect, onCollapse, baseUrl }: SidebarProps) {
  const { progress: discoveryProgress, probeResults, edges: runtimeEdges, discover, cancel } = useRuntimeDiscovery(parsedSpec)
  const workflowAnalysis = useWorkflowAnalysis(parsedSpec, runtimeEdges)
  const listRef = useRef<HTMLUListElement>(null)
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false)

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
    if (index !== selectedIndex || related.length === 0) return null
    return (
      <RelatedSection
        related={related}
        parsedSpec={parsedSpec}
        onSelect={onSelect}
        className="ml-5 mr-3 my-1 pl-3 py-1.5 border-l-2 border-border/60 text-muted-foreground"
      />
    )
  }

  return (
    <nav
      aria-label="API endpoints"
      className="w-full border-r border-border bg-card flex flex-col h-screen sticky top-0"
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
          <button
            onClick={() => setDiscoveryDialogOpen(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
            title="View and discover relations between endpoints"
          >
            {discoveryProgress.status === 'running' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Radar className="w-3 h-3" />
            )}
            {discoveryProgress.status === 'running' ? 'Discovering...' : 'Discover more relations'}
          </button>
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
                baseUrl={baseUrl}
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
                baseUrl={baseUrl}
              />
            </li>
          ))
        )}
      </ul>

      <DiscoveryDialog
        open={discoveryDialogOpen}
        onClose={() => setDiscoveryDialogOpen(false)}
        parsedSpec={parsedSpec}
        progress={discoveryProgress}
        probeResults={probeResults}
        allEdges={workflowAnalysis?.graph.edges ?? []}
        analysisAvailable={workflowAnalysis !== null}
        onDiscover={discover}
        onCancel={cancel}
      />
    </nav>
  )
}
