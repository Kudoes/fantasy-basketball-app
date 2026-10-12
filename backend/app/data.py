"""Loads database rows into the DataFrames the engine works on."""

from dataclasses import dataclass

import pandas as pd
from sqlmodel import Session, select

from app.config import CURRENT_SEASON, LAST_SEASON
from app.db import Adp, DraftPick, Player, StatLine, Team
from app.engine.categories import STAT_COLUMNS
from app.engine.draft import Pick
from app.playbook import ids_for_players, load_playbook, merge_positions, position_overrides

PROJECTION_SOURCE = "espn_proj"
# Live Yahoo ADP if we ever get API access, then the analysis's Yahoo ADP, then ESPN's.
ADP_PRIORITY = ("yahoo", "playbook", "espn")


@dataclass
class PlayerData:
    stats: pd.DataFrame  # projections, indexed by player_id
    players: dict[int, Player]
    last_season: dict[int, StatLine]
    adp: dict[int, tuple[float, str]]  # player_id -> (avg pick, source)

    @property
    def positions(self) -> dict[int, list[str]]:
        overrides = position_overrides()
        out = {}
        for pid, p in self.players.items():
            base = [x for x in p.positions.split(",") if x]
            extra = overrides.get(p.norm_name)
            out[pid] = merge_positions(base, extra) if extra else base
        return out

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
    rows = [(a.player_id, a.avg_pick, a.source) for a in session.exec(select(Adp))]
    rows += _playbook_adp(players)
    adp: dict[int, tuple[float, str]] = {}
    for pid, pick, source in sorted(rows, key=lambda r: ADP_PRIORITY.index(r[2]), reverse=True):
        adp[pid] = (pick, source)  # higher-priority sources overwrite
    return PlayerData(stats=stats, players=players, last_season=last, adp=adp)


def _playbook_adp(players: dict[int, Player]) -> list[tuple[int, float, str]]:
    """Yahoo ADP quoted in the analysis. Yahoo's 2-C rosters push centers far earlier than ESPN ADP."""
    playbook = load_playbook()
    if not playbook:
        return []
    ids = ids_for_players(playbook, players.values())
    return [(ids[name], float(pick), "playbook") for name, pick in playbook.get("yahoo_adp", {}).items() if name in ids]


def load_picks(session: Session) -> list[Pick]:
    return [
        Pick(overall=p.overall, team_slot=p.team_slot, player_id=p.player_id, source=p.source)
        for p in session.exec(select(DraftPick).order_by(DraftPick.overall))
    ]


def load_teams(session: Session, num_teams: int) -> list[Team]:
    stored = {t.slot: t for t in session.exec(select(Team))}
    return [stored.get(slot) or Team(slot=slot, name=f"Team {slot}") for slot in range(1, num_teams + 1)]
