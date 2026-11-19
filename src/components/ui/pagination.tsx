import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PAGE_SIZE_OPTIONS } from '@/lib/constants'
import { getPageItems } from '@/lib/pagination'
import { Select } from './select'
import { Button } from './button'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  className?: string
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  const items = getPageItems(safePage, totalPages)

  return (
    <div
      className={cn(
        'text-ink-500 flex flex-col items-center justify-between gap-3 text-sm sm:flex-row',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="numeric">
          {from}–{to} of {total}
        </span>
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5">
            <span className="text-ink-500">Rows</span>
            <Select
              className="h-8 w-20 py-0 pr-7 pl-2 text-xs"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>

      <nav className="flex items-center gap-1" aria-label="Pagination">
        <Button
          variant="outline"
          size="sm"
          className="px-2"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        {items.map((item) =>
          typeof item === 'number' ? (
            <Button
              key={item}
              variant={item === safePage ? 'primary' : 'ghost'}
              size="sm"
              className="numeric min-w-9 px-2"
              onClick={() => onPageChange(item)}
              aria-current={item === safePage ? 'page' : undefined}
            >
              {item}
            </Button>
          ) : (
            <span key={item} className="text-ink-400 px-1" aria-hidden>
              …
            </span>
          ),
        )}
        <Button
          variant="outline"
          size="sm"
          className="px-2"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </nav>
    </div>
  )
}
