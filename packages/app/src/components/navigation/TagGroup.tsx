import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import type { Operation } from '@api2aux/semantic-analysis'
import type { Workflow } from '@api2aux/workflow-inference'
import { OperationItem } from './OperationItem'

interface TagGroupProps {
  tag: string
  operations: Operation[]
  operationIndices: number[]
  selectedIndex: number
  onSelect: (index: number) => void
  showNameInsteadOfPath?: boolean
  /** Map of operationId → workflows it participates in */
  operationWorkflows?: Map<string, Workflow[]>
}

export function TagGroup({ tag, operations, operationIndices, selectedIndex, onSelect, showNameInsteadOfPath, operationWorkflows }: TagGroupProps) {
  return (
    <Disclosure defaultOpen>
      {({ open }) => (
        <>
          <DisclosureButton className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-muted transition-colors">
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
          </DisclosureButton>
          <DisclosurePanel className="space-y-0.5">
            {operations.map((operation, localIndex) => (
              <OperationItem
                key={operationIndices[localIndex]}
                operation={operation}
                index={operationIndices[localIndex]!}
                isSelected={operationIndices[localIndex] === selectedIndex}
                onSelect={onSelect}
                showNameInsteadOfPath={showNameInsteadOfPath}
                workflows={operationWorkflows?.get(operation.id)}
              />
            ))}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  )
}
