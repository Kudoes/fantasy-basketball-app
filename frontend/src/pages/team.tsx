import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Link } from "react-router"

import { CategoryProfile } from "@/components/category-profile"
import { DataTable } from "@/components/data-table"
import { PageError, PageLoading } from "@/components/page-state"
import { categoryColumns, PlayerCell, ValueText } from "@/components/player-cells"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useDraftState, usePlayers } from "@/hooks/queries"
import type { Player } from "@/lib/api"

export function TeamPage() {
  const draft = useDraftState({ poll: false })
  const players = usePlayers()
  const punts = useMemo(() => draft.data?.settings.punts ?? [], [draft.data?.settings.punts])

  const columns = useMemo<ColumnDef<Player, number>[]>(
    () => [
      {
        id: "player",
        header: "Player",
        enableSorting: false,
        cell: ({ row }) => (
          <PlayerCell name={row.original.name} team={row.original.team} positions={row.original.positions} injury={row.original.injury_status} />
        ),
        meta: { className: "min-w-44" },
      },
      {
        id: "value",
        header: "Value",
        accessorFn: (p) => p.value,
        cell: ({ getValue }) => <ValueText value={getValue()} />,
        meta: { className: "w-16 text-right" },
      },
      ...categoryColumns<Player>((p) => p.z, (p) => p.proj, punts),
    ],
    [punts],
  )

  if (draft.isPending || players.isPending) return <PageLoading />
  if (!draft.data || draft.error) return <PageError error={draft.error} onRetry={() => draft.refetch()} />

  const state = draft.data
  const myTeam = state.teams.find((t) => t.is_mine)
  const byId = new Map((players.data?.players ?? []).map((p) => [p.id, p]))
  const roster = (myTeam?.player_ids ?? []).flatMap((id) => byId.get(id) ?? [])

  if (!myTeam || roster.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <h1 className="text-lg font-semibold">No team yet</h1>
        <p className="text-sm text-muted-foreground">
          Your roster shows up here once you've drafted. Head to the{" "}
          <Link to="/draft" className="text-primary underline-offset-4 hover:underline">
            Draft Room
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{myTeam.name}</h1>
          <p className="text-sm text-muted-foreground">
            {roster.length} players · projected values. Waivers, matchups and trades come after the draft.
          </p>
        </div>
        <DataTable columns={columns} data={roster} getRowId={(p) => String(p.id)} initialSorting={[{ id: "value", desc: true }]} />
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Category profile</CardTitle>
          <CardDescription>Your totals vs. the league average, with rank</CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryProfile team={myTeam} leagueAvg={state.league_avg} numTeams={state.settings.num_teams} punts={punts} />
        </CardContent>
      </Card>
    </div>
  )
}
