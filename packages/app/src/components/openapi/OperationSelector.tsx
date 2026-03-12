import type { Operation } from '@api2aux/semantic-analysis'

const METHOD_BADGE: Record<string, string> = {
  GET: 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950',
  POST: 'text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
  PUT: 'text-orange-700 bg-orange-100 dark:text-orange-400 dark:bg-orange-950',
  PATCH: 'text-yellow-700 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-950',
}
const methodBadgeClass = (method: string) => METHOD_BADGE[method] ?? METHOD_BADGE.GET

interface OperationSelectorProps {
  operations: Operation[]
  selectedIndex: number
  onSelect: (index: number) => void
}

export function OperationSelector({ operations, selectedIndex, onSelect }: OperationSelectorProps) {
  // Check if all operations share the same path (e.g. GraphQL: all POST /graphql)
  const firstPath = operations[0]?.path
  const allSamePath = operations.length > 1 &&
    operations.every(op => op.path === firstPath)

  const getOperationLabel = (operation: Operation): string => {
    if (allSamePath) {
      return `${operation.method} ${operation.summary || operation.id}`
    }
    return `${operation.method} ${operation.path}${operation.summary ? ` — ${operation.summary}` : ''}`
  }

  // Single operation: render as static text
  if (operations.length === 1) {
    const operation = operations[0]
    if (!operation) {
      return null
    }
    return (
      <div className="mb-6 p-4 bg-muted rounded-lg border border-border">
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 text-xs font-semibold rounded ${methodBadgeClass(operation.method)}`}>
            {operation.method}
          </span>
          <code className="text-sm font-mono text-foreground">
            {allSamePath ? (operation.summary || operation.id) : operation.path}
          </code>
          {!allSamePath && operation.summary && (
            <span className="text-sm text-muted-foreground">— {operation.summary}</span>
          )}
        </div>
      </div>
    )
  }

  // Multiple operations: render as dropdown
  return (
    <div className="mb-6">
      <label htmlFor="operation-select" className="block text-sm font-medium text-foreground mb-2">
        Select Endpoint
      </label>
      <select
        id="operation-select"
        value={selectedIndex}
        onChange={(e) => onSelect(Number(e.target.value))}
        className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus-visible:ring-ring/50 focus:border-primary bg-background"
      >
        {operations.map((operation, index) => (
          <option key={index} value={index}>
            {getOperationLabel(operation)}
          </option>
        ))}
      </select>
    </div>
  )
}
