import { useMemo } from 'react'

export interface UsePaginationProps {
  totalItems: number
  itemsPerPage: number
  currentPage: number
}

export interface UsePaginationReturn {
  currentPage: number    // Clamped to valid range [1, totalPages]
  totalPages: number     // Math.ceil(totalItems / itemsPerPage)
  firstIndex: number     // (currentPage - 1) * itemsPerPage
  lastIndex: number      // Math.min(firstIndex + itemsPerPage, totalItems)
  hasNextPage: boolean
  hasPrevPage: boolean
  pageNumbers: (number | '...')[]  // Smart truncation array
}

export function usePagination({
  totalItems,
  itemsPerPage,
  currentPage,
}: UsePaginationProps): UsePaginationReturn {
  const totalPages = Math.ceil(totalItems / itemsPerPage)

  // Clamp currentPage to valid range [1, totalPages] (or 1 when empty)
  const validPage = totalPages === 0 ? 1 : Math.max(1, Math.min(currentPage, totalPages))

  // Smart page number truncation — must be called unconditionally (rules of hooks)
  const pageNumbers = useMemo(() => {
    if (totalPages === 0) return []

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    // Show first page, last page, current +/- 1, with '...' ellipses where gaps exist
    const pages: (number | '...')[] = []

    pages.push(1)

    const showLeftEllipsis = validPage > 3
    const showRightEllipsis = validPage < totalPages - 2

    if (showLeftEllipsis) pages.push('...')

    const start = Math.max(2, validPage - 1)
    const end = Math.min(totalPages - 1, validPage + 1)
    for (let i = start; i <= end; i++) pages.push(i)

    if (showRightEllipsis) pages.push('...')

    if (totalPages > 1) pages.push(totalPages)

    return pages
  }, [totalPages, validPage])

  if (totalPages === 0) {
    return {
      currentPage: 1,
      totalPages: 0,
      firstIndex: 0,
      lastIndex: 0,
      hasNextPage: false,
      hasPrevPage: false,
      pageNumbers: [],
    }
  }

  const firstIndex = (validPage - 1) * itemsPerPage
  const lastIndex = Math.min(firstIndex + itemsPerPage, totalItems)

  return {
    currentPage: validPage,
    totalPages,
    firstIndex,
    lastIndex,
    hasNextPage: validPage < totalPages,
    hasPrevPage: validPage > 1,
    pageNumbers,
  }
}
