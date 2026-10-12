"""The draft playbook converted from the pre-draft analysis (data/playbook.json).

Names in the playbook are matched to players the same way ESPN and NBA.com names are.
"""

import json
from collections.abc import Iterable
from typing import Any

from app.config import DATA_DIR
from app.names import normalize

PLAYBOOK_FILE = DATA_DIR / "playbook.json"
POSITION_ORDER = ("PG", "SG", "SF", "PF", "C")

_cache: tuple[float, dict] | None = None


def load_playbook() -> dict | None:
    """Reads the playbook, re-reading whenever the file changes."""
    global _cache
    if not PLAYBOOK_FILE.exists():
        return None
    mtime = PLAYBOOK_FILE.stat().st_mtime
    if _cache is None or _cache[0] != mtime:
        _cache = (mtime, json.loads(PLAYBOOK_FILE.read_text()))
    return _cache[1]


def player_names(playbook: dict) -> set[str]:
    names: set[str] = set()
    names.update(p["name"] for p in playbook.get("pick9_priority", []))
    if playbook.get("not_at_9"):
        names.add(playbook["not_at_9"]["name"])
    for branch in playbook.get("branches", []):
        names.add(branch["anchor"])
        names.update(branch.get("avoid", []))
        for row in branch.get("rounds", []):
            names.update(row["targets"])
    for key in ("late_targets", "il_stashes", "fades"):
        names.update(p["name"] for p in playbook.get(key, []))
    for key in ("yahoo_adp", "teams", "yahoo_positions"):
        names.update(playbook.get(key, {}))
    return names


def resolve_names(playbook: dict, index: dict[str, list[Any]]) -> tuple[dict[str, int], list[str]]:
    """Maps each playbook name to a player id. Returns (ids, unmatched names)."""
    ids, unmatched = {}, []
    for name in sorted(player_names(playbook)):
        candidates = index.get(normalize(name), [])
        team = playbook.get("teams", {}).get(name)
        if len(candidates) > 1 and team:
            candidates = [p for p in candidates if p.team == team] or candidates
        if candidates:
            ids[name] = candidates[0].id
        else:
            unmatched.append(name)
    return ids, unmatched


def ids_for_players(playbook: dict, players: Iterable[Any]) -> dict[str, int]:
    index: dict[str, list[Any]] = {}
    for p in players:
        index.setdefault(p.norm_name, []).append(p)
    return resolve_names(playbook, index)[0]


def position_overrides() -> dict[str, list[str]]:
    """Yahoo eligibility from the analysis, keyed by normalized name. Only ever adds positions."""
    playbook = load_playbook() or {}
    return {normalize(name): positions for name, positions in playbook.get("yahoo_positions", {}).items()}


def merge_positions(base: list[str], extra: list[str]) -> list[str]:
    merged = set(base) | set(extra)
    return [p for p in POSITION_ORDER if p in merged]
