/**
 * Filter for structural/pagination parameters that should not participate
 * in semantic matching (schema-compat, name-similarity).
 *
 * These params control result shape (pagination, sorting, field selection),
 * not data flow between endpoints. Matching "heavy_atoms_count → limit"
 * because both are integers is pure noise.
 */

const PAGINATION_PARAMS = new Set([
  'limit',
  'page',
  'offset',
  'size',
  'pagesize',
  'page_size',
  'perpage',
  'per_page',
  'skip',
  'cursor',
  'after',
  'before',
  'pagenumber',
  'page_number',
  'top',
  'first',
  'last',
  'sort',
  'sortby',
  'sort_by',
  'order',
  'orderby',
  'order_by',
])

/** Returns true if the param name is a pagination/structural param that should be excluded from matching. */
export function isPaginationParam(name: string): boolean {
  return PAGINATION_PARAMS.has(name.toLowerCase())
}
