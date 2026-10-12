import type { AvailabilityKind, DraftPlan, DraftState, Player, Playbook, PlaybookBranch } from "@/lib/api"

export type Availability = { kind: AvailabilityKind; overall?: number; team?: string }

export type PlayerTag = { kind: "target" | "avoid" | "fade" | "sleeper"; label: string; detail: string }

/** The branch the backend's live plan is following. */
export function planBranch(playbook: Playbook, plan: DraftPlan | null): PlaybookBranch | null {
  return plan?.branch ? (playbook.branches.find((b) => b.id === plan.branch!.id) ?? null) : null
}

export function availabilityOf(plan: DraftPlan | null, state: DraftState, playerId: number | undefined): Availability {
  if (playerId == null) return { kind: "unknown" }
  const known = plan?.availability[String(playerId)]
  if (known) return known
  const pick = state.picks.find((p) => p.player_id === playerId)
  return pick ? { kind: "taken", overall: pick.overall, team: `pick ${pick.overall}` } : { kind: "unknown" }
}

export const AVAILABILITY_LABEL: Record<Exclude<AvailabilityKind, "taken">, string> = {
  falling: "Falling past ADP",
  gone_soon: "Likely gone before your pick",
  take_now: "Won't last to your following pick",
  should_last: "Should last",
  unknown: "",
}

export const AVAILABILITY_TONE: Record<Exclude<AvailabilityKind, "taken">, string> = {
  falling: "text-positive",
  gone_soon: "text-negative",
  take_now: "text-warning",
  should_last: "text-muted-foreground",
  unknown: "",
}

/** Playbook labels for the board: targets for your build, players to avoid, fades and sleepers. */
export function playerTags(playbook: Playbook, branch: PlaybookBranch | null, players: Map<number, Player>): Map<number, PlayerTag> {
  const tags = new Map<number, PlayerTag>()
  const add = (name: string, tag: PlayerTag) => {
    const id = playbook.ids[name]
    if (id != null && !tags.has(id)) tags.set(id, tag)
  }
  if (branch) {
    branch.avoid.forEach((n) => add(n, { kind: "avoid", label: "Avoid", detail: branch.avoid_note }))
    if (branch.avoid_teams.length) {
      for (const p of players.values()) {
        if (p.team && branch.avoid_teams.includes(p.team) && !tags.has(p.id)) {
          tags.set(p.id, { kind: "avoid", label: "Avoid", detail: branch.avoid_note })
        }
      }
    }
    branch.rounds.forEach((r) =>
      r.targets.forEach((n) => add(n, { kind: "target", label: "Target", detail: `Branch ${branch.id} target for pick ${r.picks.join("/")}` })),
    )
  } else {
    playbook.pick9_priority.forEach((p, i) => add(p.name, { kind: "target", label: `#${i + 1} at 9`, detail: p.note }))
  }
  playbook.fades.forEach((f) => add(f.name, { kind: "fade", label: "Fade", detail: f.why }))
  playbook.late_targets.forEach((t) => add(t.name, { kind: "sleeper", label: "Sleeper", detail: `${t.why} Best builds: ${t.builds}.` }))
  return tags
}
