import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { X, Copy, Check, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { methodBadgeClass } from '@/lib/method-colors'
import type { BuiltRequest } from '@api2aux/api-invoke'

interface RequestPreviewProps {
  request: BuiltRequest | null
  open: boolean
  onClose: () => void
}

function buildCurlCommand(request: BuiltRequest): string {
  const parts = ['curl']

  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`)
  }

  parts.push(`'${request.url}'`)

  for (const [key, value] of Object.entries(request.headers)) {
    parts.push(`-H '${key}: ${value}'`)
  }

  if (typeof request.body === 'string') {
    parts.push(`-d '${request.body}'`)
  }

  return parts.join(' \\\n  ')
}

export function RequestPreview({ request, open, onClose }: RequestPreviewProps) {
  const { copy: copyCurl, isCopied: isCurlCopied } = useCopyToClipboard()

  if (!request) return null

  const methodColor = methodBadgeClass(request.method)

  const headerEntries = Object.entries(request.headers)
  const curlCommand = buildCurlCommand(request)

  let prettyBody: string | null = null
  if (typeof request.body === 'string') {
    try {
      prettyBody = JSON.stringify(JSON.parse(request.body), null, 2)
    } catch {
      prettyBody = request.body
    }
  } else if (request.body instanceof FormData) {
    prettyBody = '[FormData]'
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto max-w-2xl w-full bg-card border border-border rounded-lg shadow-xl max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <DialogTitle className="text-lg font-semibold text-foreground">
              Request Preview
            </DialogTitle>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-muted text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto p-4 space-y-4 flex-1">
            {/* Method + URL */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">URL</h4>
              <div className="flex items-start gap-2 bg-muted rounded-md p-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold shrink-0 ${methodColor}`}>
                  {request.method}
                </span>
                <code className="text-sm font-mono text-foreground break-all">
                  {request.url}
                </code>
              </div>
            </div>

            {/* Headers */}
            {headerEntries.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Headers</h4>
                <div className="bg-muted rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {headerEntries.map(([key, value]) => (
                        <tr key={key} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-1.5 font-mono font-medium text-foreground whitespace-nowrap">
                            {key}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground break-all">
                            {value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Body */}
            {prettyBody && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Body</h4>
                <pre className="bg-muted rounded-md p-3 text-sm font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
                  {prettyBody}
                </pre>
              </div>
            )}

            {/* cURL */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  cURL
                </h4>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => copyCurl(curlCommand)}
                >
                  {isCurlCopied ? (
                    <><Check className="h-3 w-3 text-green-600" /> Copied</>
                  ) : (
                    <><Copy className="h-3 w-3" /> Copy</>
                  )}
                </Button>
              </div>
              <pre className="bg-muted rounded-md p-3 text-sm font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
                {curlCommand}
              </pre>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end p-4 border-t border-border">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
