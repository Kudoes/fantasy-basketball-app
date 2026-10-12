"""Adaptive draft plan: the pre-draft playbook re-read against the live draft.

The playbook's targets and notes are fixed text. After every pick this module decides which branch
applies, which of the playbook's conditions are now true, how you're tracking against its rules
(centers, shooters), and which players to take at your next pick versus your following one.
"""

from collections.abc import Iterable, Sequence

import numpy as np
import pandas as pd

from app.engine.draft import picks_for_slot

# Tuning knobs for the plan score (added to the engine's fit).
CENTER_ADP_SHIFT = 5  # centers go ~5 picks before ADP in 2-C leagues, per the analysis
FALLING_MARGIN = 3
TARGET_BONUS = 0.75  # the playbook names him for this pick
LATER_TARGET_BONUS = 0.25  # the playbook names him for a later pick in your branch
ALIGN_WEIGHT = 0.2  # per positive z-point in the branch's "win" categories
URGENT_NEED_BONUS = 1.0  # a plan rule needs this pick (or is already behind)
SOON_NEED_BONUS = 0.3  # a plan rule is unmet but there's still a little time
AVOID_PENALTY = 1.0
FADE_PENALTY = 0.5
CANDIDATE_POOL = 40  # top players by fit considered besides the playbook's own targets
MAX_SUGGESTIONS = 6
CATEGORY_GAP_MIN_PICKS = 3
# Chance a player is still there at your following pick, by availability.
P_STILL_THERE = {"should_last": 0.85, "falling": 0.6, "unknown": 0.5, "take_now": 0.3, "gone_soon": 0.1}

LABELS = {"pts": "PTS", "reb": "REB", "ast": "AST", "stl": "STL", "blk": "BLK", "fg3m": "3PM",
          "fg_pct": "FG%", "ft_pct": "FT%", "tov": "TO"}


def availability(pid: int, taken: dict[int, dict], adp: dict[int, float], positions: dict[int, Sequence[str]],
                 status: dict) -> dict:
    """Whether a player is gone, and if not, whether he'll last to your next and following picks."""
    if pid in taken:
        return {"kind": "taken", **taken[pid]}
    current, player_adp = status.get("current_pick"), adp.get(pid)
    if player_adp is None or current is None:
        return {"kind": "unknown"}
    if "C" in positions.get(pid, ()):
        player_adp -= CENTER_ADP_SHIFT
    if player_adp < current - FALLING_MARGIN:
        return {"kind": "falling"}
    if status.get("my_next_pick") and not status.get("is_my_turn") and player_adp < status["my_next_pick"]:
        return {"kind": "gone_soon"}
    if status.get("my_following_pick") and player_adp < status["my_following_pick"]:
        return {"kind": "take_now"}
    return {"kind": "should_last"}


def choose_branch(playbook: dict, ids: dict[str, int], chosen: str | None, first_pick: int | None,
                  static_z: pd.DataFrame) -> tuple[dict | None, str]:
    """The branch to follow: chosen by hand, anchored by your first pick, or the closest anchor by category profile."""
    branches = playbook.get("branches", [])
    if chosen:
        branch = next((b for b in branches if b["id"] == chosen), None)
        if branch:
            return branch, "manual"
    if first_pick is None:
        return None, "none"
    for branch in branches:
        if ids.get(branch["anchor"]) == first_pick:
            return branch, "first_pick"
    if first_pick not in static_z.index:
        return None, "none"
    mine = static_z.loc[first_pick].to_numpy(dtype=float)
    best, best_sim = None, -np.inf
    for branch in branches:
        anchor = ids.get(branch["anchor"])
        if anchor is None or anchor not in static_z.index:
            continue
        theirs = static_z.loc[anchor].to_numpy(dtype=float)
        denom = np.linalg.norm(mine) * np.linalg.norm(theirs)
        sim = float(mine @ theirs / denom) if denom else -np.inf
        if sim > best_sim:
            best, best_sim = branch, sim
    return (best, "closest") if best else (None, "none")


