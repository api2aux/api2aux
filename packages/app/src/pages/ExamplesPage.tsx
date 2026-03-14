import { EXAMPLES, CATEGORIES } from '../data/examples'
import type { Example } from '../data/examples'
import { Badge } from '../components/ui/badge'

interface ExamplesPageProps {
  onExampleClick: (url: string, method?: string, body?: string) => void
  onBack: () => void
}

const typeBadgeClass: Record<string, string> = {
  Array: 'border-green-300 text-green-700 dark:text-green-400 dark:border-green-700',
  Object: 'border-border text-muted-foreground',
  OpenAPI: 'border-purple-300 text-purple-700 dark:text-purple-400 dark:border-purple-700',
}

function ExampleCard({ example, onClick }: { example: Example; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group p-4 border border-border rounded-lg text-left transition-all duration-150 hover:border-foreground/20 hover:shadow-sm hover:-translate-y-px bg-card w-full"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border ${typeBadgeClass[example.type] ?? ''}`}>
          {example.type}
        </span>
        {example.method && example.method !== 'GET' && (
          <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border border-blue-300 text-blue-700 dark:text-blue-400 dark:border-blue-700">
            {example.method}
          </span>
        )}
        <span className="text-sm font-medium text-foreground truncate">{example.title}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{example.description}</p>
      {example.features.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {example.features.map((feat) => (
            <span key={feat} className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
              {feat}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

export function ExamplesPage({ onExampleClick, onBack }: ExamplesPageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-2xl font-semibold text-foreground mb-1">Example APIs</h1>
          <p className="text-sm text-muted-foreground">
            Browse the full catalog of example APIs to explore different data types and renderers.
          </p>
        </div>

        {/* Categories */}
        <div className="space-y-8">
          {CATEGORIES.map(({ key, label }) => {
            const categoryExamples = EXAMPLES.filter((e) => e.category === key)
            if (categoryExamples.length === 0) return null
            return (
              <section key={key}>
                <h2 className="text-lg font-medium text-foreground mb-3">
                  {label}
                  {key === 'graphql' && (
                    <Badge variant="warning" className="ml-2 text-[10px] px-1.5 py-0">beta</Badge>
                  )}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categoryExamples.map((example) => (
                    <ExampleCard
                      key={example.url}
                      example={example}
                      onClick={() => onExampleClick(example.url, example.method, example.body)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
