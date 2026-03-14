import { FEATURED_EXAMPLES, type Example } from '../data/examples'
import { Badge } from './ui/badge'

interface ExamplesCarouselProps {
  onExampleClick: (url: string, method?: string, body?: string) => Promise<void>
  loading: boolean
  loadingUrl?: string | null
}

const typeLabel: Record<string, { text: string; className: string }> = {
  Array: { text: 'Array', className: 'text-green-600 dark:text-green-400' },
  Object: { text: 'Object', className: 'text-muted-foreground' },
  OpenAPI: { text: 'OpenAPI', className: 'text-purple-600 dark:text-purple-400' },
}

function FeatureCard({
  example,
  onClick,
  disabled,
  isLoading,
}: {
  example: Example
  onClick: () => void
  disabled: boolean
  isLoading: boolean
}) {
  const type = typeLabel[example.type] ?? typeLabel['Object']!

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative flex-none w-[160px] p-3 rounded-xl text-left transition-all duration-150 hover:bg-muted/60 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed group"
      style={{ scrollSnapAlign: 'start' }}
    >
      <div className="text-[13px] font-medium text-foreground leading-tight mb-0.5">{example.title}</div>
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-medium ${type.className}`}>{type.text}</span>
        {example.method && example.method !== 'GET' && (
          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">{example.method}</span>
        )}
        {example.category === 'graphql' && (
          <Badge variant="warning" className="text-[9px] px-1 py-0 rounded">beta</Badge>
        )}
      </div>

      {isLoading && (
        <div className="absolute inset-0 bg-background/70 rounded-xl flex items-center justify-center">
          <svg className="animate-spin h-4 w-4 text-foreground" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
    </button>
  )
}

export function ExamplesCarousel({ onExampleClick, loading, loadingUrl }: ExamplesCarouselProps) {
  return (
    <div className="w-full max-w-4xl">
      {/* Label row */}
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Try an example</span>
        <button
          onClick={() => {
            window.location.hash = '#/examples'
            window.dispatchEvent(new HashChangeEvent('hashchange'))
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all &rarr;
        </button>
      </div>

      {/* Scrollable row — hidden scrollbar */}
      <style>{`.examples-carousel::-webkit-scrollbar { display: none; }`}</style>
      <div className="relative -mx-1">
        <div
          className="examples-carousel overflow-x-auto scroll-smooth px-1"
          style={{
            scrollSnapType: 'x proximity',
            scrollbarWidth: 'none',
          }}
        >
          <div className="inline-flex gap-1">
            {FEATURED_EXAMPLES.map((example) => (
              <FeatureCard
                key={example.url}
                example={example}
                onClick={() => onExampleClick(example.url, example.method, example.body)}
                disabled={loading}
                isLoading={loadingUrl === example.url && loading}
              />
            ))}
          </div>
        </div>
        {/* Right fade gradient */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-background to-transparent" />
      </div>
    </div>
  )
}
