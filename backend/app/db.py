import json
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Field, Session, SQLModel, create_engine, select

from app.config import DATA_DIR, DB_PATH

DATA_DIR.mkdir(parents=True, exist_ok=True)
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Player(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    norm_name: str = Field(index=True)
    team: str | None = None
    positions: str = ""  # comma-separated, e.g. "PG,SG"
    injury_status: str | None = None
    espn_id: int | None = Field(default=None, unique=True, index=True)
    nba_id: int | None = Field(default=None, index=True)
    yahoo_key: str | None = Field(default=None, index=True)


class StatLine(SQLModel, table=True):
    """Per-game averages for one player from one source and season."""

    player_id: int = Field(foreign_key="player.id", primary_key=True)
    source: str = Field(primary_key=True)  # "espn_proj" | "nba_actual"
    season: str = Field(primary_key=True)  # "2026-27"
    gp: float = 0
    min: float = 0
    pts: float = 0
    reb: float = 0
    ast: float = 0
    stl: float = 0
    blk: float = 0
    fg3m: float = 0
    fgm: float = 0
    fga: float = 0
    ftm: float = 0
    fta: float = 0
    tov: float = 0
    updated_at: datetime = Field(default_factory=utcnow)


class Adp(SQLModel, table=True):
    player_id: int = Field(foreign_key="player.id", primary_key=True)
    source: str = Field(primary_key=True)  # "yahoo" | "espn"
    avg_pick: float
    pct_drafted: float | None = None


class Team(SQLModel, table=True):
    slot: int = Field(primary_key=True)  # draft slot, 1..num_teams
    name: str
    team_key: str | None = None
    manager: str | None = None
    is_mine: bool = False


class DraftPick(SQLModel, table=True):
    overall: int = Field(primary_key=True)
    round: int
    team_slot: int
    player_id: int = Field(foreign_key="player.id")
    source: str = "manual"  # "manual" | "yahoo"
    created_at: datetime = Field(default_factory=utcnow)


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str  # JSON-encoded


DEFAULT_SETTINGS: dict[str, Any] = {
    "league_id": None,  # falls back to YAHOO_LEAGUE_ID
    "num_teams": 12,
    "rounds": 13,
    "my_slot": None,
    "punts": [],
    "value_mode": "per_game",  # "per_game" | "total"
    "sync_mode": "manual",  # "manual" | "yahoo"
    "playbook_branch": None,  # branch id chosen by hand; otherwise it follows your first pick
    "roster_positions": ["PG", "SG", "G", "SF", "PF", "F", "C", "C", "Util", "Util", "BN", "BN", "BN"],
}


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)


def get_setting(session: Session, key: str) -> Any:
    row = session.get(Setting, key)
    if row is None:
        return DEFAULT_SETTINGS.get(key)
    return json.loads(row.value)


def get_settings(session: Session) -> dict[str, Any]:
    stored = {row.key: json.loads(row.value) for row in session.exec(select(Setting))}
    return {**DEFAULT_SETTINGS, **stored}


def set_setting(session: Session, key: str, value: Any) -> None:
    row = session.get(Setting, key)
    if row is None:
        session.add(Setting(key=key, value=json.dumps(value)))
    else:
        row.value = json.dumps(value)
        session.add(row)
