export type PageItem = number | 'start-ellipsis' | 'end-ellipsis'

/**
 * Compact page list with ellipses, e.g. 1 … 4 5 6 … 20.
 * Keeps at most seven numeric targets visible on narrow screens.
 */
export function getPageItems(current: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const items: PageItem[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  if (start > 2) items.push('start-ellipsis')
  for (let page = start; page <= end; page += 1) items.push(page)
  if (end < total - 1) items.push('end-ellipsis')
  items.push(total)

  return items
}
