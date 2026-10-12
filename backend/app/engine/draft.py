"""Live draft state: who is on the clock, live values, team profiles and recommendations."""

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.engine.categories import NINE_CAT, Category
from app.engine.valuation import compute_values

# Tuning knobs for the fit score.
NEED_STRENGTH = 0.6  # how much team needs re-weight categories once fully ramped in
NEED_RAMP_PICKS = 4  # needs ramp in over your first N picks
WAIT_PENALTY = 0.3  # player's ADP says he should still be there at your following pick
WAIT_BUFFER = 2  # picks of slack before applying WAIT_PENALTY
FALLING_MARGIN = 3  # ADP this many picks before the current pick counts as "falling"
FULL_SEASON_GP = 70  # in per-game mode, fit is scaled down for players projected below this
MIN_AVAILABILITY = 0.3
LOW_GP = 55  # flag players projected for fewer games than this
PUNT_MIN_PICKS = 4
PUNT_MAX_AVG_Z = -0.4  # per-player average z at or below this, while bottom-2, suggests a punt

POSITION_SLOTS = {
    "PG": {"PG", "G", "Util"},
    "SG": {"SG", "G", "Util"},
    "SF": {"SF", "F", "Util"},
    "PF": {"PF", "F", "Util"},
    "C": {"C", "Util"},
}
NON_ROSTER_SLOTS = {"IL", "IL+"}


@dataclass
class DraftConfig:
    num_teams: int
    rounds: int
    my_slot: int | None = None
    punts: Sequence[str] = ()
    value_mode: str = "per_game"
    roster_positions: Sequence[str] = field(default_factory=list)


@dataclass
class Pick:
    overall: int
    team_slot: int
    player_id: int
    source: str = "manual"


def slot_for_pick(overall: int, num_teams: int) -> int:
    """Snake order: odd rounds go 1..N, even rounds go N..1. `overall` is 1-based."""
    round_index, offset = divmod(overall - 1, num_teams)
    return offset + 1 if round_index % 2 == 0 else num_teams - offset


def round_for_pick(overall: int, num_teams: int) -> int:
    return (overall - 1) // num_teams + 1


def picks_for_slot(slot: int, num_teams: int, rounds: int) -> list[int]:
    return [
        (r - 1) * num_teams + (slot if r % 2 == 1 else num_teams - slot + 1)
        for r in range(1, rounds + 1)
    ]


def shift_picks(picks: Sequence[Pick], start: int, delta: int, num_teams: int) -> list[Pick]:
    """Moves every pick at or after `start` by `delta` overall spots, re-deriving its team from snake order.

    Used to fix a missed pick (delta=+1) or a duplicate one (delta=-1) without re-entering the rest.
    """
    shifted = []
    for p in picks:
        if p.overall >= start:
            overall = p.overall + delta
            shifted.append(Pick(overall, slot_for_pick(overall, num_teams), p.player_id, p.source))
        else:
            shifted.append(p)
    return shifted


def assign_roster(players: Sequence[tuple[int, Sequence[str]]], slots: Sequence[str]) -> list[dict]:
    """Fills starting slots with a maximum bipartite matching; everyone else goes to the bench."""
    slots = [s for s in slots if s not in NON_ROSTER_SLOTS]
    starting = [i for i, s in enumerate(slots) if s != "BN"]
    eligible = [
        set().union(*(POSITION_SLOTS.get(p, set()) for p in positions)) | {"Util"}
        for _, positions in players
    ]
    owner: dict[int, int] = {}  # slot index -> player index

    def place(pi: int, seen: set[int]) -> bool:
        for si in starting:
            if si in seen or slots[si] not in eligible[pi]:
                continue
            seen.add(si)
            if si not in owner or place(owner[si], seen):
                owner[si] = pi
                return True
        return False

    for pi in range(len(players)):
        place(pi, set())

    placed = set(owner.values())
    bench = [pi for pi in range(len(players)) if pi not in placed]
    roster = []
    for si, slot in enumerate(slots):
        pi = owner.get(si)
        if slot == "BN" and bench:
            pi = bench.pop(0)
        roster.append({"position": slot, "player_id": players[pi][0] if pi is not None else None})
    roster.extend({"position": "BN", "player_id": players[pi][0]} for pi in bench)
    return roster


