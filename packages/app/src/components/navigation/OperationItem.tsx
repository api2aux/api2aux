import type { Operation } from '@api2aux/semantic-analysis'
import { Lock } from 'lucide-react'
import { METHOD_BADGE } from '../../lib/method-colors'

const methodBadgeClass = (method: string) => METHOD_BADGE[method] ?? METHOD_BADGE.GET

/** Display path for an operation — always show the full path for clarity. */
function compactPath(path: string): string {
  return path
}

interface OperationItemProps {
  operation: Operation
  index: number
  isSelected: boolean
  onSelect: (index: number) => void
  /** When true, show operation name/id instead of path (e.g. GraphQL where all ops share /graphql) */
  showNameInsteadOfPath?: boolean
}

export function OperationItem({ operation, index, isSelected, onSelect, showNameInsteadOfPath }: OperationItemProps) {
  const displayPath = showNameInsteadOfPath
    ? (operation.summary || operation.id)
    : compactPath(operation.path)

  return (
    <button
      onClick={() => onSelect(index)}
      title={operation.path}
      className={`
        w-full text-left px-3 py-2 transition-colors
        ${isSelected
          ? 'bg-primary/10 border-l-[3px] border-primary text-foreground font-medium'
          : 'hover:bg-muted/50 border-l-[3px] border-transparent'
        }
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`px-1.5 py-0.5 text-xs font-semibold rounded uppercase shrink-0 ${methodBadgeClass(operation.method)}`}>
          {operation.method}
        </span>
        {operation.security && operation.security.length > 0 && (
          <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <code className="text-xs font-mono text-foreground truncate">
          {displayPath}
        </code>
      </div>
      {!showNameInsteadOfPath && operation.summary && (
        <p className="text-xs text-muted-foreground truncate">
          {operation.summary}
        </p>
      )}
    </button>
  )
}
