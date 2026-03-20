import { inferSchema } from '../services/schema/inferrer'
import { useAppStore } from '../store/appStore'

/** Scroll the response data panel into view with a highlight flash. */
export function scrollToResponseData() {
  setTimeout(() => {
    const el = document.getElementById('response-data')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('highlight-flash')
      setTimeout(() => el.classList.remove('highlight-flash'), 1500)
    }
  }, 50)
}

/** Infer schema and push data to the main view. Returns false if inference fails. */
export function updateMainView(data: unknown, url: string): boolean {
  try {
    const schema = inferSchema(data, url)
    useAppStore.getState().fetchSuccess(data, schema)
    return true
  } catch (err) {
    console.error('[chatViewHelpers] Failed to update main view:', err instanceof Error ? err.message : String(err))
    return false
  }
}
