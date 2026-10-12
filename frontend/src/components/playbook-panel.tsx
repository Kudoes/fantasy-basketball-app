import { CheckCircle2Icon, CircleIcon, InfoIcon, ListChecksIcon, TriangleAlertIcon } from "lucide-react"

import { PlayerCell, ValueText } from "@/components/player-cells"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CategoryKey, DraftPlan, DraftState, PlanAlert, PlanSuggestion, Player, Playbook, PlaybookBranch } from "@/lib/api"
import { CATEGORY_LABEL } from "@/lib/format"
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, availabilityOf, type Availability } from "@/lib/playbook"
import { cn } from "@/lib/utils"

const FOLLOW_FIRST_PICK = "auto"

export function PlaybookPanel({
  playbook,
  plan,
  branch,
  state,
  byId,
  onDraft,
  onTogglePunt,
  onChooseBranch,
}: {
  playbook: Playbook
  plan: DraftPlan | null
  branch: PlaybookBranch | null
  state: DraftState
  byId: Map<number, Player>
  onDraft?: (player: Player) => void
  onTogglePunt: (key: CategoryKey) => void
  onChooseBranch: (id: string | null) => void
}) {
  const punts = state.settings.punts
  const fit = new Map(state.available.map((a) => [a.player_id, a.fit]))
  const row = branch && plan?.row_index != null ? branch.rounds[plan.row_index] : null
  const how = plan?.branch?.how

  const targetRow = (name: string, note?: string, draftable = true) => {
    const id = playbook.ids[name]
    const player = id != null ? byId.get(id) : undefined
    const avail = availabilityOf(plan, state, id)
    return (
      <TargetRow
        key={name}
        name={name}
        player={player}
        avail={avail}
        fit={id != null ? fit.get(id) : undefined}
        note={note}
        onDraft={draftable && onDraft && player && avail.kind !== "taken" ? () => onDraft(player) : undefined}
      />
    )
  }

  const runAlert = (alert: PlanAlert) => {
    if (alert.action?.kind === "punt") onTogglePunt(alert.action.cat)
    if (alert.action?.kind === "branch") onChooseBranch(alert.action.id)
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {branch ? (
                <>
                  <Badge>Branch {branch.id}</Badge> {branch.name}
                </>
              ) : (
                "Your first pick (#9)"
              )}
            </CardTitle>
            <CardDescription>
              {!branch && playbook.summary}
              {branch && how === "manual" && `${branch.tagline}. Chosen by hand.`}
              {branch && how === "first_pick" && `${branch.tagline}. Following your first pick, ${branch.anchor}.`}
              {branch && how === "closest" &&
                `${branch.tagline}. Your first pick isn't in the playbook; this branch's anchor (${branch.anchor}) has the most similar category profile.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {branch && (
              <>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="mr-1 font-medium text-muted-foreground">Win</span>
                  {branch.win.map((k) => (
                    <Badge key={k} variant="secondary" className="bg-positive/15 text-positive">
                      {CATEGORY_LABEL[k]}
                    </Badge>
                  ))}
                  {branch.swing.length > 0 && <span className="mr-1 ml-2 font-medium text-muted-foreground">Swing</span>}
                  {branch.swing.map((k) => (
                    <Badge key={k} variant="outline">
                      {CATEGORY_LABEL[k]}
                    </Badge>
                  ))}
                </div>
                {(branch.punts.length > 0 || branch.optional_punts.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {[...branch.punts.map((k) => ({ k, optional: false })), ...branch.optional_punts.map((k) => ({ k, optional: true }))].map(
                      ({ k, optional }) => {
                        const on = punts.includes(k)
                        return (
                          <Button key={k} size="sm" variant={on ? "secondary" : "default"} onClick={() => onTogglePunt(k)}>
                            {on ? `✓ Punting ${CATEGORY_LABEL[k]}` : `${optional ? "Optional: punt" : "Punt"} ${CATEGORY_LABEL[k]}`}
                          </Button>
                        )
                      },
                    )}
                  </div>
                )}
                {branch.warning && (
                  <p className="flex gap-2 text-sm">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                    {branch.warning}
                  </p>
                )}
              </>
            )}
            {!branch && (
              <ul className="flex flex-col gap-1.5">
                {playbook.pick9_priority.map((p, i) => (
                  <li key={p.name} className="flex gap-2">
                    <span className="tabular w-5 shrink-0 pt-2 text-right text-xs text-muted-foreground">{i + 1}.</span>
                    <div className="min-w-0 flex-1">{targetRow(p.name, p.note + (p.branch ? ` → Branch ${p.branch}` : ""))}</div>
                  </li>
                ))}
                {playbook.not_at_9 && (
                  <li className="pl-7 text-xs text-muted-foreground">
                    Not at 9: {playbook.not_at_9.name}. {playbook.not_at_9.note}
                  </li>
                )}
              </ul>
            )}
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Branch
              <Select
                value={state.settings.playbook_branch ?? FOLLOW_FIRST_PICK}
                onValueChange={(v) => onChooseBranch(v === FOLLOW_FIRST_PICK ? null : v)}
              >
                <SelectTrigger size="sm" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FOLLOW_FIRST_PICK}>Follow my first pick</SelectItem>
                  {playbook.branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.id}: {b.anchor} → {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </CardContent>
        </Card>

        {branch && plan && (
          <Card className="ring-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecksIcon className="size-4 text-primary" />
                Live plan{plan.next_pick ? ` for #${plan.next_pick}` : ""}
              </CardTitle>
              <CardDescription>Re-planned after every pick from the playbook, your roster and the board.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {plan.alerts.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {plan.alerts.map((a) => (
                    <AlertRow key={a.text} alert={a} onAction={a.action ? () => runAlert(a) : undefined} />
                  ))}
                </ul>
              )}
              {plan.pair && (
                <PairPlan pair={plan.pair} names={new Map(plan.suggestions.map((s) => [s.player_id, s.name]))} />
              )}
              <ol className="flex flex-col gap-1.5">
                {plan.suggestions.map((s, i) => (
                  <SuggestionRow
                    key={s.player_id}
                    rank={i + 1}
                    suggestion={s}
                    player={byId.get(s.player_id)}
                    onDraft={onDraft && byId.get(s.player_id) ? () => onDraft(byId.get(s.player_id)!) : undefined}
                  />
                ))}
              </ol>
              {row && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                  <span className="font-medium">The analysis for this pick: </span>
                  {row.targets.map((n, i) => {
                    const taken = availabilityOf(plan, state, playbook.ids[n]).kind === "taken"
                    return (
                      <span key={n}>
                        <span className={cn(taken && "text-muted-foreground line-through")}>{n}</span>
                        {i < row.targets.length - 1 ? ", " : ". "}
                      </span>
                    )
                  })}
                  {row.note}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {branch && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Whole plan</CardTitle>
              <CardDescription>Taken players are struck through.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {branch.rounds.map((r) => (
                <div key={r.picks[0]} className={cn("grid grid-cols-[5.5rem_1fr] gap-2", r === row && "font-medium")}>
                  <span className={cn("text-xs text-muted-foreground", r === row && "text-primary")}>
                    {r.picks.length > 2 ? `${r.picks[0]}–${r.picks.at(-1)}` : r.picks.join("/")}
                    {r === row ? " · next" : ""}
                  </span>
                  <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {r.targets.map((n) => (
                      <span
                        key={n}
                        className={cn(availabilityOf(plan, state, playbook.ids[n]).kind === "taken" && "text-muted-foreground/60 line-through")}
                      >
                        {n}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <CenterRules plan={plan} />

        {branch && branch.avoid_note && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Avoid in this build</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{branch.avoid_note}</CardContent>
          </Card>
        )}

        <Card size="sm">
          <CardHeader>
            <CardTitle>Fades</CardTitle>
            <CardDescription>Players the analysis says to pass on at their price.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">{playbook.fades.map((f) => targetRow(f.name, f.why, false))}</CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Sleepers and late targets</CardTitle>
            <CardDescription>For picks 81 and later. IL stashes are at the bottom.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {playbook.late_targets.map((t) => targetRow(t.name, `${t.why} Best builds: ${t.builds}.`))}
            {playbook.il_stashes.map((t) => targetRow(t.name, `IL stash: ${t.note}`))}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Before the draft</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
              {[...playbook.checks, ...playbook.tactics].map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              From your analysis as of {playbook.as_of}. {playbook.adp_note} The live plan adds to Fit scores; it doesn't replace them.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function AlertRow({ alert, onAction }: { alert: PlanAlert; onAction?: () => void }) {
  const Icon = alert.level === "warn" ? TriangleAlertIcon : alert.level === "plan" ? ListChecksIcon : InfoIcon
  const tone = alert.level === "warn" ? "text-warning" : alert.level === "plan" ? "text-primary" : "text-muted-foreground"
  const label =
    alert.action?.kind === "punt"
      ? `Punt ${CATEGORY_LABEL[alert.action.cat]}`
      : alert.action?.kind === "branch"
        ? `Switch to Branch ${alert.action.id}`
        : null
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
      <span className="flex-1">{alert.text}</span>
      {onAction && label && (
        <Button size="xs" variant="outline" onClick={onAction}>
          {label}
        </Button>
      )}
    </li>
  )
}

export function PairPlan({ pair, names }: { pair: NonNullable<DraftPlan["pair"]>; names: Map<number, string> }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      Take <b>{names.get(pair.now)}</b> at #{pair.now_pick}.{" "}
      <b>{names.get(pair.later)}</b> should still be there at #{pair.later_pick}{" "}
      <span className="text-muted-foreground">(~{Math.round(pair.later_odds * 100)}% by ADP)</span>.
    </div>
  )
}

function SuggestionRow({
  rank,
  suggestion: s,
  player,
  onDraft,
}: {
  rank: number
  suggestion: PlanSuggestion
  player: Player | undefined
  onDraft?: () => void
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg border px-2.5 py-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {player ? (
            <PlayerCell name={player.name} team={player.team} positions={player.positions} injury={player.injury_status} />
          ) : (
            <span className="font-medium">{s.name}</span>
          )}
          <AvailabilityText avail={{ kind: s.availability }} />
        </div>
        {s.reasons.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {s.reasons.map((r) => (
              <Badge
                key={r}
                variant="secondary"
                className={cn(
                  "h-auto py-0 text-[11px] font-normal",
                  r.startsWith("Playbook target") && "bg-primary/10 text-primary",
                  (r.startsWith("Playbook: avoid") || r === "Playbook fade") && "bg-negative/15 text-negative",
                )}
              >
                {r}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
        <span title="Fit plus the playbook's adjustments">
          plan <ValueText value={s.score} />
        </span>
        <span>
          fit <ValueText value={s.fit} />
        </span>
        {onDraft && (
          <Button size="xs" variant="outline" onClick={onDraft}>
            Draft
          </Button>
        )}
      </div>
    </li>
  )
}

function TargetRow({
  name,
  player,
  avail,
  fit,
  note,
  onDraft,
}: {
  name: string
  player: Player | undefined
  avail: Availability
  fit: number | undefined
  note?: string
  onDraft?: () => void
}) {
  const taken = avail.kind === "taken"
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-2.5 py-1.5", taken && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {player ? (
            <span className={cn(taken && "line-through")}>
              <PlayerCell name={player.name} team={player.team} positions={player.positions} injury={player.injury_status} />
            </span>
          ) : (
            <span className="text-sm font-medium" title="No ESPN projection, so the app has no stats for this player">
              {name} <span className="text-xs font-normal text-muted-foreground">(not in the app's projections)</span>
            </span>
          )}
          <AvailabilityText avail={avail} />
        </div>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
        {player?.adp != null && (
          <span title={player.adp_source === "playbook" ? "Yahoo ADP quoted in your analysis" : `ADP source: ${player.adp_source}`}>
            ADP {player.adp.toFixed(1)}
          </span>
        )}
        {fit != null && (
          <span>
            fit <ValueText value={fit} />
          </span>
        )}
        {onDraft && (
          <Button size="xs" variant="outline" onClick={onDraft}>
            Draft
          </Button>
        )}
      </div>
    </div>
  )
}

export function AvailabilityText({ avail }: { avail: Availability }) {
  if (avail.kind === "taken") {
    return (
      <span className="text-xs text-muted-foreground">
        Taken{avail.overall ? ` #${avail.overall}` : ""}
        {avail.team ? ` by ${avail.team}` : ""}
      </span>
    )
  }
  if (avail.kind === "unknown") return null
  return <span className={cn("text-xs font-medium", AVAILABILITY_TONE[avail.kind])}>{AVAILABILITY_LABEL[avail.kind]}</span>
}

function CenterRules({ plan }: { plan: DraftPlan | null }) {
  const rules = plan?.centers ?? []
  const have = rules[0]?.have ?? 0
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Center count</CardTitle>
        <CardDescription>
          You have {have} C-eligible player{have === 1 ? "" : "s"} (Yahoo eligibility).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 text-sm">
        {rules.map((rule) => {
          const met = rule.urgency === "met"
          const behind = rule.urgency === "missed" || rule.urgency === "urgent"
          return (
            <div key={rule.by_pick} className="flex items-start gap-2">
              {met ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-positive" />
              ) : behind ? (
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-negative" />
              ) : (
                <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={cn(behind && "text-negative")}>
                {rule.need} by pick #{rule.by_pick}
                {!met &&
                  (rule.picks_left.length
                    ? ` · need ${rule.need - rule.have} more with ${rule.picks_left.map((p) => `#${p}`).join(", ")}`
                    : " · missed")}
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
