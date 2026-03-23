// Local development: import from the built dist
import { createClient, corsProxy } from '../../dist/index.js'
// After publishing to npm, use a CDN instead (also update the import map in index.html):
// import { createClient, corsProxy } from 'https://esm.sh/api-invoke'

const btn = document.getElementById('fetch-btn')
const output = document.getElementById('output')
const meta = document.getElementById('meta')

// Create client once (reused across clicks)
let client
try {
  client = await createClient(
    'https://v2.jokeapi.dev/joke/Programming?type=single',
    {
      middleware: [
        // Route requests through a public CORS proxy.
        // In production, use your own proxy server.
        corsProxy({
          rewrite: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        }),
      ],
    },
  )
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  output.textContent = `Failed to load API: ${message}`
  btn.disabled = true
}

btn.addEventListener('click', async () => {
  if (!client) return
  output.textContent = 'Loading...'
  meta.textContent = ''

  try {
    const result = await client.execute('get_joke_Programming')

    const data = result.data
    if (data && typeof data === 'object' && !data.error) {
      output.textContent = data.joke ?? `${data.setup}\n\n${data.delivery}`
    } else {
      output.textContent = `API error: ${data?.message ?? 'unexpected response'}`
    }
    meta.textContent = `Status: ${result.status} | ${result.elapsedMs}ms`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    output.textContent = `Error: ${message}`
    meta.textContent = 'The CORS proxy may be unavailable. Try again or use a different proxy.'
  }
})