def row_for(branch: dict, pick: int | None) -> dict | None:
    if pick is None or not branch.get("rounds"):
        return None
    rounds = branch["rounds"]
    return next((r for r in rounds if pick in r["picks"]), rounds[-1] if pick >= rounds[-1]["picks"][0] else None)


def condition_notes(row: dict, ids: dict[str, int], mine: set[int], taken: set[int], punts: set[str]) -> list[str]:
    notes = []
    for cond in row.get("conditions", []):
        kind = cond["if"]
        if kind in ("punting", "not_punting"):
            hit = any(c in punts for c in cond["cats"])
            ok = hit if kind == "punting" else not hit
        else:
            pids = [ids[n] for n in cond.get("names", []) if n in ids]
            if not pids:
                continue
            test = all if cond.get("match") == "all" else any
            check = {"drafted_by_me": lambda p: p in mine, "taken": lambda p: p in taken,
                     "available": lambda p: p not in taken}.get(kind)
            ok = bool(check) and test(check(p) for p in pids)
        if ok:
            notes.append(cond["note"])
    return notes


def rule_progress(have: int, need: int, by_pick: int, upcoming: Sequence[int]) -> dict:
    """How a count rule ("2 C-eligible by #64") stands, and how urgent the shortfall is."""
    shortage = need - have
    left = [p for p in upcoming if p <= by_pick]
    if shortage <= 0:
        urgency = "met"
    elif not left:
        urgency = "missed"
    elif len(left) <= shortage:
        urgency = "urgent"
    elif len(left) == shortage + 1:
        urgency = "soon"
    else:
        urgency = "later"
    return {"have": have, "need": need, "by_pick": by_pick, "picks_left": left, "urgency": urgency}


def _need_bonus(progress: Iterable[dict]) -> float:
    urgencies = {p["urgency"] for p in progress}
    if urgencies & {"urgent", "missed"}:
        return URGENT_NEED_BONUS
    if "soon" in urgencies:
        return SOON_NEED_BONUS
    return 0.0


def _rule_text(progress: dict, what: str) -> str:
    short = progress["need"] - progress["have"]
    picks = ", ".join(f"#{p}" for p in progress["picks_left"])
    if progress["urgency"] == "missed":
        return f"Behind plan: {progress['have']} {what}, wanted {progress['need']} by #{progress['by_pick']}. Catch up now."
    return (f"{progress['have']} {what}; the plan wants {progress['need']} by #{progress['by_pick']}. "
            f"You need {short} more with your picks at {picks}.")


def pair_plan(suggestions: list[dict], status: dict) -> dict | None:
    """Who to take at your next pick and who should still be there at your following one."""
    nxt, following = status.get("my_next_pick"), status.get("my_following_pick")
    top = suggestions[:5]
    if not nxt or not following or len(top) < 2:
        return None
    floor = min(s["score"] for s in top) - 0.1
    best = None
    for a in top:
        p_now = 1.0 if status.get("is_my_turn") or a["availability"] != "gone_soon" else 0.3
        for b in top:
            if b is a:
                continue
            value = p_now * (a["score"] - floor) + P_STILL_THERE.get(b["availability"], 0.5) * (b["score"] - floor)
            if best is None or value > best[0]:
                best = (value, a, b)
    _, now, later = best
    return {"now": now["player_id"], "now_pick": nxt, "later": later["player_id"], "later_pick": following,
            "later_odds": P_STILL_THERE.get(later["availability"], 0.5)}


