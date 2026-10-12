import type { CategoryKey, DraftTeam } from "@/lib/api"
import { CATEGORIES, fmtSigned, ordinal } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Your team's total in each category vs. the league average, with your rank. */
export function CategoryProfile({
  team,
  leagueAvg,
  numTeams,
  punts,
  onTogglePunt,
}: {
  team: DraftTeam
  leagueAvg: Record<CategoryKey, number>
  numTeams: number
  punts: CategoryKey[]
  onTogglePunt?: (key: CategoryKey) => void
}) {
  const diffs = Object.fromEntries(CATEGORIES.map((c) => [c.key, team.cats[c.key] - leagueAvg[c.key]])) as Record<
    CategoryKey,
    number
  >
  const scale = Math.max(1.5, ...Object.values(diffs).map(Math.abs))

  return (
    <ul className="flex flex-col gap-1.5">
      {CATEGORIES.map((cat) => {
        const punted = punts.includes(cat.key)
        const diff = diffs[cat.key]
        const rank = team.ranks[cat.key]
        const width = `${(Math.abs(diff) / scale) * 50}%`
        return (
          <li key={cat.key} className={cn("grid grid-cols-[2.5rem_1fr_2.75rem_3rem] items-center gap-2 text-xs", punted && "opacity-50")}>
            <span className="font-medium">{cat.label}</span>
            <div
              className="relative h-2.5 rounded-full bg-muted"
              title={`${cat.label}: ${fmtSigned(diff, 1)} vs. league average`}
            >
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              {!punted && (
                <div
                  className={cn("absolute inset-y-0 rounded-full", diff >= 0 ? "left-1/2 bg-positive" : "right-1/2 bg-negative")}
                  style={{ width }}
                />
              )}
            </div>
            <span
              className={cn(
                "tabular text-right font-medium",
                !punted && rank <= 3 && "text-positive",
                !punted && rank > numTeams - 3 && "text-negative",
              )}
            >
              {punted ? "—" : ordinal(rank)}
            </span>
            {onTogglePunt ? (
              <button
                type="button"
                onClick={() => onTogglePunt(cat.key)}
                className={cn(
                  "rounded px-1 py-0.5 text-[11px] font-medium transition-colors",
                  punted ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {punted ? "Punted" : "Punt"}
              </button>
            ) : (
              <span />
            )}
          </li>
        )
      })}
    </ul>
  )
}
