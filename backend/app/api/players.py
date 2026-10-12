from types import SimpleNamespace

from fastapi import APIRouter, Query

from app.config import CURRENT_SEASON, LAST_SEASON
from app.data import load_player_data
from app.db import get_session, get_settings
from app.engine.categories import NINE_CAT
from app.engine.valuation import compute_values

router = APIRouter(prefix="/api")


def _pct(makes: float, attempts: float) -> float | None:
    return round(makes / attempts, 4) if attempts else None


def _stat_line(line) -> dict:
    return {
        "gp": round(line.gp, 1), "min": round(line.min, 1),
        "pts": line.pts, "reb": line.reb, "ast": line.ast, "stl": line.stl, "blk": line.blk,
        "fg3m": line.fg3m, "tov": line.tov,
        "fgm": line.fgm, "fga": line.fga, "fg_pct": _pct(line.fgm, line.fga),
        "ftm": line.ftm, "fta": line.fta, "ft_pct": _pct(line.ftm, line.fta),
    }


def parse_punts(raw: str | None, default: list[str]) -> list[str]:
    if raw is None:
        return default
    valid = {c.key for c in NINE_CAT}
    return [k for k in raw.split(",") if k in valid]


@router.get("/players")
def list_players(
    punts: str | None = Query(None, description="Comma-separated category keys; defaults to saved punts"),
    mode: str | None = Query(None, pattern="^(per_game|total)$"),
):
    with get_session() as session:
        settings = get_settings(session)
        data = load_player_data(session)

    punt_list = parse_punts(punts, settings["punts"])
    value_mode = mode or settings["value_mode"]
    values = compute_values(
        data.stats, pool_size=settings["num_teams"] * settings["rounds"], punts=punt_list, mode=value_mode
    )

    positions = data.positions
    players = []
    for pid, row in values.sort_values("rank").iterrows():
        player = data.players[pid]
        proj = data.stats.loc[pid]
        adp = data.adp.get(pid)
        last = data.last_season.get(pid)
        players.append({
            "id": int(pid),
            "name": player.name,
            "team": player.team,
            "positions": positions[pid],
            "injury_status": player.injury_status,
            "rank": int(row["rank"]),
            "value": round(float(row["value"]), 3),
            "z": {c.key: round(float(row[f"z_{c.key}"]), 3) for c in NINE_CAT},
            "adp": round(adp[0], 1) if adp else None,
            "adp_source": adp[1] if adp else None,
            "proj": _stat_line(SimpleNamespace(**proj.to_dict())),
            "last": _stat_line(last) if last else None,
        })

    return {
        "season": CURRENT_SEASON,
        "last_season": LAST_SEASON,
        "punts": punt_list,
        "mode": value_mode,
        "categories": [{"key": c.key, "label": c.label} for c in NINE_CAT],
        "players": players,
    }
