"""Jobs that pull external data into SQLite."""

import logging
from collections import defaultdict

from sqlmodel import Session, select

from app.config import CURRENT_SEASON, LAST_SEASON
from app.db import Adp, Player, StatLine, set_setting, utcnow
from app.names import normalize
from app.sources import espn, nba_stats

log = logging.getLogger(__name__)


def _upsert_statline(session: Session, player_id: int, source: str, season: str, stats: dict) -> None:
    line = session.get(StatLine, (player_id, source, season)) or StatLine(
        player_id=player_id, source=source, season=season
    )
    for col, value in stats.items():
        setattr(line, col, value)
    line.updated_at = utcnow()
    session.add(line)


def sync_projections(session: Session) -> dict:
    rows = espn.fetch_projections()
    for row in rows:
        player = session.exec(select(Player).where(Player.espn_id == row["espn_id"])).first()
        if player is None:
            player = Player(espn_id=row["espn_id"], name=row["name"], norm_name="")
        player.name = row["name"]
        player.norm_name = normalize(row["name"])
        player.team = row["team"]
        player.positions = row["positions"]
        player.injury_status = row["injury_status"]
        session.add(player)
        session.flush()

        _upsert_statline(session, player.id, "espn_proj", CURRENT_SEASON, row["stats"])
        if row["adp"] and row["adp"] < 500:  # ESPN reports 500 for "undrafted"
            adp = session.get(Adp, (player.id, "espn")) or Adp(player_id=player.id, source="espn", avg_pick=0)
            adp.avg_pick = row["adp"]
            adp.pct_drafted = row["pct_owned"]
            session.add(adp)

    set_setting(session, "projections_synced_at", utcnow().isoformat())
    session.commit()
    log.info("ESPN projections: %d players", len(rows))
    return {"players": len(rows)}


def player_index(session: Session) -> dict[str, list[Player]]:
    index: dict[str, list[Player]] = defaultdict(list)
    for player in session.exec(select(Player)):
        index[player.norm_name].append(player)
    return index


def match_player(index: dict[str, list[Player]], name: str, team: str | None = None) -> Player | None:
    candidates = index.get(normalize(name), [])
    if len(candidates) > 1 and team:
        candidates = [p for p in candidates if p.team == team] or candidates
    return candidates[0] if len(candidates) == 1 else None


def sync_last_season(session: Session, season: str = LAST_SEASON) -> dict:
    rows = nba_stats.fetch_season_per_game(season)
    index = player_index(session)
    unmatched = []
    for row in rows:
        player = match_player(index, row["name"], row["team"])
        if player is None:
            if row["stats"]["min"] >= 20 and row["stats"]["gp"] >= 20:
                unmatched.append(row["name"])
            continue
        player.nba_id = row["nba_id"]
        session.add(player)
        _upsert_statline(session, player.id, "nba_actual", season, row["stats"])

    set_setting(session, "last_season_synced_at", utcnow().isoformat())
    session.commit()
    log.info("nba_api %s: %d rows, %d regulars unmatched", season, len(rows), len(unmatched))
    return {"rows": len(rows), "unmatched_regulars": sorted(unmatched)}
