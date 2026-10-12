import { useCallback, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ClockIcon, SparklesIcon, TrendingDownIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { CategoryProfile } from "@/components/category-profile"
import { DataTable } from "@/components/data-table"
import { PickEditor } from "@/components/pick-editor"
import { AvailabilityText, PairPlan, PlaybookPanel } from "@/components/playbook-panel"
import { PageError, PageLoading } from "@/components/page-state"
import { categoryColumns, PlaybookTag, PlayerCell, ValueText } from "@/components/player-cells"
import { matchesFilters, matchRank, PlayerFilters, type PositionFilter } from "@/components/player-filters"
import { RosterList } from "@/components/roster-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  useAddPick,
  useAddUnlistedPick,
  useDraftState,
  usePlaybook,
  usePlayers,
  useRemovePick,
  useUpdateSettings,
} from "@/hooks/queries"
import type { AvailablePlayer, CategoryKey, DraftState, Player, PlaybookBranch, SyncMode, SyncStatus } from "@/lib/api"
import { CATEGORY_LABEL, lastSeasonSummary, ordinal } from "@/lib/format"
import { planBranch, playerTags, type PlayerTag } from "@/lib/playbook"
import { cn } from "@/lib/utils"

interface BoardRow {
  a: AvailablePlayer
  p: Player
}

