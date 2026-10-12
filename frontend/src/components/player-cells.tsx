import type { ReactNode } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import type { CategoryKey, StatLine } from "@/lib/api"
import { CATEGORIES, fmtSigned, fmtStat, heatStyle, statTitle } from "@/lib/format"
import { cn } from "@/lib/utils"

const INJURY_LABELS: Record<string, { label: string; className: string }> = {
  OUT: { label: "OUT", className: "bg-negative/15 text-negative" },
  DAY_TO_DAY: { label: "DTD", className: "bg-warning/20 text-foreground" },
  SUSPENSION: { label: "SUSP", className: "bg-negative/15 text-negative" },
}

export function InjuryBadge({ status }: { status: string | null }) {
  if (!status || status === "ACTIVE") return null
  const info = INJURY_LABELS[status] ?? { label: status.slice(0, 4), className: "bg-warning/20 text-foreground" }
  return (
    <Badge variant="secondary" className={cn("h-4 rounded px-1 text-[10px] font-semibold", info.className)}>
      {info.label}
    </Badge>
  )
}

export function PlayerCell({
  name,
  team,
  positions,
  injury,
  title,
  extra,
}: {
  name: string
  team: string | null
  positions: string[]
  injury?: string | null
  title?: string
  /** Extra labels after the name, e.g. playbook tags. */
  extra?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col leading-tight" title={title}>
      <span className="flex items-center gap-1.5 font-medium whitespace-nowrap">
        {name}
        <InjuryBadge status={injury ?? null} />
        {extra}
      </span>
      <span className="text-xs text-muted-foreground">
        {team ?? "FA"} · {positions.join("/") || "—"}
      </span>
    </div>
  )
}

export function ValueText({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("font-semibold", value > 0 ? "text-positive" : value < 0 ? "text-negative" : "", className)}>
      {fmtSigned(value, 1)}
    </span>
  )
}

/** One column per category: shows the projected stat, shaded by its z-score. */
export function categoryColumns<T>(
  getZ: (row: T) => Record<CategoryKey, number>,
  getLine: (row: T) => StatLine,
  punts: CategoryKey[],
): ColumnDef<T, number>[] {
  return CATEGORIES.map((cat) => {
    const punted = punts.includes(cat.key)
    return {
      id: cat.key,
      header: cat.label,
      accessorFn: (row: T) => getZ(row)[cat.key],
      cell: ({ row }) => {
        const z = getZ(row.original)[cat.key]
        const line = getLine(row.original)
        return (
          <div
            className={cn("-mx-2 -my-1.5 px-2 py-1.5 text-right", punted && "text-muted-foreground/50")}
            style={heatStyle(z, punted)}
            title={statTitle(cat.key, line, z)}
          >
            {fmtStat(cat.key, line)}
          </div>
        )
      },
      meta: { className: "w-16 text-right", title: punted ? `${cat.label} (punted)` : `Sort by ${cat.label} value` },
    }
  })
}

const TAG_STYLES = {
  target: "bg-primary/12 text-primary",
  avoid: "bg-negative/15 text-negative",
  fade: "bg-negative/15 text-negative",
  sleeper: "bg-positive/15 text-positive",
} as const

export function PlaybookTag({ kind, label, detail }: { kind: keyof typeof TAG_STYLES; label: string; detail: string }) {
  return (
    <Badge variant="secondary" title={`Playbook: ${detail}`} className={cn("h-4 rounded px-1 text-[10px] font-semibold", TAG_STYLES[kind])}>
      {label}
    </Badge>
  )
}
