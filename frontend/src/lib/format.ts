import type { CSSProperties } from "react"

import type { CategoryKey, StatLine } from "@/lib/api"

export const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "fg3m", label: "3PM" },
  { key: "fg_pct", label: "FG%" },
  { key: "ft_pct", label: "FT%" },
  { key: "tov", label: "TO" },
]

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<CategoryKey, string>

export const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const

export function fmtPct(value: number | null | undefined): string {
  if (value == null) return "—"
  return value.toFixed(3).replace(/^0/, "")
}

export function fmtStat(key: CategoryKey, line: StatLine): string {
  if (key === "fg_pct") return fmtPct(line.fg_pct)
  if (key === "ft_pct") return fmtPct(line.ft_pct)
  return line[key].toFixed(1)
}

export function statTitle(key: CategoryKey, line: StatLine, z: number): string {
  const zText = `z ${fmtSigned(z)}`
  if (key === "fg_pct") return `FG% ${fmtPct(line.fg_pct)} on ${line.fga.toFixed(1)} FGA · ${zText}`
  if (key === "ft_pct") return `FT% ${fmtPct(line.ft_pct)} on ${line.fta.toFixed(1)} FTA · ${zText}`
  return `${CATEGORY_LABEL[key]} ${line[key].toFixed(1)} · ${zText}`
}

export function fmtSigned(value: number, digits = 2): string {
  const s = value.toFixed(digits)
  return value > 0 ? `+${s}` : s
}

export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`
}

/** Green/red background whose strength follows the z-score. */
export function heatStyle(z: number, muted = false): CSSProperties | undefined {
  if (muted || Math.abs(z) < 0.15) return undefined
  const strength = Math.round(Math.min(Math.abs(z) / 2.5, 1) * 50)
  const color = z > 0 ? "var(--positive)" : "var(--negative)"
  return { backgroundColor: `color-mix(in oklch, ${color} ${strength}%, transparent)` }
}

export function lastSeasonSummary(line: StatLine | null, season: string): string {
  if (!line) return `No ${season} NBA stats`
  return `${season}: ${line.gp} GP · ${line.pts.toFixed(1)} pts · ${line.reb.toFixed(1)} reb · ${line.ast.toFixed(1)} ast · ${fmtPct(line.fg_pct)} FG · ${fmtPct(line.ft_pct)} FT`
}

/** Snake draft: odd rounds go 1..N, even rounds N..1. */
export function slotForPick(overall: number, numTeams: number): number {
  const round = Math.floor((overall - 1) / numTeams)
  const offset = (overall - 1) % numTeams
  return round % 2 === 0 ? offset + 1 : numTeams - offset
}
