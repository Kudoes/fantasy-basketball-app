"""ESPN fantasy basketball public data: season projections, ADP, positions, injuries.

The endpoint is undocumented, so every sync saves the raw response to data/raw/ and
parsing is kept in one place. Stat ids follow cwendt94/espn-api's STATS_MAP.
"""

import json
from datetime import date
from typing import Any

import httpx

from app.config import ESPN_SEASON, RAW_DIR

BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons"

# averageStats keys -> our column names
STAT_IDS = {
    "0": "pts", "1": "blk", "2": "stl", "3": "ast", "6": "reb", "11": "tov",
    "13": "fgm", "14": "fga", "15": "ftm", "16": "fta", "17": "fg3m",
    "40": "min", "42": "gp",
}
SLOT_POSITIONS = {0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C"}
# ESPN's abbreviations -> standard NBA abbreviations
TEAM_FIXES = {"NO": "NOP", "GS": "GSW", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}


def _get(client: httpx.Client, url: str, **kwargs: Any) -> dict:
    resp = client.get(url, timeout=60, **kwargs)
    resp.raise_for_status()
    return resp.json()


def fetch_projections(season: int = ESPN_SEASON) -> list[dict]:
    """Returns one dict per player that has a full-season projection."""
    with httpx.Client(headers={"Accept": "application/json"}) as client:
        teams_raw = _get(client, f"{BASE}/{season}", params={"view": "proTeamSchedules_wl"})
        players_raw = _get(
            client,
            f"{BASE}/{season}/segments/0/leaguedefaults/3",
            params={"view": "kona_player_info"},
            # ESPN returns 400 unless the filter includes a sort.
            headers={"X-Fantasy-Filter": json.dumps({"players": {
                "limit": 2000,
                "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "STANDARD"},
            }})},
        )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / f"espn_players_{season}_{date.today().isoformat()}.json").write_text(json.dumps(players_raw))

    team_abbrev = {
        t["id"]: TEAM_FIXES.get(t["abbrev"], t["abbrev"]) for t in teams_raw["settings"]["proTeams"]
    }
    projection_id = f"10{season}"
    out = []
    for entry in players_raw["players"]:
        p = entry["player"]
        proj = next((s for s in p.get("stats", []) if s.get("id") == projection_id), None)
        avg = (proj or {}).get("averageStats") or {}
        if not avg or not avg.get("42"):
            continue
        ownership = p.get("ownership") or {}
        out.append({
            "espn_id": p["id"],
            "name": p["fullName"],
            "team": team_abbrev.get(p.get("proTeamId")),
            "positions": ",".join(SLOT_POSITIONS[s] for s in p.get("eligibleSlots", []) if s in SLOT_POSITIONS),
            "injury_status": p.get("injuryStatus"),
            "adp": ownership.get("averageDraftPosition"),
            "pct_owned": ownership.get("percentOwned"),
            "stats": {col: float(avg.get(sid, 0) or 0) for sid, col in STAT_IDS.items()},
        })
    return out
