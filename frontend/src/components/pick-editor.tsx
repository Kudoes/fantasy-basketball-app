import { useState } from "react"
import { SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { PlayerCell, ValueText } from "@/components/player-cells"
import { matchesFilters, matchRank } from "@/components/player-filters"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useEditPick, type PickEdit } from "@/hooks/queries"
import type { DraftState, Player } from "@/lib/api"
import { slotForPick } from "@/lib/format"
import { cn } from "@/lib/utils"

const MAX_RESULTS = 8

/** Fix any pick on the board: fill it, replace the player, insert a missed pick, or remove it. */
export function PickEditor({
  overall,
  onClose,
  state,
  byId,
}: {
  overall: number | null
  onClose: () => void
  state: DraftState
  byId: Map<number, Player>
}) {
  return (
    <Dialog open={overall !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {overall !== null && <PickEditorBody key={overall} overall={overall} onClose={onClose} state={state} byId={byId} />}
      </DialogContent>
    </Dialog>
  )
}

function PickEditorBody({
  overall,
  onClose,
  state,
  byId,
}: {
  overall: number
  onClose: () => void
  state: DraftState
  byId: Map<number, Player>
}) {
  const editPick = useEditPick()
  const [search, setSearch] = useState("")
  const [insert, setInsert] = useState(false)

  const { num_teams: numTeams } = state.settings
  const pick = state.picks.find((p) => p.overall === overall)
  const team = state.teams.find((t) => t.slot === (pick?.team_slot ?? slotForPick(overall, numTeams)))
  const current = pick ? (byId.get(pick.player_id) ?? state.drafted_players[String(pick.player_id)]) : null
  const round = Math.floor((overall - 1) / numTeams) + 1

  const results = search.trim()
    ? state.available
        .flatMap((a) => {
          const p = byId.get(a.player_id)
          return p && matchesFilters(p, search, "ALL") ? [{ a, p }] : []
        })
        .sort((x, y) => matchRank(x.p.name, search) - matchRank(y.p.name, search))
        .slice(0, MAX_RESULTS)
    : []

  const run = (edit: PickEdit, message: string) =>
    editPick.mutate(edit, {
      onSuccess: () => {
        toast.success(message)
        onClose()
      },
    })

  const choose = (player: Player) => {
    if (!pick) run({ kind: "set", overall, playerId: player.id }, `#${overall}: ${player.name}`)
    else if (insert) run({ kind: "insert", overall, playerId: player.id }, `Inserted ${player.name} at #${overall}; later picks moved back`)
    else run({ kind: "replace", overall, playerId: player.id }, `#${overall} is now ${player.name}`)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Pick #{overall} · Round {round}
        </DialogTitle>
        <DialogDescription>{team?.is_mine ? "Your pick" : team?.name}</DialogDescription>
      </DialogHeader>

      {pick && current && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <PlayerCell name={current.name} team={current.team} positions={current.positions} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={editPick.isPending}
              onClick={() => run({ kind: "remove", overall, shift: false }, `Removed #${overall}; it's now empty`)}
            >
              Remove
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={editPick.isPending}
              title="Use when this pick was recorded twice: every later pick moves up one spot"
              onClick={() => run({ kind: "remove", overall, shift: true }, `Removed #${overall}; later picks moved up`)}
            >
              Remove &amp; move later picks up
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          {!pick ? "Who was picked here?" : insert ? "Who did you miss at this pick?" : "Replace with"}
        </span>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault()
                choose(results[0].p)
              }
            }}
            placeholder="Type a name, Enter picks the top match"
            className="pl-8"
          />
        </div>
        {pick && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={insert} onCheckedChange={setInsert} />
            <span>
              Missed a pick here: insert it and move this and later picks back one spot
            </span>
          </label>
        )}
        {results.length > 0 && (
          <ul className="flex max-h-72 flex-col overflow-y-auto rounded-lg border">
            {results.map(({ a, p }, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={editPick.isPending}
                  onClick={() => choose(p)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted",
                    i === 0 && "bg-muted/60",
                  )}
                >
                  <PlayerCell name={p.name} team={p.team} positions={p.positions} injury={p.injury_status} />
                  <span className="text-xs text-muted-foreground">
                    fit <ValueText value={a.fit} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {search.trim() && results.length === 0 && (
          <p className="text-sm text-muted-foreground">No available player matches "{search.trim()}".</p>
        )}
      </div>
    </>
  )
}
