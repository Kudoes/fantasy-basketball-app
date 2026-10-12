"""Loads database rows into the DataFrames the engine works on."""

from dataclasses import dataclass

import pandas as pd
from sqlmodel import Session, select

from app.config import CURRENT_SEASON, LAST_SEASON
from app.db import Adp, DraftPick, Player, StatLine, Team
from app.engine.categories import STAT_COLUMNS
from app.engine.draft import Pick

PROJECTION_SOURCE = "espn_proj"
ADP_PRIORITY = ("yahoo", "espn")


@dataclass
class PlayerData:
    stats: pd.DataFrame  # projections, indexed by player_id
    players: dict[int, Player]
    last_season: dict[int, StatLine]
    adp: dict[int, tuple[float, str]]  # player_id -> (avg pick, source)

    @property
    def positions(self) -> dict[int, list[str]]:
        return {pid: [x for x in p.positions.split(",") if x] for pid, p in self.players.items()}

    @property
    def adp_values(self) -> dict[int, float]:
        return {pid: pick for pid, (pick, _) in self.adp.items()}


def load_player_data(session: Session) -> PlayerData:
    lines = session.exec(
        select(StatLine).where(StatLine.source == PROJECTION_SOURCE, StatLine.season == CURRENT_SEASON)
    ).all()
    stats = pd.DataFrame(
        [{"player_id": l.player_id, **{c: getattr(l, c) for c in STAT_COLUMNS}} for l in lines],
        columns=["player_id", *STAT_COLUMNS],
    ).set_index("player_id")

    players = {p.id: p for p in session.exec(select(Player))}
    last = {
        l.player_id: l
        for l in session.exec(
            select(StatLine).where(StatLine.source == "nba_actual", StatLine.season == LAST_SEASON)
        )
    }
    adp: dict[int, tuple[float, str]] = {}
    for row in sorted(session.exec(select(Adp)), key=lambda a: ADP_PRIORITY.index(a.source), reverse=True):
        adp[row.player_id] = (row.avg_pick, row.source)  # higher-priority sources overwrite
    return PlayerData(stats=stats, players=players, last_season=last, adp=adp)


def load_picks(session: Session) -> list[Pick]:
    return [
        Pick(overall=p.overall, team_slot=p.team_slot, player_id=p.player_id, source=p.source)
        for p in session.exec(select(DraftPick).order_by(DraftPick.overall))
    ]


def load_teams(session: Session, num_teams: int) -> list[Team]:
    stored = {t.slot: t for t in session.exec(select(Team))}
    return [stored.get(slot) or Team(slot=slot, name=f"Team {slot}") for slot in range(1, num_teams + 1)]
