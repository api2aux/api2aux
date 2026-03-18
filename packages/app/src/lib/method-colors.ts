/** Theme-aware method color classes (uses CSS custom properties) */
export const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
}

/** Theme-aware method badge classes (text + background) */
export const METHOD_BADGE: Record<string, string> = {
  GET: 'text-method-get bg-method-get-bg',
  POST: 'text-method-post bg-method-post-bg',
  PUT: 'text-method-put bg-method-put-bg',
  PATCH: 'text-method-patch bg-method-patch-bg',
  DELETE: 'text-method-delete bg-method-delete-bg',
}
