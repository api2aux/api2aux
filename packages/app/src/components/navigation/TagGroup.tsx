import type { ReactNode } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
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
}

export function TagGroup({ tag, operations, operationIndices, selectedIndex, onSelect, showNameInsteadOfPath, renderRelated }: TagGroupProps) {
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
                  />
                  {renderRelated?.(globalIndex)}
                </div>
              )
            })}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  )
}