def build_plan(
    playbook: dict,
    ids: dict[str, int],
    state: dict,
    settings: dict,
    stats: pd.DataFrame,
    positions: dict[int, Sequence[str]],
    adp: dict[int, float],
    names: dict[int, str],
    player_teams: dict[int, str | None],
    static_z: pd.DataFrame,
) -> dict:
    """`state` is build_draft_state's output (with team names); `static_z` has one column per category."""
    status = state["status"]
    punts = set(settings.get("punts") or [])
    num_teams = settings["num_teams"]
    me = next((t for t in state["teams"] if t["slot"] == settings.get("my_slot")), None)
    mine = list(me["player_ids"]) if me else []
    team_names = {t["slot"]: t.get("name") or f"Team {t['slot']}" for t in state["teams"]}
    taken = {
        p["player_id"]: {"overall": p["overall"], "team": "you" if me and p["team_slot"] == me["slot"] else team_names[p["team_slot"]]}
        for p in state["picks"]
    }
    upcoming = _upcoming_picks(settings, status, {p["overall"] for p in state["picks"]})
    available = {r["player_id"]: r for r in state["available"]}

    def avail(pid: int) -> str:
        return availability(pid, taken, adp, positions, status)["kind"]

    branch, how = choose_branch(playbook, ids, settings.get("playbook_branch"), mine[0] if mine else None, static_z)
    alerts: list[dict] = []
    row = row_for(branch, status.get("my_next_pick")) if branch else None

    # --- Rules: centers (whole playbook) and branch count rules ----------------------------------
    center_progress = [
        rule_progress(sum("C" in positions.get(pid, ()) for pid in mine), r["count"], r["by_pick"], upcoming)
        for r in playbook.get("center_rules", [])
    ]
    open_center = [p for p in center_progress if p["urgency"] != "met"]
    if open_center and open_center[0]["urgency"] in ("urgent", "missed", "soon"):
        level = "warn" if open_center[0]["urgency"] in ("urgent", "missed") else "info"
        alerts.append({"level": level, "text": "Centers: " + _rule_text(open_center[0], "C-eligible")})
    center_bonus = _need_bonus(center_progress)

    branch_rules = []
    for rule in (branch or {}).get("rules", []):
        have = sum(1 for pid in mine if pid in stats.index and stats.at[pid, rule["stat"]] >= rule["threshold"])
        prog = rule_progress(have, rule["count"], rule["by_pick"], upcoming)
        branch_rules.append((rule, prog))
        # Branch rules have no card of their own, so any shortfall is shown; urgency sets the tone.
        if prog["urgency"] != "met":
            alerts.append({"level": "warn" if prog["urgency"] in ("urgent", "missed") else "info",
                           "text": f"Branch {branch['id']}: " + _rule_text(prog, rule["label"])})

    # --- Conditional notes for this pick --------------------------------------------------------------
    if row:
        for note in condition_notes(row, ids, set(mine), set(taken), punts):
            alerts.append({"level": "plan", "text": note})

    # --- Drift: branch categories you're losing, punts the numbers want -----------------------------
    if branch and me and len(mine) >= CATEGORY_GAP_MIN_PICKS:
        weak = [c for c in branch["win"] if c not in punts and me["ranks"].get(c, 0) >= num_teams - 2]
        if weak:
            cats = ", ".join(f"{LABELS[c]} ({_ordinal(me['ranks'][c])})" for c in weak)
            alerts.append({"level": "warn", "text": f"Branch {branch['id']} plans to win {cats}, but you're near the bottom. Lean that way, or rethink the branch."})
    if branch:
        for p in branch.get("punts", []):
            if p not in punts:
                alerts.append({"level": "info", "text": f"Branch {branch['id']} punts {LABELS[p]}. Turn the punt on so the board ranks for it.",
                               "action": {"kind": "punt", "cat": p}})
        for s in state.get("punt_suggestions", []):
            if s["cat"] in branch["win"] and s["cat"] not in punts:
                alt = next((b for b in playbook["branches"] if s["cat"] in b.get("punts", [])), None)
                text = f"The numbers say punt {LABELS[s['cat']]}, but Branch {branch['id']} plans to win it."
                action = {"kind": "punt", "cat": s["cat"]}
                if alt and alt["id"] != branch["id"]:
                    text += f" Branch {alt['id']} ({alt['name']}) is the playbook's plan for that."
                    action = {"kind": "branch", "id": alt["id"]}
                alerts.append({"level": "warn", "text": text, "action": action})

    # --- Suggestions for the next pick ----------------------------------------------------------------------
    suggestions: list[dict] = []
    if branch is None and not mine:
        for i, entry in enumerate(playbook.get("pick9_priority", [])):
            pid = ids.get(entry["name"])
            if pid in available:
                suggestions.append(_suggestion(pid, names, available[pid], available[pid]["fit"], avail(pid),
                                               [f"#{i + 1} on the playbook's list for your first pick"], "target"))
    else:
        row_ids = {ids[n] for n in (row or {}).get("targets", []) if n in ids}
        later_ids = {ids[n] for r in (branch or {}).get("rounds", []) if r is not row for n in r["targets"] if n in ids}
        avoid = {ids[n] for n in (branch or {}).get("avoid", []) if n in ids}
        avoid_teams = set((branch or {}).get("avoid_teams", []))
        fades = {ids[f["name"]] for f in playbook.get("fades", []) if f["name"] in ids}
        pool = sorted(available.values(), key=lambda r: r["fit"], reverse=True)[:CANDIDATE_POOL]
        candidates = {r["player_id"] for r in pool} | ((row_ids | later_ids) & available.keys())
        win = [c for c in (branch or {}).get("win", []) if c not in punts]

        for pid in candidates:
            r = available[pid]
            score, reasons = r["fit"], []
            source = "engine"
            if pid in row_ids:
                score += TARGET_BONUS
                reasons.append("Playbook target for this pick")
                source = "target"
            elif pid in later_ids:
                score += LATER_TARGET_BONUS
                reasons.append("Playbook target for a later pick")
                source = "later_target"
            if win:
                score += ALIGN_WEIGHT * sum(max(r["z"].get(c, 0.0), 0.0) for c in win)
                strong = [LABELS[c] for c in sorted(win, key=lambda c: -r["z"].get(c, 0.0)) if r["z"].get(c, 0.0) >= 0.75][:3]
                if strong:
                    reasons.append(f"Branch categories: {', '.join(strong)}")
            if center_bonus and "C" in positions.get(pid, ()):
                score += center_bonus
                reasons.append("C-eligible, which the plan needs")
            for rule, prog in branch_rules:
                bonus = _need_bonus([prog])
                if bonus and pid in stats.index and stats.at[pid, rule["stat"]] >= rule["threshold"]:
                    score += bonus
                    reasons.append(f"One of the {rule['label']} the plan needs")
            if pid in avoid or player_teams.get(pid) in avoid_teams:
                score -= AVOID_PENALTY
                reasons.append("Playbook: avoid in this build")
            elif pid in fades:
                score -= FADE_PENALTY
                reasons.append("Playbook fade")
            suggestions.append(_suggestion(pid, names, r, score, avail(pid), reasons, source))
        suggestions.sort(key=lambda s: s["score"], reverse=True)
        suggestions = suggestions[:MAX_SUGGESTIONS]

    if row and not ({ids[n] for n in row["targets"] if n in ids} & available.keys()):
        alerts.append({"level": "info", "text": f"Every playbook target for #{status.get('my_next_pick')} is gone. The list below is the best fits for your branch."})

    playbook_ids = set(ids.values()) | {s["player_id"] for s in suggestions}
    return {
        "branch": {"id": branch["id"], "how": how} if branch else None,
        "next_pick": status.get("my_next_pick"),
        "following_pick": status.get("my_following_pick"),
        "row_index": (branch["rounds"].index(row) if branch and row else None),
        "alerts": alerts,
        "suggestions": suggestions,
        "pair": pair_plan(suggestions, status) if branch else None,
        "centers": center_progress,
        "availability": {pid: availability(pid, taken, adp, positions, status) for pid in playbook_ids},
    }


def _suggestion(pid: int, names: dict[int, str], row: dict, score: float, avail: str, reasons: list[str], source: str) -> dict:
    return {"player_id": int(pid), "name": names.get(pid, str(pid)), "score": round(float(score), 3),
            "fit": row["fit"], "availability": avail, "reasons": reasons, "source": source}


def _upcoming_picks(settings: dict, status: dict, made: set[int]) -> list[int]:
    if not settings.get("my_slot") or status.get("current_pick") is None:
        return []
    return [p for p in picks_for_slot(settings["my_slot"], settings["num_teams"], settings["rounds"])
            if p >= status["current_pick"] and p not in made]


def _ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
