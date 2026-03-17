import { Button } from '@/components/ui/button'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

interface URLPreviewProps {
  url: string
}

export function URLPreview({ url }: URLPreviewProps) {
  const [showPreview, setShowPreview] = useLocalStorage('url-preview-visible', false)
  const { copy, isCopied } = useCopyToClipboard()

  // Show the full URL — wrapping handles overflow

  return (
    <div className="border-t border-border pt-3 mt-4">
      <button
        type="button"
        onClick={() => setShowPreview(!showPreview)}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <svg
          className={`h-4 w-4 transition-transform ${showPreview ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        {showPreview ? 'Hide' : 'Show'} URL Preview
      </button>

      {showPreview && (
        <div className="mt-2 p-3 bg-muted rounded-md flex items-start gap-2">
          <code className="text-xs flex-1 text-foreground font-mono break-all">
            {url}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(url)}
            className="shrink-0"
          >
            {isCopied ? (
              <>
                <svg
                  className="h-4 w-4 mr-1 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4 mr-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
