import { useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ColumnMetaInfo {
  className?: string
  title?: string
}

interface DataTableProps<T> {
  columns: ColumnDef<T, any>[]
  data: T[]
  getRowId: (row: T) => string
  initialSorting?: SortingState
  rowClassName?: (row: T) => string | undefined
  pageSize?: number
  emptyMessage?: string
  className?: string
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  initialSorting = [],
  rowClassName,
  pageSize = 100,
  emptyMessage = "No players match.",
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [limit, setLimit] = useState(pageSize)
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
    sortDescFirst: true,
  })
  const rows = table.getRowModel().rows

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColumnMetaInfo | undefined
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      title={meta?.title}
                      className={cn(
                        "border-b bg-muted/95 px-2 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground backdrop-blur",
                        meta?.className,
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-0.5 hover:text-foreground",
                            sorted && "text-foreground",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" && <ArrowUpIcon className="size-3" />}
                          {sorted === "desc" && <ArrowDownIcon className="size-3" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row) => (
              <tr key={row.id} className={cn("group/row hover:bg-muted/50", rowClassName?.(row.original))}>
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as ColumnMetaInfo | undefined
                  return (
                    <td key={cell.id} className={cn("border-b border-border/60 px-2 py-1.5", meta?.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <Button variant="ghost" size="sm" className="mt-2 self-center" onClick={() => setLimit((n) => n + pageSize)}>
          Show {Math.min(pageSize, rows.length - limit)} more
        </Button>
      )}
    </div>
  )
}
