import { cn } from "@/lib/utils"

export function RosterList({
  roster,
  playerName,
}: {
  roster: { position: string; player_id: number | null }[]
  playerName: (id: number) => { name: string; detail: string }
}) {
  return (
    <ul className="flex flex-col gap-1">
      {roster.map((slot, i) => {
        const info = slot.player_id != null ? playerName(slot.player_id) : null
        return (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "w-10 shrink-0 rounded bg-muted py-0.5 text-center text-[11px] font-semibold text-muted-foreground",
                slot.position === "BN" && "bg-transparent",
              )}
            >
              {slot.position}
            </span>
            {info ? (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate font-medium">{info.name}</span>
                <span className="text-xs text-muted-foreground">{info.detail}</span>
              </span>
            ) : (
              <span className="text-muted-foreground/60">Empty</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
