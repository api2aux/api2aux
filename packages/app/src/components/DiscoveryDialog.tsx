import { useMemo, useState } from 'react'
import { Dialog, DialogPanel, DialogTitle, Disclosure, DisclosureButton, DisclosurePanel, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { Radar, Loader2, CheckCircle, XCircle, ArrowRight } from 'lucide-react'
import { Progress } from './ui/progress'
import { METHOD_COLORS } from '../lib/method-colors'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import type { DiscoveryProgress } from '../hooks/useRuntimeDiscovery'
import type { DiscoveryResult } from '../services/discovery/runtimeDiscovery'
import type { RuntimeProbeResult, OperationEdge } from '@api2aux/workflow-inference'

type OpMap = Map<string, { path: string; method: string }>

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function EdgeRow({ edge, opMap }: { edge: OperationEdge; opMap: OpMap }) {
  const source = opMap.get(edge.sourceId)
  const target = opMap.get(edge.targetId)
  const pct = Math.round(edge.score * 100)

  return (
    <Disclosure>
      {({ open: edgeOpen }) => (
        <>
          <DisclosureButton className="flex flex-wrap items-center gap-x-2 gap-y-0.5 w-full px-3 py-1.5 rounded-lg hover:bg-muted/30 text-xs text-left">
            <span className="flex items-center gap-1.5 shrink-0">
              <span className={`font-mono font-bold shrink-0 ${METHOD_COLORS[source?.method ?? 'GET'] ?? METHOD_COLORS.GET}`}>
                {source?.method ?? '?'}
              </span>
              <span className="font-mono text-foreground">
                {source?.path ?? edge.sourceId}
              </span>
            </span>
            <span className="flex items-center gap-1.5 grow shrink-0">
              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className={`font-mono font-bold shrink-0 ${METHOD_COLORS[target?.method ?? 'GET'] ?? METHOD_COLORS.GET}`}>
                {target?.method ?? '?'}
              </span>
              <span className="font-mono text-foreground">
                {target?.path ?? edge.targetId}
              </span>
              <span className="text-muted-foreground ml-auto shrink-0 flex items-center gap-1">
                {pct}%
                <ChevronIcon open={edgeOpen} />
              </span>
            </span>
          </DisclosureButton>
          <DisclosurePanel className="ml-6 mr-3 mb-1 space-y-1">
            {edge.bindings.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-0.5">Bindings:</p>
                {edge.bindings.map((b, j) => (
                  <p key={j} className="font-mono pl-2">
                    {b.sourceField} → {b.targetParam} ({b.targetParamIn}){' '}
                    <span className="text-muted-foreground/60">{Math.round(b.confidence * 100)}%</span>
                  </p>
                ))}
              </div>
            )}
            {edge.signals.filter(s => s.matched).length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-0.5">Signals:</p>
                {edge.signals.filter(s => s.matched).map((s, j) => (
                  <p key={j} className="pl-2">
                    <span className="font-mono">{s.signal}</span>
                    <span className="text-muted-foreground/60 ml-1">w={s.weight.toFixed(2)}</span>
                    {s.detail && <span className="text-muted-foreground/60 ml-1">— {s.detail}</span>}
                  </p>
                ))}
              </div>
            )}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  )
}

function hasStaticSignal(edge: OperationEdge): boolean {
  return edge.signals.some(s => s.signal !== 'runtime-value-match' && s.matched)
}

function hasRuntimeSignal(edge: OperationEdge): boolean {
  return edge.signals.some(s => s.signal === 'runtime-value-match' && s.matched)
}

interface DiscoveryDialogProps {
  open: boolean
  onClose: () => void
  parsedSpec: ParsedAPI
  progress: DiscoveryProgress
  result: DiscoveryResult | null
  probeResults: RuntimeProbeResult[] | null
  edges: OperationEdge[] | null
  allEdges: OperationEdge[]
  onDiscover: () => void
  onCancel: () => void
}

export function DiscoveryDialog({
  open,
  onClose,
  parsedSpec,
  progress,
  result,
  probeResults,
  edges,
  allEdges,
  onDiscover,
  onCancel,
}: DiscoveryDialogProps) {
  const opMap = useMemo(() => {
    const m = new Map<string, { path: string; method: string }>()
    for (const op of parsedSpec.operations) {
      m.set(op.id, { path: op.path, method: op.method })
    }
    return m
  }, [parsedSpec.operations])

  const successCount = probeResults?.filter(p => p.success).length ?? 0
  const runtimeEdgeCount = edges?.length ?? 0

  const matchableTargetCount = useMemo(() => {
    return parsedSpec.operations.filter(op =>
      op.parameters.some(p => p.in === 'path' || (p.in === 'query' && p.required))
    ).length
  }, [parsedSpec.operations])

  const staticEdges = useMemo(() =>
    allEdges.filter(hasStaticSignal).sort((a, b) => b.score - a.score),
    [allEdges]
  )

  const runtimeEdges = useMemo(() =>
    allEdges.filter(hasRuntimeSignal).sort((a, b) => b.score - a.score),
    [allEdges]
  )

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      <div className="fixed inset-0 flex items-start justify-center pt-[10vh] px-4 pb-4">
        <DialogPanel className="max-w-2xl w-full bg-background rounded-xl shadow-2xl border border-border flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <Radar className="w-5 h-5" />
              Relations
            </DialogTitle>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <TabGroup defaultIndex={0} className="flex flex-col flex-1 min-h-0">
            <TabList className="flex gap-1 px-6 pb-2 border-b border-border shrink-0">
              <Tab className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors outline-none cursor-pointer data-[selected]:bg-muted data-[selected]:text-foreground text-muted-foreground hover:text-foreground">
                Runtime
              </Tab>
              <Tab className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors outline-none cursor-pointer data-[selected]:bg-muted data-[selected]:text-foreground text-muted-foreground hover:text-foreground">
                Static ({staticEdges.length})
              </Tab>
            </TabList>

            <TabPanels className="overflow-y-auto flex-1 min-h-0">
              {/* Runtime Discovery Tab */}
              <TabPanel className="px-6 py-4 space-y-4">
                {/* Idle state */}
                {progress.status === 'idle' && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Runtime discovery probes your API&apos;s GET endpoints with live requests to find
                      cross-resource relationships that can&apos;t be inferred from the spec alone.
                    </p>
                    {matchableTargetCount === 0 ? (
                      <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                        <p className="text-sm font-medium text-foreground">
                          Not applicable for this API
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Runtime discovery matches response values against path parameters and required query
                          parameters. This API&apos;s endpoints use only optional query filters, so runtime
                          probing won&apos;t find additional links.
                        </p>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {parsedSpec.operations.filter(op => op.method === 'GET').length} GET endpoints
                          available for probing, {matchableTargetCount} with matchable parameters.
                        </p>
                        <button
                          onClick={onDiscover}
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                          Start Discovery
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Running state */}
                {progress.status === 'running' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-sm font-medium">
                        Probing {progress.completed}/{progress.total}
                      </span>
                    </div>
                    <Progress value={progress.total > 0 ? (progress.completed / progress.total) * 100 : 0} />
                    {progress.currentPath && (
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {progress.currentPath}
                      </p>
                    )}
                    <button
                      onClick={onCancel}
                      className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Done state */}
                {progress.status === 'done' && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      <span>
                        Probed {successCount} endpoint{successCount !== 1 ? 's' : ''}, found{' '}
                        <span className="font-semibold">{runtimeEdgeCount} link{runtimeEdgeCount !== 1 ? 's' : ''}</span>
                      </span>
                    </div>

                    {/* Runtime edges */}
                    {runtimeEdges.length > 0 ? (
                      <div className="space-y-1">
                        {runtimeEdges.map((edge, i) => (
                          <EdgeRow key={`rt-${edge.sourceId}-${edge.targetId}-${i}`} edge={edge} opMap={opMap} />
                        ))}
                      </div>
                    ) : (
                      probeResults && probeResults.some(p => p.success) && (
                        <p className="text-sm text-muted-foreground italic">
                          No cross-resource links discovered.
                        </p>
                      )
                    )}

                    {/* Probes disclosure — diagnostic detail, below results */}
                    {probeResults && probeResults.length > 0 && (
                      <Disclosure>
                        <DisclosureButton className="flex items-center justify-between w-full text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {({ open: probesOpen }) => (
                            <>
                              Probes ({probeResults.length})
                              <ChevronIcon open={probesOpen} />
                            </>
                          )}
                        </DisclosureButton>
                        <DisclosurePanel className="mt-2 space-y-1">
                          {probeResults.map((probe) => {
                            const op = opMap.get(probe.operationId)
                            return (
                              <div
                                key={probe.operationId}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 text-xs"
                              >
                                {probe.success ? (
                                  <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                )}
                                {op && (
                                  <span className={`font-mono font-bold shrink-0 ${METHOD_COLORS[op.method] ?? METHOD_COLORS.GET}`}>
                                    {op.method}
                                  </span>
                                )}
                                <span className="font-mono text-foreground truncate">
                                  {op?.path ?? probe.operationId}
                                </span>
                              </div>
                            )
                          })}
                        </DisclosurePanel>
                      </Disclosure>
                    )}

                    <button
                      onClick={onDiscover}
                      className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                    >
                      Re-run Discovery
                    </button>
                  </div>
                )}

                {/* Error state */}
                {progress.status === 'error' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                      <span className="text-red-500">{progress.error}</span>
                    </div>
                    <button
                      onClick={onDiscover}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </TabPanel>

              {/* Static Discovery Tab */}
              <TabPanel className="px-6 py-4 space-y-1">
                {staticEdges.length > 0 ? (
                  staticEdges.map((edge, i) => (
                    <EdgeRow key={`${edge.sourceId}-${edge.targetId}-${i}`} edge={edge} opMap={opMap} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic px-3 py-1.5">
                    No static relations detected.
                  </p>
                )}
              </TabPanel>
            </TabPanels>
          </TabGroup>

          {/* Footer */}
          <div className="border-t border-border px-6 py-3 shrink-0 mt-auto">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors text-sm"
            >
              Done
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
