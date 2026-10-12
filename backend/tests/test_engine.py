import numpy as np
import pandas as pd
import pytest

from app.engine.draft import (
    DraftConfig,
    Pick,
    assign_roster,
    build_draft_state,
    picks_for_slot,
    shift_picks,
    slot_for_pick,
)
from app.engine.valuation import compute_values

ROSTER = ["PG", "SG", "G", "SF", "PF", "F", "C", "C", "Util", "Util", "BN", "BN", "BN"]


def make_stats(n: int = 200, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    fga = rng.uniform(4, 20, n)
    fta = rng.uniform(1, 8, n)
    return pd.DataFrame(
        {
            "gp": rng.integers(40, 82, n).astype(float),
            "min": rng.uniform(15, 36, n),
            "pts": rng.uniform(5, 30, n),
            "reb": rng.uniform(2, 12, n),
            "ast": rng.uniform(1, 9, n),
            "stl": rng.uniform(0.3, 2, n),
            "blk": rng.uniform(0.1, 2, n),
            "fg3m": rng.uniform(0, 4, n),
            "fga": fga,
            "fgm": fga * rng.uniform(0.40, 0.60, n),
            "fta": fta,
            "ftm": fta * rng.uniform(0.60, 0.90, n),
            "tov": rng.uniform(0.5, 4, n),
        },
        index=pd.Index(range(1, n + 1), name="player_id"),
    )


def line(**overrides) -> dict:
    base = dict(gp=70, min=30, pts=15, reb=5, ast=4, stl=1, blk=0.5, fg3m=1.5,
                fgm=6, fga=13, ftm=3, fta=4, tov=2)
    return {**base, **overrides}


# --- Snake order ------------------------------------------------------------------


def test_snake_order():
    assert [slot_for_pick(o, 12) for o in (1, 12, 13, 24, 25, 36)] == [1, 12, 12, 1, 1, 12]
    assert picks_for_slot(1, 12, 4) == [1, 24, 25, 48]
    assert picks_for_slot(12, 12, 3) == [12, 13, 36]
    assert picks_for_slot(5, 10, 3) == [5, 16, 25]


def test_shift_picks_moves_later_picks_and_their_teams():
    picks = [Pick(o, slot_for_pick(o, 12), 100 + o) for o in (11, 12, 13, 14)]
    later = {p.overall: p for p in shift_picks(picks, 12, +1, 12)}
    assert sorted(later) == [11, 13, 14, 15]
    assert later[13].player_id == 112 and later[13].team_slot == 12  # #13 is slot 12 in a snake
    assert later[15].player_id == 114 and later[15].team_slot == 10
    without_12 = [p for p in picks if p.overall != 12]  # pick #12 removed, then the gap is closed
    earlier = {p.overall: p for p in shift_picks(without_12, 13, -1, 12)}
    assert sorted(earlier) == [11, 12, 13]
    assert earlier[12].player_id == 113 and earlier[12].team_slot == 12
    assert earlier[13].player_id == 114 and earlier[13].team_slot == 12


# --- Valuation --------------------------------------------------------------------


def test_pool_scores_are_centered():
    stats = make_stats()
    values = compute_values(stats, pool_size=150)
    pool = values[values["rank"] <= 150]
    for col in ("z_pts", "z_reb", "z_fg_pct", "z_tov"):
        assert abs(pool[col].mean()) < 1e-9


def test_percentages_are_volume_weighted():
    stats = make_stats()
    stats.loc[1001] = line(ftm=1, fta=1)  # 100% on 1 attempt
    stats.loc[1002] = line(ftm=8.5, fta=10)  # 85% on 10 attempts
    values = compute_values(stats, pool_size=150)
    assert values.at[1002, "z_ft_pct"] > values.at[1001, "z_ft_pct"]


def test_turnovers_count_against():
    stats = make_stats()
    stats.loc[1001] = line(tov=1)
    stats.loc[1002] = line(tov=4)
    values = compute_values(stats, pool_size=150)
    assert values.at[1001, "z_tov"] > values.at[1002, "z_tov"]
    assert values.at[1001, "value"] > values.at[1002, "value"]


def test_punting_drops_category_from_value():
    stats = make_stats()
    stats.loc[1001] = line(reb=12, blk=2.5, fgm=8, fga=13, ftm=2, fta=6)  # big man, bad FT
    base = compute_values(stats, pool_size=150)
    punted = compute_values(stats, pool_size=150, punts=["ft_pct"])
    z_cols = [c for c in punted.columns if c.startswith("z_") and c != "z_ft_pct"]
    assert punted.at[1001, "value"] == pytest.approx(punted.loc[1001, z_cols].sum())
    assert punted.at[1001, "rank"] < base.at[1001, "rank"]


def test_total_mode_rewards_games_played():
    stats = make_stats()
    stats.loc[1001] = line(pts=25, gp=78)
    stats.loc[1002] = line(pts=25, gp=35)
    per_game = compute_values(stats, pool_size=150)
    totals = compute_values(stats, pool_size=150, mode="total")
    assert per_game.at[1001, "value"] == pytest.approx(per_game.at[1002, "value"])
    assert totals.at[1001, "value"] > totals.at[1002, "value"]


# --- Draft state ------------------------------------------------------------------


def config(**overrides) -> DraftConfig:
    return DraftConfig(**{"num_teams": 12, "rounds": 13, "my_slot": 5, "roster_positions": ROSTER, **overrides})


def test_draft_status_and_turn_tracking():
    stats = make_stats()
    picks = [Pick(o, slot_for_pick(o, 12), o) for o in range(1, 5)]
    state = build_draft_state(stats, {}, {}, picks, config())
    s = state["status"]
    assert s["current_pick"] == 5 and s["on_clock_slot"] == 5
    assert s["is_my_turn"] and s["my_next_pick"] == 5 and s["my_following_pick"] == 20
    assert not {1, 2, 3, 4} & {r["player_id"] for r in state["available"]}


def test_removed_pick_leaves_a_hole_without_moving_the_clock():
    stats = make_stats()
    picks = [Pick(o, slot_for_pick(o, 12), o) for o in (1, 2, 4, 5)]  # #3 was removed
    s = build_draft_state(stats, {}, {}, picks, config())["status"]
    assert s["current_pick"] == 6 and s["on_clock_slot"] == 6
    assert s["my_next_pick"] == 20  # slot 5's #5 is taken, so its next is #20


def test_team_profiles_sum_static_scores():
    stats = make_stats()
    picks = [Pick(1, 1, 10), Pick(2, 2, 20), Pick(24, 1, 30)]
    state = build_draft_state(stats, {}, {}, picks, config())
    static = compute_values(stats, pool_size=12 * 13)
    team1 = next(t for t in state["teams"] if t["slot"] == 1)
    assert team1["player_ids"] == [10, 30]
    assert team1["cats"]["pts"] == pytest.approx(static.loc[[10, 30], "z_pts"].sum())


def test_adp_wait_flag_and_penalty():
    stats = make_stats()
    stats.loc[1001] = line(pts=24)
    stats.loc[1002] = line(pts=24)
    state = build_draft_state(stats, {}, {1001: 6.0, 1002: 60.0}, [], config())
    rows = {r["player_id"]: r for r in state["available"]}
    assert "wait" not in rows[1001]["flags"]
    assert "wait" in rows[1002]["flags"]  # following pick is #20; ADP 60 says he'll be there
    assert rows[1002]["fit"] < rows[1001]["fit"]


def test_low_games_played_discounts_fit():
    stats = make_stats()
    star = dict(pts=28, reb=10, ast=7, stl=1.6, blk=1.4, fg3m=2.5, fgm=10, fga=19, ftm=6, fta=7, tov=2)
    stats.loc[1001] = line(**star, gp=75)
    stats.loc[1002] = line(**star, gp=35)
    state = build_draft_state(stats, {}, {}, [], config())
    rows = {r["player_id"]: r for r in state["available"]}
    assert rows[1001]["value"] == pytest.approx(rows[1002]["value"])
    assert rows[1002]["fit"] < rows[1001]["fit"]
    assert "low_gp" in rows[1002]["flags"] and "low_gp" not in rows[1001]["flags"]


def test_punt_suggestion_after_weak_start():
    stats = make_stats()
    worst_ft = list(stats.assign(r=stats["ftm"] / stats["fta"]).sort_values("r").index)
    for pid in worst_ft[:8]:  # terrible FT shooters on huge volume
        stats.loc[pid, "fta"] = 9
        stats.loc[pid, "ftm"] = 4.5
    my_picks = picks_for_slot(5, 12, 4)
    picks = []
    other_ids = iter(i for i in stats.index if i not in worst_ft[:8])
    for overall in range(1, my_picks[-1] + 1):
        slot = slot_for_pick(overall, 12)
        pid = worst_ft[my_picks.index(overall)] if overall in my_picks else next(other_ids)
        picks.append(Pick(overall, slot, pid))
    state = build_draft_state(stats, {}, {}, picks, config())
    assert "ft_pct" in [s["cat"] for s in state["punt_suggestions"]]


def test_punted_category_gets_zero_weight():
    stats = make_stats()
    state = build_draft_state(stats, {}, {}, [], config(punts=["ft_pct"]))
    assert state["my_team"]["weights"]["ft_pct"] == 0.0


# --- Roster slots -----------------------------------------------------------------


def test_assign_roster_respects_positions():
    players = [(1, ["C"]), (2, ["C"]), (3, ["C"]), (4, ["PG"]), (5, ["SG", "SF"])]
    roster = assign_roster(players, ROSTER)
    slot_of = {r["player_id"]: r["position"] for r in roster if r["player_id"] is not None}
    assert {slot_of[1], slot_of[2], slot_of[3]} == {"C", "Util"}
    assert sum(slot_of[pid] == "C" for pid in (1, 2, 3)) == 2
    assert slot_of[4] in ("PG", "G")
    assert slot_of[5] in ("SG", "G", "SF", "F")


def test_assign_roster_overflows_to_bench():
    players = [(i, ["PG"]) for i in range(1, 16)]
    roster = assign_roster(players, ROSTER)
    assert sum(r["player_id"] is not None for r in roster) == 15
