import { type ReactNode, useState } from 'react'
import type { Operation } from '@api2aux/semantic-analysis'
import { OperationItem } from './OperationItem'

interface TagGroupProps {
  tag: string
  operations: Operation[]
  operationIndices: number[]
  selectedIndex: number
  onSelect: (index: number) => void
  showNameInsteadOfPath?: boolean
  /** Render related endpoints card below a given operation index. */
  renderRelated?: (index: number) => ReactNode
  /** Force this group open (e.g., when a related click targets an endpoint inside). */
  forceOpen?: boolean
  /** Base URL for auth chain config */
  baseUrl?: string
}

export function TagGroup({ tag, operations, operationIndices, selectedIndex, onSelect, showNameInsteadOfPath, renderRelated, forceOpen, baseUrl }: TagGroupProps) {
  const [userOpen, setUserOpen] = useState(true)

  // Group is open if: user hasn't collapsed it, OR it's forced open
  const open = userOpen || (forceOpen ?? false)

  const handleToggle = () => {
    setUserOpen(!open)
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-semibold text-sm text-foreground">{tag}</span>
          <span className="px-1.5 py-0.5 text-xs font-medium text-muted-foreground bg-muted rounded">
            {operations.length}
          </span>
        </div>
      </button>
      {open && (
        <div className="space-y-0.5">
          {operations.map((operation, localIndex) => {
            const globalIndex = operationIndices[localIndex]!
            return (
              <div key={globalIndex} data-operation-index={globalIndex}>
                <OperationItem
                  operation={operation}
                  index={globalIndex}
                  isSelected={globalIndex === selectedIndex}
                  onSelect={onSelect}
                  showNameInsteadOfPath={showNameInsteadOfPath}
                  baseUrl={baseUrl}
                />
                {renderRelated?.(globalIndex)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
