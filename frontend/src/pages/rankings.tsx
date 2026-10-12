import { useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable } from "@/components/data-table"
import { PageError, PageLoading } from "@/components/page-state"
import { categoryColumns, PlayerCell, ValueText } from "@/components/player-cells"
import { matchesFilters, PlayerFilters, type PositionFilter } from "@/components/player-filters"
import { PuntToggles } from "@/components/punt-toggles"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { usePlayers, useUpdateSettings } from "@/hooks/queries"
import type { Player, ValueMode } from "@/lib/api"
import { lastSeasonSummary } from "@/lib/format"

export function RankingsPage() {
  const players = usePlayers()
  const updateSettings = useUpdateSettings()
  const [search, setSearch] = useState("")
  const [position, setPosition] = useState<PositionFilter>("ALL")

  const data = players.data
  const punts = useMemo(() => data?.punts ?? [], [data?.punts])
  const lastSeason = data?.last_season ?? ""

  const columns = useMemo<ColumnDef<Player, number>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        accessorFn: (p) => p.rank,
        sortDescFirst: false,
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
        meta: { className: "w-10 text-right" },
      },
      {
        id: "player",
        header: "Player",
        accessorFn: (p) => p.rank,
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original
          return (
            <PlayerCell
              name={p.name}
              team={p.team}
              positions={p.positions}
              injury={p.injury_status}
              title={lastSeasonSummary(p.last, lastSeason)}
            />
          )
        },
        meta: { className: "min-w-44" },
      },
      {
        id: "gp",
        header: "GP",
        accessorFn: (p) => p.proj.gp,
        cell: ({ getValue }) => getValue().toFixed(0),
        meta: { className: "w-10 text-right text-muted-foreground", title: "Projected games played" },
      },
      {
        id: "min",
        header: "MIN",
        accessorFn: (p) => p.proj.min,
        cell: ({ getValue }) => getValue().toFixed(1),
        meta: { className: "w-12 text-right text-muted-foreground", title: "Projected minutes per game" },
      },
      ...categoryColumns<Player>((p) => p.z, (p) => p.proj, punts),
      {
        id: "value",
        header: "Value",
        accessorFn: (p) => p.value,
        cell: ({ getValue }) => <ValueText value={getValue()} />,
        meta: { className: "w-16 text-right", title: "Sum of category z-scores (punted categories excluded)" },
      },
      {
        id: "adp",
        header: "ADP",
        accessorFn: (p) => p.adp ?? Infinity, // no ADP sorts last
        sortDescFirst: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground" title={row.original.adp_source ? `ADP source: ${row.original.adp_source}` : undefined}>
            {row.original.adp?.toFixed(1) ?? "—"}
          </span>
        ),
        meta: { className: "w-14 text-right", title: "Average draft position" },
      },
    ],
    [punts, lastSeason],
  )

  if (players.isPending) return <PageLoading />
  if (players.error || !data) return <PageError error={players.error} onRetry={() => players.refetch()} />

  const rows = data.players.filter((p) => matchesFilters(p, search, position))
  const busy = updateSettings.isPending || players.isFetching

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Player rankings</h1>
          <p className="text-sm text-muted-foreground">
            {data.season} ESPN projections · 9-cat values vs. the players who will be drafted · hover a stat for its
            z-score, a name for last season
          </p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={data.mode}
          onValueChange={(v) => v && updateSettings.mutate({ value_mode: v as ValueMode })}
        >
          <ToggleGroupItem value="per_game" title="Value per game played">
            Per game
          </ToggleGroupItem>
          <ToggleGroupItem value="total" title="Value over the season: rewards durable players">
            Season totals
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PlayerFilters search={search} onSearch={setSearch} position={position} onPosition={setPosition} />
        <PuntToggles punts={punts} disabled={busy} onChange={(next) => updateSettings.mutate({ punts: next })} />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(p) => String(p.id)}
        initialSorting={[{ id: "rank", desc: false }]}
        pageSize={150}
        className="max-h-[calc(100svh-13rem)]"
      />
    </div>
  )
}
