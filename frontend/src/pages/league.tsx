import { useState } from "react"
import { CheckCircle2Icon, CircleIcon, RefreshCwIcon } from "lucide-react"

import { PageError, PageLoading } from "@/components/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  useLeague,
  useRenameTeam,
  useResetDraft,
  useSyncData,
  useSyncYahoo,
  useUpdateSettings,
} from "@/hooks/queries"
import type { LeagueResponse } from "@/lib/api"

function when(iso: string | null): string {
  if (!iso) return "never"
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      {done ? (
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-positive" />
      ) : (
        <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <span className={done ? "text-muted-foreground" : undefined}>{children}</span>
    </li>
  )
}

export function LeaguePage() {
  const league = useLeague()
  if (league.isPending) return <PageLoading />
  if (league.error || !league.data) return <PageError error={league.error} onRetry={() => league.refetch()} />
  return <LeagueView data={league.data} />
}

function LeagueView({ data }: { data: LeagueResponse }) {
  const updateSettings = useUpdateSettings()
  const syncYahoo = useSyncYahoo()
  const syncData = useSyncData()
  const resetDraft = useResetDraft()
  const renameTeam = useRenameTeam()
  const [leagueId, setLeagueId] = useState(data.league_id)
  const { connection: conn, settings, yahoo } = data
  const unmatched = syncYahoo.data?.players_unmatched ?? []

  return (
    <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <h1 className="text-xl font-semibold tracking-tight">League</h1>
        <p className="text-sm text-muted-foreground">Connect Yahoo, check your draft settings, and refresh data.</p>
      </div>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Yahoo league</CardTitle>
          <CardDescription>
            {yahoo
              ? `${yahoo.name} · ${yahoo.num_teams} teams · draft ${yahoo.draft_status}${yahoo.draft_time ? ` · ${new Date(yahoo.draft_time * 1000).toLocaleString()}` : ""}`
              : "Import settings, teams, your draft slot and Yahoo ADP."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <ol className="flex flex-col gap-2 text-sm">
            <Step done={conn.credentials}>
              Copy <code>.env.example</code> to <code>.env</code> and add your Yahoo Client ID and Secret.
            </Step>
            <Step done={conn.token}>
              In a terminal, run <code>npm run yahoo:login</code>, approve access, and paste the code Yahoo shows.
            </Step>
            <Step done={Boolean(yahoo)}>Import the league below.</Step>
          </ol>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">League ID</span>
              <div className="flex gap-2">
                <Input value={leagueId} onChange={(e) => setLeagueId(e.target.value.trim())} className="w-40" inputMode="numeric" />
                <Button
                  variant="outline"
                  disabled={leagueId === data.league_id || !/^\d+$/.test(leagueId)}
                  onClick={() => updateSettings.mutate({ league_id: leagueId })}
                >
                  Save
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">
                Use a mock draft's league ID to rehearse, then switch back.
              </span>
            </label>
            <Button className="self-start" disabled={!conn.token || syncYahoo.isPending} onClick={() => syncYahoo.mutate()}>
              <RefreshCwIcon className={syncYahoo.isPending ? "animate-spin" : undefined} />
              {yahoo ? "Re-import from Yahoo" : "Import league"}
            </Button>
            {conn.last_error && <p className="text-xs text-negative">{conn.last_error}</p>}
          </div>
        </CardContent>
        {unmatched.length > 0 && (
          <CardFooter className="flex-col items-start gap-1 border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {unmatched.length} Yahoo players had no ESPN projection or name match
            </span>
            <span>{unmatched.join(", ")}</span>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Draft settings</CardTitle>
          <CardDescription>Filled in by the Yahoo import; adjust if needed.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <NumberSetting label="Teams" value={settings.num_teams} min={2} max={30} onSave={(v) => updateSettings.mutate({ num_teams: v })} />
          <NumberSetting label="Rounds" value={settings.rounds} min={1} max={30} onSave={(v) => updateSettings.mutate({ rounds: v })} />
          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-medium">Your draft slot</span>
            <Select value={settings.my_slot ? String(settings.my_slot) : undefined} onValueChange={(v) => updateSettings.mutate({ my_slot: Number(v) })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: settings.num_teams }, (_, i) => i + 1).map((slot) => (
                  <SelectItem key={slot} value={String(slot)}>
                    Slot {slot}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="col-span-2 flex flex-col gap-1">
            <span className="font-medium">Roster spots</span>
            <div className="flex flex-wrap gap-1">
              {settings.roster_positions.map((p, i) => (
                <Badge key={i} variant="secondary">
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>In draft order. Rename teams if you're tracking picks by hand.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {data.teams.map((t) => (
            <div key={t.slot} className="flex items-center gap-2 text-sm">
              <span className="tabular w-5 text-right text-muted-foreground">{t.slot}</span>
              <Input
                defaultValue={t.name}
                className="h-7"
                onBlur={(e) => {
                  const name = e.target.value.trim()
                  if (name && name !== t.name) renameTeam.mutate({ slot: t.slot, name })
                }}
              />
              {t.slot === settings.my_slot && <Badge>You</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
          <CardDescription>Projections come from ESPN; last season's stats from NBA.com.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <DataRow label="Projections" at={data.synced_at.projections} busy={syncData.isPending} onRefresh={() => syncData.mutate("projections")} />
          <DataRow label="Last season" at={data.synced_at.last_season} busy={syncData.isPending} onRefresh={() => syncData.mutate("last_season")} />
          <DataRow label="Yahoo" at={data.synced_at.yahoo} busy={syncYahoo.isPending} onRefresh={conn.token ? () => syncYahoo.mutate() : undefined} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reset draft</CardTitle>
          <CardDescription>Clears every recorded pick, e.g. after a mock draft. Settings stay.</CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive">Reset draft…</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear all picks?</DialogTitle>
                <DialogDescription>This removes every pick recorded in the app. It does not touch Yahoo.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="destructive" onClick={() => resetDraft.mutate()}>
                    Clear picks
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  )
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onSave,
}: {
  label: string
  value: number
  min: number
  max: number
  onSave: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      <Input
        key={value}
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        className="w-24"
        onBlur={(e) => {
          const next = Number(e.target.value)
          if (Number.isInteger(next) && next >= min && next <= max && next !== value) onSave(next)
        }}
      />
    </label>
  )
}

function DataRow({ label, at, busy, onRefresh }: { label: string; at: string | null; busy: boolean; onRefresh?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">Updated {when(at)}</div>
      </div>
      {onRefresh && (
        <Button variant="outline" size="sm" disabled={busy} onClick={onRefresh}>
          <RefreshCwIcon /> Refresh
        </Button>
      )}
    </div>
  )
}