def build_draft_state(
    stats: pd.DataFrame,
    positions: dict[int, Sequence[str]],
    adp: dict[int, float],
    picks: Sequence[Pick],
    config: DraftConfig,
    categories: Sequence[Category] = NINE_CAT,
) -> dict:
    keys = [c.key for c in categories]
    active = [k for k in keys if k not in set(config.punts)]
    n_teams, total_picks = config.num_teams, config.num_teams * config.rounds

    # --- Status -----------------------------------------------------------------
    made = {p.overall for p in picks}
    # The clock follows the latest recorded pick; a hole left by removing an earlier pick stays a hole
    # until it's filled from the board, so live entry never lands in it by accident.
    current = max(made, default=0) + 1
    if current > total_picks:
        current = None
    status: dict = {
        "total_picks": total_picks,
        "picks_made": len(picks),
        "complete": current is None,
        "current_pick": current,
        "round": round_for_pick(current, n_teams) if current else config.rounds,
        "pick_in_round": (current - 1) % n_teams + 1 if current else None,
        "on_clock_slot": slot_for_pick(current, n_teams) if current else None,
        "my_next_pick": None,
        "my_following_pick": None,
        "picks_until_my_turn": None,
        "is_my_turn": False,
    }
    if config.my_slot and current:
        upcoming = [o for o in picks_for_slot(config.my_slot, n_teams, config.rounds) if o >= current and o not in made]
        if upcoming:
            status["my_next_pick"] = upcoming[0]
            status["my_following_pick"] = upcoming[1] if len(upcoming) > 1 else None
            status["picks_until_my_turn"] = upcoming[0] - current
            status["is_my_turn"] = upcoming[0] == current

    # --- Team profiles (static values, all categories) ------------------------------
    static = compute_values(stats, pool_size=total_picks, mode=config.value_mode, categories=categories)
    z_cols = [f"z_{k}" for k in keys]
    teams = []
    for slot in range(1, n_teams + 1):
        ids = [p.player_id for p in sorted(picks, key=lambda p: p.overall) if p.team_slot == slot]
        ids_known = [i for i in ids if i in static.index]
        sums = static.loc[ids_known, z_cols].sum() if ids_known else pd.Series(0.0, index=z_cols)
        teams.append({"slot": slot, "player_ids": ids, "cats": {k: float(sums[f"z_{k}"]) for k in keys}})

    league_avg = {k: float(np.mean([t["cats"][k] for t in teams])) for k in keys}
    for k in keys:
        ordered = sorted(teams, key=lambda t: t["cats"][k], reverse=True)
        for rank, team in enumerate(ordered, start=1):
            team.setdefault("ranks", {})[k] = rank

    # --- My needs -------------------------------------------------------------------
    mine = next((t for t in teams if t["slot"] == config.my_slot), None)
    n_mine = len(mine["player_ids"]) if mine else 0
    ramp = min(1.0, n_mine / NEED_RAMP_PICKS)
    weights = {}
    for k in keys:
        if k not in active:
            weights[k] = 0.0
        elif mine and n_mine:
            gap = (league_avg[k] - mine["cats"][k]) / n_mine
            weights[k] = 1.0 + NEED_STRENGTH * ramp * float(np.clip(gap, -0.5, 1.0))
        else:
            weights[k] = 1.0

    # --- Live values for the players still on the board ------------------------------
    drafted = {p.player_id for p in picks}
    available = stats[~stats.index.isin(drafted)]
    remaining_spots = max(total_picks - len(picks), n_teams)
    dyn = compute_values(available, pool_size=remaining_spots, punts=config.punts, mode=config.value_mode, categories=categories)

    contrib = pd.DataFrame({k: dyn[f"z_{k}"] * weights[k] for k in keys}, index=dyn.index)
    fit = contrib.sum(axis=1)

    following = status["my_following_pick"]
    rows = []
    for pid in dyn.index:
        player_adp = adp.get(pid)
        gp = float(available.at[pid, "gp"])
        flags = []
        base_fit = float(fit[pid])
        # Per-game values ignore missed games; in H2H those cost you weeks, so discount the fit.
        if config.value_mode == "per_game" and base_fit > 0 and gp < FULL_SEASON_GP:
            base_fit *= max(MIN_AVAILABILITY, gp / FULL_SEASON_GP)
        if gp < LOW_GP:
            flags.append("low_gp")
        adjust = 0.0
        if player_adp is not None and current:
            if player_adp < current - FALLING_MARGIN:
                flags.append("falling")
            if following and player_adp > following + WAIT_BUFFER:
                flags.append("wait")
                adjust -= WAIT_PENALTY
        c = contrib.loc[pid]
        boosts = [k for k in c.sort_values(ascending=False).index if c[k] >= 0.5][:3]
        hurts = [k for k in c.sort_values().index if c[k] <= -1.0][:2]
        rows.append({
            "player_id": int(pid),
            "value": round(float(dyn.at[pid, "value"]), 3),
            "fit": round(base_fit + adjust, 3),
            "gp": gp,
            "z": {k: round(float(dyn.at[pid, f"z_{k}"]), 3) for k in keys},
            "adp": player_adp,
            "flags": flags,
            "boosts": boosts,
            "hurts": hurts,
        })
    rows.sort(key=lambda r: r["fit"], reverse=True)

    # --- Punt suggestions ------------------------------------------------------------------
    punt_suggestions = []
    if mine and n_mine >= PUNT_MIN_PICKS:
        for k in active:
            avg_z = mine["cats"][k] / n_mine
            if mine["ranks"][k] >= n_teams - 1 and avg_z <= PUNT_MAX_AVG_Z:
                punt_suggestions.append({"cat": k, "rank": mine["ranks"][k], "avg_z": round(avg_z, 2)})
        punt_suggestions = sorted(punt_suggestions, key=lambda s: s["avg_z"])[:2]

    my_roster = []
    if mine:
        my_roster = assign_roster(
            [(pid, positions.get(pid, [])) for pid in mine["player_ids"]], config.roster_positions
        )

    return {
        "status": status,
        "picks": [
            {"overall": p.overall, "round": round_for_pick(p.overall, n_teams), "team_slot": p.team_slot,
             "player_id": p.player_id, "source": p.source}
            for p in sorted(picks, key=lambda p: p.overall)
        ],
        "teams": teams,
        "league_avg": league_avg,
        "my_team": {
            "slot": config.my_slot,
            "weights": weights,
            "roster": my_roster,
        } if mine else None,
        "available": rows,
        "recommendations": [r["player_id"] for r in rows[:3]],
        "punt_suggestions": punt_suggestions,
    }
