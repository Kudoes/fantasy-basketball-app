export type CategoryKey = "pts" | "reb" | "ast" | "stl" | "blk" | "fg3m" | "fg_pct" | "ft_pct" | "tov"
export type ValueMode = "per_game" | "total"
export type SyncMode = "manual" | "yahoo"

export interface StatLine {
  gp: number
  min: number
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  fg3m: number
  tov: number
  fgm: number
  fga: number
  fg_pct: number | null
  ftm: number
  fta: number
  ft_pct: number | null
}

export interface Player {
  id: number
  name: string
  team: string | null
  positions: string[]
  injury_status: string | null
  rank: number
  value: number
  z: Record<CategoryKey, number>
  adp: number | null
  adp_source: string | null
  proj: StatLine
  last: StatLine | null
}

export interface PlayersResponse {
  season: string
  last_season: string
  punts: CategoryKey[]
  mode: ValueMode
  categories: { key: CategoryKey; label: string }[]
  players: Player[]
}

export interface Settings {
  num_teams: number
  rounds: number
  my_slot: number | null
  punts: CategoryKey[]
  value_mode: ValueMode
  sync_mode: SyncMode
  roster_positions: string[]
  playbook_branch: string | null
}

export interface SyncStatus {
  credentials: boolean
  token: boolean
  last_draft_sync: string | null
  last_error: string | null
}

export interface DraftStatus {
  total_picks: number
  picks_made: number
  complete: boolean
  current_pick: number | null
  round: number
  pick_in_round: number | null
  on_clock_slot: number | null
  my_next_pick: number | null
  my_following_pick: number | null
  picks_until_my_turn: number | null
  is_my_turn: boolean
}

export interface DraftPick {
  overall: number
  round: number
  team_slot: number
  player_id: number
  source: "manual" | "yahoo"
}

export interface DraftTeam {
  slot: number
  name: string
  manager: string | null
  is_mine: boolean
  player_ids: number[]
  cats: Record<CategoryKey, number>
  ranks: Record<CategoryKey, number>
}

export type DraftFlag = "falling" | "wait" | "low_gp"

export interface AvailablePlayer {
  player_id: number
  value: number
  fit: number
  gp: number
  z: Record<CategoryKey, number>
  adp: number | null
  flags: DraftFlag[]
  boosts: CategoryKey[]
  hurts: CategoryKey[]
}

export type AvailabilityKind = "taken" | "falling" | "gone_soon" | "take_now" | "should_last" | "unknown"

export interface PlanAlert {
  level: "warn" | "info" | "plan"
  text: string
  action?: { kind: "punt"; cat: CategoryKey } | { kind: "branch"; id: string }
}

export interface PlanSuggestion {
  player_id: number
  name: string
  score: number
  fit: number
  availability: AvailabilityKind
  reasons: string[]
  source: "target" | "later_target" | "engine"
}

export interface DraftPlan {
  branch: { id: string; how: "manual" | "first_pick" | "closest" } | null
  next_pick: number | null
  following_pick: number | null
  row_index: number | null
  alerts: PlanAlert[]
  suggestions: PlanSuggestion[]
  pair: { now: number; now_pick: number; later: number; later_pick: number; later_odds: number } | null
  centers: { have: number; need: number; by_pick: number; picks_left: number[]; urgency: string }[]
  /** player id -> availability, for every playbook player */
  availability: Record<string, { kind: AvailabilityKind; overall?: number; team?: string }>
}

export interface DraftState {
  status: DraftStatus
  picks: DraftPick[]
  teams: DraftTeam[]
  league_avg: Record<CategoryKey, number>
  my_team: {
    slot: number
    weights: Record<CategoryKey, number>
    roster: { position: string; player_id: number | null }[]
  } | null
  available: AvailablePlayer[]
  recommendations: number[]
  punt_suggestions: { cat: CategoryKey; rank: number; avg_z: number }[]
  drafted_players: Record<string, { name: string; team: string | null; positions: string[] }>
  settings: Settings
  sync: SyncStatus
  plan: DraftPlan | null
}

export interface LeagueTeam {
  slot: number
  name: string
  team_key: string | null
  manager: string | null
  is_mine: boolean
}

export interface LeagueResponse {
  league_id: string
  yahoo: {
    league_key: string
    name: string
    num_teams: number
    draft_status: string
    season: string
    draft_type: string
    is_auction: boolean
    draft_time: number | null
    roster_positions: string[]
  } | null
  settings: Settings
  teams: LeagueTeam[]
  synced_at: { projections: string | null; last_season: string | null; yahoo: string | null }
  connection: SyncStatus
}

export interface YahooSyncResult {
  league: string
  teams: number
  draft_order_known: boolean
  players_matched: number
  players_unmatched: string[]
  draft_picks?: number
  draft_error?: string
}

export type SettingsUpdate = Partial<Omit<Settings, "roster_positions">> & { league_id?: string }

export interface PlaybookRound {
  picks: number[]
  targets: string[]
  note: string
}

export interface PlaybookBranch {
  id: string
  anchor: string
  name: string
  tagline: string
  punts: CategoryKey[]
  optional_punts: CategoryKey[]
  win: CategoryKey[]
  swing: CategoryKey[]
  warning: string
  rounds: PlaybookRound[]
  avoid: string[]
  avoid_teams: string[]
  avoid_note: string
}

export interface Playbook {
  available: true
  title: string
  as_of: string
  adp_note: string
  summary: string
  pick9_priority: { name: string; branch: string | null; note: string }[]
  not_at_9: { name: string; branch: string; note: string } | null
  center_rules: { by_pick: number; count: number }[]
  branches: PlaybookBranch[]
  late_targets: { name: string; why: string; builds: string }[]
  il_stashes: { name: string; note: string }[]
  fades: { name: string; why: string }[]
  checks: string[]
  tactics: string[]
  /** playbook name -> player id */
  ids: Record<string, number>
  unmatched: string[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)
    } catch {
      // keep the status text
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const api = {
  players: () => request<PlayersResponse>("/players"),
  draftState: () => request<DraftState>("/draft/state"),
  league: () => request<LeagueResponse>("/league"),
  updateSettings: (body: SettingsUpdate) => request<Partial<Settings>>("/settings", json("PUT", body)),
  addPick: (playerId: number) => request<{ overall: number }>("/draft/picks", json("POST", { player_id: playerId })),
  removePick: (overall: number, shift = false) =>
    request<{ removed: number }>(`/draft/picks/${overall}${shift ? "?shift=true" : ""}`, json("DELETE")),
  playbook: () => request<Playbook | { available: false }>("/playbook"),
  addUnlistedPick: (name: string, overall?: number) =>
    request<{ overall: number }>("/draft/picks", json("POST", { player_name: name, overall })),
  setPick: (overall: number, playerId: number, insert = false) =>
    request<{ overall: number }>("/draft/picks", json("POST", { player_id: playerId, overall, insert })),
  replacePick: (overall: number, playerId: number) =>
    request<{ overall: number }>(`/draft/picks/${overall}`, json("PUT", { player_id: playerId })),
  resetDraft: () => request<{ ok: boolean }>("/draft/reset", json("POST")),
  renameTeam: (slot: number, name: string) => request(`/teams/${slot}`, json("PUT", { name })),
  syncYahoo: () => request<YahooSyncResult>("/sync/yahoo", json("POST")),
  syncProjections: () => request<{ players: number }>("/sync/projections", json("POST")),
  syncLastSeason: () => request<{ rows: number; unmatched_regulars: string[] }>("/sync/last-season", json("POST")),
}
