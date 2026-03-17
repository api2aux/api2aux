import type { Operation } from '@api2aux/semantic-analysis'
import type { Workflow } from '@api2aux/workflow-inference'
import { Lock } from 'lucide-react'

const METHOD_BADGE: Record<string, string> = {
  GET: 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950',
  POST: 'text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
  PUT: 'text-orange-700 bg-orange-100 dark:text-orange-400 dark:bg-orange-950',
  PATCH: 'text-yellow-700 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-950',
}
const methodBadgeClass = (method: string) => METHOD_BADGE[method] ?? METHOD_BADGE.GET

const WORKFLOW_BADGE: Record<string, string> = {
  browse: 'text-purple-700 bg-purple-100 dark:text-purple-400 dark:bg-purple-950',
  crud: 'text-indigo-700 bg-indigo-100 dark:text-indigo-400 dark:bg-indigo-950',
  'search-detail': 'text-cyan-700 bg-cyan-100 dark:text-cyan-400 dark:bg-cyan-950',
  'create-then-get': 'text-teal-700 bg-teal-100 dark:text-teal-400 dark:bg-teal-950',
  custom: 'text-pink-700 bg-pink-100 dark:text-pink-400 dark:bg-pink-950',
}

interface OperationItemProps {
  operation: Operation
  index: number
  isSelected: boolean
  onSelect: (index: number) => void
  /** When true, show operation name/id instead of path (e.g. GraphQL where all ops share /graphql) */
  showNameInsteadOfPath?: boolean
  /** Workflows this operation participates in */
  workflows?: Workflow[]
}

export function OperationItem({ operation, index, isSelected, onSelect, showNameInsteadOfPath, workflows }: OperationItemProps) {
  // Deduplicate workflow patterns for badges
  const uniquePatterns = workflows
    ? [...new Set(workflows.map(w => w.pattern))].slice(0, 2)
    : []

  return (
    <button
      onClick={() => onSelect(index)}
      className={`
        w-full text-left px-3 py-2 transition-colors
        ${isSelected
          ? 'bg-muted border-l-2 border-foreground text-foreground'
          : 'hover:bg-muted border-l-2 border-transparent'
        }
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`px-1.5 py-0.5 text-xs font-semibold rounded uppercase ${methodBadgeClass(operation.method)}`}>
          {operation.method}
        </span>
        {operation.security && operation.security.length > 0 && (
          <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <code className="text-xs font-mono text-foreground truncate">
          {showNameInsteadOfPath ? (operation.summary || operation.id) : operation.path}
        </code>
      </div>
      <div className="flex items-center gap-1.5">
        {!showNameInsteadOfPath && operation.summary && (
          <p className="text-xs text-muted-foreground truncate flex-1">
            {operation.summary}
          </p>
        )}
        {uniquePatterns.map(pattern => (
          <span
            key={pattern}
            className={`px-1 py-0.5 text-[10px] font-medium rounded ${WORKFLOW_BADGE[pattern] ?? WORKFLOW_BADGE.custom}`}
          >
            {pattern}
          </span>
        ))}
      </div>
    </button>
  )
}
