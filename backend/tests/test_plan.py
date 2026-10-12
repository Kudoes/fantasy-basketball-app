import pandas as pd
import pytest

from app.engine.draft import DraftConfig, Pick, build_draft_state, slot_for_pick
from app.engine.plan import (
    ALIGN_WEIGHT,
    AVOID_PENALTY,
    SOON_NEED_BONUS,
    TARGET_BONUS,
    availability,
    build_plan,
    choose_branch,
    condition_notes,
    pair_plan,
    rule_progress,
)
from app.engine.valuation import compute_values
from tests.test_engine import ROSTER, line, make_stats

STATUS = {"current_pick": 20, "my_next_pick": 33, "my_following_pick": 40, "is_my_turn": False}


def test_availability_kinds():
    adp = {1: 10, 2: 25, 3: 36, 4: 60, 5: 44, 6: 5}
    positions = {5: ["C"]}
    taken = {6: {"overall": 3, "team": "Team 3"}}
    kinds = {pid: availability(pid, taken, adp, positions, STATUS)["kind"] for pid in adp}
    assert kinds == {1: "falling", 2: "gone_soon", 3: "take_now", 4: "should_last", 5: "take_now", 6: "taken"}
    assert availability(99, taken, adp, positions, STATUS)["kind"] == "unknown"


def _z(rows: dict[int, list[float]]) -> pd.DataFrame:
    return pd.DataFrame.from_dict(rows, orient="index", columns=list("abc"))


def test_choose_branch_manual_anchor_and_closest():
    playbook = {"branches": [{"id": "A", "anchor": "Big"}, {"id": "B", "anchor": "Guard"}]}
    ids = {"Big": 1, "Guard": 2}
    z = _z({1: [2.0, 0.0, -1.0], 2: [-1.0, 2.0, 1.0], 3: [1.8, 0.2, -0.5]})
    assert choose_branch(playbook, ids, "B", 1, z)[0]["id"] == "B"
    assert choose_branch(playbook, ids, None, 1, z) == (playbook["branches"][0], "first_pick")
    branch, how = choose_branch(playbook, ids, None, 3, z)  # first pick not in the playbook: looks like Big
    assert (branch["id"], how) == ("A", "closest")
    assert choose_branch(playbook, ids, None, None, z) == (None, "none")


def test_condition_notes():
    ids = {"H": 1, "S": 2, "X": 3}
    row = {"conditions": [
        {"if": "drafted_by_me", "names": ["H"], "note": "took H"},
        {"if": "taken", "match": "all", "names": ["S", "X"], "note": "S and X gone"},
        {"if": "available", "names": ["S", "X"], "note": "S or X left"},
        {"if": "punting", "cats": ["ast"], "note": "punting ast"},
        {"if": "not_punting", "cats": ["ast"], "note": "not punting ast"},
    ]}
    assert condition_notes(row, ids, mine={1}, taken={1, 2}, punts=set()) == ["took H", "S or X left", "not punting ast"]
    assert condition_notes(row, ids, mine=set(), taken={2, 3}, punts={"ast"}) == ["S and X gone", "punting ast"]


@pytest.mark.parametrize(
    ("have", "need", "upcoming", "urgency"),
    [(1, 1, [33, 40], "met"), (0, 1, [33, 40], "soon"), (0, 1, [40], "urgent"), (0, 1, [], "missed"),
     (0, 2, [33, 40, 57, 64], "later"), (0, 2, [57, 64], "urgent")],
)
def test_rule_progress(have, need, upcoming, urgency):
    assert rule_progress(have, need, 64 if need == 2 else 40, upcoming)["urgency"] == urgency


def _s(pid, score, avail):
    return {"player_id": pid, "score": score, "availability": avail}


def test_pair_plan_takes_the_player_who_wont_last():
    status = {**STATUS, "current_pick": 33, "is_my_turn": True}
    plan = pair_plan([_s(1, 5.0, "should_last"), _s(2, 4.9, "take_now"), _s(3, 4.8, "should_last")], status)
    assert (plan["now"], plan["later"]) == (2, 1)
    plan = pair_plan([_s(1, 5.0, "take_now"), _s(2, 4.8, "should_last"), _s(3, 4.0, "should_last")], status)
    assert (plan["now"], plan["later"]) == (1, 2)


def test_build_plan_end_to_end():
    stats = make_stats()
    star = dict(pts=27, reb=12, ast=4, stl=1.2, blk=2.2, fg3m=1.0, fgm=10, fga=17, ftm=4, fta=5, tov=2)
    stats.loc[150] = line(**star)  # playbook target for #20, C-eligible
    stats.loc[151] = line(**star)  # same line, but on the avoid list
    stats.loc[152] = line(**{**star, "pts": 28})  # a bit better, but not a target and not a center
    positions = {pid: ["SF"] for pid in stats.index} | {150: ["C"], 151: ["C"]}
    others = iter(range(20, 60))
    picks = [Pick(o, slot_for_pick(o, 12), 7 if o == 5 else next(others)) for o in range(1, 20)]
    config = DraftConfig(num_teams=12, rounds=13, my_slot=5, roster_positions=ROSTER)
    state = build_draft_state(stats, positions, {}, picks, config)
    for t in state["teams"]:
        t["name"] = f"Team {t['slot']}"

    playbook = {
        "center_rules": [{"by_pick": 29, "count": 1}],
        "fades": [],
        "branches": [{
            "id": "Z", "anchor": "Anchor", "name": "Test", "punts": [], "win": ["reb", "blk"], "rules": [],
            "avoid": ["Avoided"], "avoid_teams": [],
            "rounds": [{"picks": [20], "targets": ["Target"], "note": "", "conditions": []},
                       {"picks": [29], "targets": [], "note": "", "conditions": []}],
        }],
    }
    ids = {"Anchor": 7, "Target": 150, "Avoided": 151}
    settings = {"num_teams": 12, "rounds": 13, "my_slot": 5, "punts": [], "playbook_branch": None}
    static_z = compute_values(stats, pool_size=156)[[f"z_{k}" for k in ("pts", "reb", "ast")]]
    plan = build_plan(playbook, ids, state, settings, stats, positions, {}, {}, {}, static_z)

    assert plan["branch"] == {"id": "Z", "how": "first_pick"}
    assert any(a["text"].startswith("Centers:") for a in plan["alerts"])
    by_id = {s["player_id"]: s for s in plan["suggestions"]}
    target = by_id[150]
    z = next(r for r in state["available"] if r["player_id"] == 150)["z"]
    expected = target["fit"] + TARGET_BONUS + ALIGN_WEIGHT * (max(z["reb"], 0) + max(z["blk"], 0)) + SOON_NEED_BONUS
    assert target["score"] == pytest.approx(expected, abs=1e-3)
    assert "Playbook target for this pick" in target["reasons"]
    assert target["score"] - by_id[151]["score"] == pytest.approx(TARGET_BONUS + AVOID_PENALTY, abs=1e-3)
    # The playbook settles close calls (152 is slightly better on paper) without overruling much better players.
    assert by_id[152]["fit"] > target["fit"]
    order = [s["player_id"] for s in plan["suggestions"]]
    assert order.index(150) < order.index(152)
    assert plan["pair"]["now_pick"] == 20 and plan["pair"]["later_pick"] == 29