export function DraftPage() {
  const draft = useDraftState()
  const players = usePlayers()
  const updateSettings = useUpdateSettings()
  const addPick = useAddPick()
  const removePick = useRemovePick()
  const [search, setSearch] = useState("")
  const [position, setPosition] = useState<PositionFilter>("ALL")
  const [editing, setEditing] = useState<number | null>(null) // overall pick open in the editor
  const [tab, setTab] = useState("available")
  const playbookQuery = usePlaybook()
  const addUnlisted = useAddUnlistedPick()

  const state = draft.data
  const byId = useMemo(() => new Map((players.data?.players ?? []).map((p) => [p.id, p])), [players.data])
  const punts = useMemo(() => state?.settings.punts ?? [], [state?.settings.punts])
  const manual = state?.settings.sync_mode !== "yahoo"
  const canPick = manual && !state?.status.complete
  const following = state?.status.my_following_pick ?? null
  const { mutate: addPickMutate } = addPick
  const { mutate: removePickMutate } = removePick
  const recordPick = useCallback(
    (player: Player) =>
      addPickMutate(player.id, {
        onSuccess: ({ overall }) =>
          toast.success(`Recorded #${overall}: ${player.name}`, {
            duration: 4000,
            action: { label: "Undo", onClick: () => removePickMutate(overall) },
          }),
      }),
    [addPickMutate, removePickMutate],
  )
  const lastSeason = players.data?.last_season ?? ""
  const playbook = playbookQuery.data?.available ? playbookQuery.data : null
  const plan = state?.plan ?? null
  const branch = useMemo(() => (playbook ? planBranch(playbook, plan) : null), [playbook, plan])
  const tags = useMemo(
    () => (playbook ? playerTags(playbook, branch, byId) : new Map<number, PlayerTag>()),
    [playbook, branch, byId],
  )

  const columns = useMemo<ColumnDef<BoardRow, number>[]>(() => {
    const cols: ColumnDef<BoardRow, number>[] = []
    if (canPick) {
      cols.push({
        id: "draft",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Button size="xs" variant="outline" onClick={() => recordPick(row.original.p)} title="Record this pick">
            Draft
          </Button>
        ),
        meta: { className: "w-14" },
      })
    }
    cols.push(
      {
        id: "fit",
        header: "Fit",
        accessorFn: (r) => r.a.fit,
        cell: ({ row, getValue }) => (
          <span className="inline-flex items-center justify-end gap-1">
            {row.original.a.flags.includes("low_gp") && (
              <span title={`Projected ${row.original.a.gp.toFixed(0)} GP: fit discounted`}>
                <TriangleAlertIcon className="size-3.5 text-warning" />
              </span>
            )}
            <ValueText value={getValue()} />
          </span>
        ),
        meta: { className: "w-16 text-right", title: "Value re-weighted for your team's needs, minus a nudge if ADP says he'll still be there next time" },
      },
      {
        id: "player",
        header: "Player",
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original.p
          const tag = tags.get(p.id)
          return (
            <PlayerCell
              name={p.name}
              team={p.team}
              positions={p.positions}
              injury={p.injury_status}
              title={lastSeasonSummary(p.last, lastSeason)}
              extra={tag && <PlaybookTag {...tag} />}
            />
          )
        },
        meta: { className: "min-w-44" },
      },
      {
        id: "adp",
        header: "ADP",
        accessorFn: (r) => r.a.adp ?? Infinity, // no ADP sorts last
        sortDescFirst: false,
        cell: ({ row }) => <AdpCell row={row.original.a} following={following} />,
        meta: { className: "w-20 text-right", title: "Average draft position" },
      },
      {
        id: "value",
        header: "Value",
        accessorFn: (r) => r.a.value,
        cell: ({ getValue }) => <ValueText value={getValue()} className="font-medium text-muted-foreground" />,
        meta: { className: "w-14 text-right", title: "Value vs. the players still available (ignores your team)" },
      },
      ...categoryColumns<BoardRow>((r) => r.a.z, (r) => r.p.proj, punts),
    )
    return cols
  }, [canPick, punts, following, recordPick, lastSeason, tags])

  if (draft.isPending || players.isPending) return <PageLoading />
  if (!state || draft.error) return <PageError error={draft.error} onRetry={() => draft.refetch()} />

  const settings = state.settings
  const rows: BoardRow[] = state.available.flatMap((a) => {
    const p = byId.get(a.player_id)
    return p && matchesFilters(p, search, position) ? [{ a, p }] : []
  })
  const playerInfo = (id: number) => {
    const p = byId.get(id) ?? state.drafted_players[String(id)]
    return { name: p?.name ?? `Player ${id}`, detail: p ? `${p.team ?? "FA"} · ${p.positions.join("/")}` : "" }
  }
  const myTeam = state.teams.find((t) => t.is_mine) ?? null
  const togglePunt = (key: CategoryKey) =>
    updateSettings.mutate({ punts: punts.includes(key) ? punts.filter((k) => k !== key) : [...punts, key] })
  const lastPick = state.picks.at(-1)
  // Enter in the search box records the best name match (then best fit) for the team on the clock.
  const enterTarget =
    canPick && search.trim()
      ? rows.reduce<BoardRow | null>(
          (best, r) => (!best || matchRank(r.p.name, search) < matchRank(best.p.name, search) ? r : best),
          null,
        )
      : null
  const recordEnterTarget = () => {
    if (!enterTarget) return
    recordPick(enterTarget.p)
    setSearch("")
  }
  const recordUnlisted = () => {
    const name = search.trim()
    addUnlisted.mutate(
      { name },
      {
        onSuccess: ({ overall }) =>
          toast.success(`Recorded #${overall}: ${name} (unlisted)`, {
            duration: 4000,
            action: { label: "Undo", onClick: () => removePickMutate(overall) },
          }),
      },
    )
    setSearch("")
  }

  return (
    <div className="flex flex-col gap-4">
      {manual && <PickEditor overall={editing} onClose={() => setEditing(null)} state={state} byId={byId} />}
      <StatusBar
        state={state}
        onSyncMode={(mode) => updateSettings.mutate({ sync_mode: mode })}
        onUndo={
          manual && lastPick
            ? () => removePick.mutate(lastPick.overall)
            : undefined
        }
        undoLabel={lastPick ? `Undo #${lastPick.overall} (${playerInfo(lastPick.player_id).name})` : ""}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="available">Best available</TabsTrigger>
              {playbook && <TabsTrigger value="playbook">Playbook</TabsTrigger>}
              <TabsTrigger value="board">Draft board</TabsTrigger>
            </TabsList>
            <PlayerFilters
              search={search}
              onSearch={setSearch}
              position={position}
              onPosition={setPosition}
              onSubmit={canPick ? recordEnterTarget : undefined}
              hint={
                canPick && search.trim() ? (
                  <span className="text-xs text-muted-foreground">
                    {enterTarget ? (
                      <>
                        <kbd className="rounded border bg-muted px-1 font-sans">Enter</kbd> records{" "}
                        <b className="text-foreground">{enterTarget.p.name}</b>
                      </>
                    ) : (
                      <>
                        No available player matches.{" "}
                        <button
                          type="button"
                          onClick={recordUnlisted}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          title="For players the app has no projection for"
                        >
                          Record "{search.trim()}" as an unlisted player
                        </button>
                      </>
                    )}
                  </span>
                ) : undefined
              }
            />
          </div>
          <TabsContent value="available" className="mt-2">
            <DataTable
              columns={columns}
              data={rows}
              getRowId={(r) => String(r.p.id)}
              initialSorting={[{ id: "fit", desc: true }]}
              rowClassName={(r) => (state.recommendations.includes(r.p.id) ? "bg-primary/5" : undefined)}
              className="max-h-[calc(100svh-15rem)]"
              emptyMessage={search ? "No available players match." : "Everyone has been drafted."}
            />
          </TabsContent>
          {playbook && (
            <TabsContent value="playbook" className="mt-2">
              <PlaybookPanel
                playbook={playbook}
                plan={plan}
                branch={branch}
                state={state}
                byId={byId}
                onDraft={canPick ? recordPick : undefined}
                onTogglePunt={togglePunt}
                onChooseBranch={(id) => updateSettings.mutate({ playbook_branch: id })}
              />
            </TabsContent>
          )}
          <TabsContent value="board" className="mt-2">
            <DraftBoard state={state} playerInfo={playerInfo} onEditPick={manual ? setEditing : undefined} />
          </TabsContent>
        </Tabs>

        <aside className="flex flex-col gap-4 *:shrink-0 xl:sticky xl:top-20 xl:max-h-[calc(100svh-6rem)] xl:overflow-y-auto xl:pb-2">
          {!settings.my_slot && (
            <Card className="ring-2 ring-primary">
              <CardHeader>
                <CardTitle>Which draft slot are you?</CardTitle>
                <CardDescription>
                  Needed for your turn and recommendations. Importing from Yahoo on the{" "}
                  <Link to="/league" className="text-primary underline-offset-4 hover:underline">
                    League page
                  </Link>{" "}
                  fills this in automatically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SlotSelect numTeams={settings.num_teams} onChange={(slot) => updateSettings.mutate({ my_slot: slot })} />
              </CardContent>
            </Card>
          )}

          {playbook && (
            <PlaybookSummary branch={branch} state={state} onOpen={() => setTab("playbook")} />
          )}

          <Recommendations
            state={state}
            rows={state.recommendations.flatMap((id) => {
              const a = state.available.find((r) => r.player_id === id)
              const p = byId.get(id)
              return a && p ? [{ a, p }] : []
            })}
            onDraft={canPick ? recordPick : undefined}
          />

          {state.punt_suggestions.length > 0 && (
            <Card size="sm" className="ring-warning/60">
              <CardContent className="flex flex-col gap-2">
                {state.punt_suggestions.map((s) => (
                  <div key={s.cat} className="flex items-center gap-3">
                    <TriangleAlertIcon className="size-4 shrink-0 text-warning" />
                    <p className="flex-1 text-sm">
                      You're {ordinal(s.rank)} in <b>{CATEGORY_LABEL[s.cat]}</b>. Punting it would let the board chase
                      your strengths.
                    </p>
                    <Button size="xs" variant="outline" onClick={() => togglePunt(s.cat)}>
                      Punt {CATEGORY_LABEL[s.cat]}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Your build</CardTitle>
              <CardDescription>Category totals vs. the league average, with your rank</CardDescription>
            </CardHeader>
            <CardContent>
              {myTeam && myTeam.player_ids.length > 0 ? (
                <CategoryProfile
                  team={myTeam}
                  leagueAvg={state.league_avg}
                  numTeams={settings.num_teams}
                  punts={punts}
                  onTogglePunt={togglePunt}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Your category profile appears after your first pick.</p>
              )}
            </CardContent>
          </Card>

          {state.my_team && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Your roster</CardTitle>
              </CardHeader>
              <CardContent>
                <RosterList roster={state.my_team.roster} playerName={playerInfo} />
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Recent picks</CardTitle>
              {manual && <CardDescription>Click a pick to fix it; the Draft board tab has every pick.</CardDescription>}
            </CardHeader>
            <CardContent>
              {state.picks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No picks yet.</p>
              ) : (
                <ol className="flex flex-col gap-1 text-sm">
                  {state.picks
                    .slice(-8)
                    .reverse()
                    .map((pick) => {
                      const team = state.teams.find((t) => t.slot === pick.team_slot)
                      return (
                        <li key={pick.overall}>
                          <button
                            type="button"
                            disabled={!manual}
                            onClick={() => setEditing(pick.overall)}
                            className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-baseline gap-2 rounded px-1.5 py-0.5 text-left enabled:hover:bg-muted"
                          >
                            <span className="tabular w-8 shrink-0 text-right text-xs text-muted-foreground">
                              #{pick.overall}
                            </span>
                            <span className="truncate font-medium">{playerInfo(pick.player_id).name}</span>
                            <span className={cn("ml-auto shrink-0 truncate text-xs text-muted-foreground", team?.is_mine && "font-medium text-primary")}>
                              {team?.is_mine ? "You" : team?.name}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function AdpCell({ row, following }: { row: AvailablePlayer; following: number | null }) {
  if (row.adp == null) return <span className="text-muted-foreground">—</span>
  const wait = row.flags.includes("wait")
  const falling = row.flags.includes("falling")
  return (
    <span
      className="inline-flex items-center justify-end gap-1 text-muted-foreground"
      title={
        wait
          ? `ADP ${row.adp.toFixed(1)}: likely still available at your pick #${following}`
          : falling
            ? `ADP ${row.adp.toFixed(1)}: falling past where he usually goes`
            : undefined
      }
    >
      {wait && <ClockIcon className="size-3.5 text-warning" />}
      {falling && <TrendingDownIcon className="size-3.5 text-positive" />}
      {row.adp.toFixed(1)}
    </span>
  )
}

function StatusBar({
  state,
  onSyncMode,
  onUndo,
  undoLabel,
}: {
  state: DraftState
  onSyncMode: (mode: SyncMode) => void
  onUndo?: () => void
  undoLabel: string
}) {
  const s = state.status
  const onClock = state.teams.find((t) => t.slot === s.on_clock_slot)
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3",
        s.is_my_turn && "border-primary bg-primary/5",
      )}
    >
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">
          {s.complete ? "Draft" : `Round ${s.round} · Pick ${s.pick_in_round}`}
        </span>
        <span className="font-semibold">
          {s.complete ? "Complete" : `#${s.current_pick} overall${onClock?.is_mine ? "" : ` · ${onClock?.name} on the clock`}`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {s.complete ? (
          <Link to="/team" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            See your team →
          </Link>
        ) : s.is_my_turn ? (
          <span className="flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary-foreground" />
            </span>
            You're on the clock
          </span>
        ) : s.my_next_pick ? (
          <span className="text-sm">
            You pick in <b className="text-base">{s.picks_until_my_turn}</b>{" "}
            <span className="text-muted-foreground">(#{s.my_next_pick})</span>
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <SyncIndicator mode={state.settings.sync_mode} sync={state.sync} />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={state.settings.sync_mode}
          onValueChange={(v) => v && onSyncMode(v as SyncMode)}
        >
          <ToggleGroupItem value="manual" title="Click Draft to record each pick yourself">
            Manual
          </ToggleGroupItem>
          <ToggleGroupItem value="yahoo" title="Pull picks from your Yahoo draft room every few seconds">
            Yahoo live
          </ToggleGroupItem>
        </ToggleGroup>
        {onUndo && (
          <Button variant="ghost" size="sm" onClick={onUndo} title={undoLabel}>
            <Undo2Icon /> Undo
          </Button>
        )}
      </div>
    </div>
  )
}

function SyncIndicator({ mode, sync }: { mode: SyncMode; sync: SyncStatus }) {
  if (mode === "manual") {
    return <span className="text-xs text-muted-foreground">Manual: click Draft for every pick</span>
  }
  const fresh = sync.last_draft_sync && Date.now() - Date.parse(sync.last_draft_sync) < 20_000
  const [dot, label] = sync.last_error
    ? ["bg-warning", "Sync problem"]
    : fresh
      ? ["bg-positive", "Live"]
      : ["bg-muted-foreground/50", "Connecting…"]
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium" title={sync.last_error ?? undefined}>
      <span className={cn("size-2 rounded-full", dot, fresh && !sync.last_error && "animate-pulse")} />
      {label}
      {sync.last_error && <span className="max-w-60 truncate font-normal text-muted-foreground">{sync.last_error}</span>}
    </span>
  )
}

function Recommendations({
  state,
  rows,
  onDraft,
}: {
  state: DraftState
  rows: BoardRow[]
  onDraft?: (player: Player) => void
}) {
  const s = state.status
  return (
    <Card className={cn(s.is_my_turn && "ring-2 ring-primary")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          {s.is_my_turn ? "Take one of these" : "Best fits for your next pick"}
        </CardTitle>
        <CardDescription>
          {s.my_next_pick
            ? `Your pick: #${s.my_next_pick}${s.my_following_pick ? `, then #${s.my_following_pick}` : ""}`
            : "Set your draft slot to tailor these"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No players left.</p>}
        {rows.map(({ a, p }, i) => (
          <div key={p.id} className="flex items-start gap-3 rounded-lg border p-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <PlayerCell name={p.name} team={p.team} positions={p.positions} injury={p.injury_status} />
                <span className="text-right text-xs text-muted-foreground">
                  fit <ValueText value={a.fit} className="text-sm" />
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {a.boosts.map((k) => (
                  <Badge key={k} variant="secondary" className="bg-positive/15 text-positive">
                    ▲ {CATEGORY_LABEL[k]}
                  </Badge>
                ))}
                {a.hurts.map((k) => (
                  <Badge key={k} variant="secondary" className="bg-negative/15 text-negative">
                    ▼ {CATEGORY_LABEL[k]}
                  </Badge>
                ))}
                {a.flags.includes("wait") && (
                  <Badge variant="outline" title="ADP says he should still be there at your following pick">
                    <ClockIcon /> Likely there at #{s.my_following_pick}
                  </Badge>
                )}
                {a.flags.includes("low_gp") && (
                  <Badge variant="outline" className="text-warning" title="Fit is discounted for games he's projected to miss">
                    <TriangleAlertIcon /> Proj. {a.gp.toFixed(0)} GP
                  </Badge>
                )}
                {a.flags.includes("falling") && (
                  <Badge variant="outline" className="text-positive">
                    <TrendingDownIcon /> Falling (ADP {a.adp?.toFixed(0)})
                  </Badge>
                )}
              </div>
            </div>
            {onDraft && (
              <Button size="xs" onClick={() => onDraft(p)}>
                Draft
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function SlotSelect({ numTeams, onChange }: { numTeams: number; onChange: (slot: number) => void }) {
  return (
    <Select onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-40">
        <SelectValue placeholder="Pick your slot" />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: numTeams }, (_, i) => i + 1).map((slot) => (
          <SelectItem key={slot} value={String(slot)}>
            Slot {slot}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function DraftBoard({
  state,
  playerInfo,
  onEditPick,
}: {
  state: DraftState
  playerInfo: (id: number) => { name: string; detail: string }
  onEditPick?: (overall: number) => void
}) {
  const { num_teams: n, rounds } = state.settings
  const picks = new Map(state.picks.map((p) => [p.overall, p]))
  const teams = [...state.teams].sort((a, b) => a.slot - b.slot)
  return (
    <div className="max-h-[calc(100svh-15rem)] overflow-auto rounded-lg border">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="border-b bg-muted/95 px-2 py-2 text-left font-medium text-muted-foreground">Rd</th>
            {teams.map((t) => (
              <th
                key={t.slot}
                className={cn(
                  "min-w-28 border-b bg-muted/95 px-2 py-2 text-left font-medium whitespace-nowrap text-muted-foreground",
                  t.is_mine && "text-primary",
                )}
              >
                {t.slot}. {t.is_mine ? "You" : t.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
            <tr key={round}>
              <td className="border-b border-border/60 px-2 py-1.5 text-muted-foreground">{round}</td>
              {teams.map((t) => {
                const overall = (round - 1) * n + (round % 2 === 1 ? t.slot : n - t.slot + 1)
                const pick = picks.get(overall)
                const info = pick ? playerInfo(pick.player_id) : null
                const current = state.status.current_pick === overall
                return (
                  <td
                    key={t.slot}
                    className={cn(
                      "border-b border-border/60 p-0 align-top",
                      t.is_mine && "bg-primary/5",
                      current && "outline-2 -outline-offset-2 outline-primary",
                    )}
                  >
                    <button
                      type="button"
                      disabled={!onEditPick}
                      onClick={() => onEditPick?.(overall)}
                      title={onEditPick ? `Edit pick #${overall}` : undefined}
                      className="block h-full w-full px-2 py-1.5 text-left enabled:hover:bg-muted"
                    >
                      {info ? (
                        <div className="leading-tight">
                          <div className="truncate font-medium">{info.name}</div>
                          <div className="text-muted-foreground">{info.detail}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50">#{overall}</span>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlaybookSummary({
  branch,
  state,
  onOpen,
}: {
  branch: PlaybookBranch | null
  state: DraftState
  onOpen: () => void
}) {
  const plan = state.plan
  if (!plan) return null
  const names = new Map(plan.suggestions.map((s) => [s.player_id, s.name]))
  const alert = plan.alerts.find((a) => a.level === "warn") ?? plan.alerts.find((a) => a.level === "plan")
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{branch ? `Playbook · ${branch.id}: ${branch.name}` : "Playbook · your pick #9"}</span>
          <Button size="xs" variant="ghost" onClick={onOpen}>
            Open
          </Button>
        </CardTitle>
        <CardDescription>{branch ? `Live plan for #${plan.next_pick ?? "—"}` : "The analysis's order for your first pick"}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {plan.pair && <PairPlan pair={plan.pair} names={names} />}
        {alert && (
          <p className={cn("flex gap-1.5 text-xs", alert.level === "warn" ? "text-warning" : "text-primary")}>
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="text-foreground">{alert.text}</span>
          </p>
        )}
        {plan.suggestions.slice(0, 3).map((s) => (
          <div key={s.player_id} className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{s.name}</span>
            <AvailabilityText avail={{ kind: s.availability }} />
          </div>
        ))}
        {plan.suggestions.length === 0 && <p className="text-muted-foreground">No suggestions right now.</p>}
      </CardContent>
    </Card>
  )
}
