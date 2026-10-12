from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import YAHOO_LEAGUE_ID
from app.data import load_teams
from app.db import Team, get_session, get_settings, set_setting
from app.engine.categories import CATEGORY_KEYS
from app.sources.yahoo import YahooNotConnected, explain_error
from app.sync import sync_last_season, sync_projections
from app.yahoo_sync import yahoo_sync

router = APIRouter(prefix="/api")


@router.get("/league")
def league():
    with get_session() as session:
        settings = get_settings(session)
        teams = load_teams(session, settings["num_teams"])
    return {
        "league_id": settings["league_id"] or YAHOO_LEAGUE_ID,
        "yahoo": settings.get("yahoo_league"),
        "settings": {k: settings[k] for k in ("num_teams", "rounds", "my_slot", "punts", "value_mode", "sync_mode", "roster_positions", "playbook_branch")},
        "teams": [t.model_dump() for t in teams],
        "synced_at": {
            "projections": settings.get("projections_synced_at"),
            "last_season": settings.get("last_season_synced_at"),
            "yahoo": settings.get("yahoo_synced_at"),
        },
        "connection": yahoo_sync.status(),
    }


class SettingsIn(BaseModel):
    league_id: str | None = Field(None, pattern=r"^\d+$")
    num_teams: int | None = Field(None, ge=2, le=30)
    rounds: int | None = Field(None, ge=1, le=30)
    my_slot: int | None = Field(None, ge=1, le=30)
    punts: list[str] | None = None
    value_mode: Literal["per_game", "total"] | None = None
    sync_mode: Literal["manual", "yahoo"] | None = None
    playbook_branch: str | None = Field(None, pattern=r"^[A-Z]$")


@router.put("/settings")
def update_settings(body: SettingsIn):
    changes = body.model_dump(exclude_unset=True)
    if "punts" in changes:
        unknown = set(changes["punts"]) - set(CATEGORY_KEYS)
        if unknown:
            raise HTTPException(422, f"Unknown categories: {sorted(unknown)}")
    with get_session() as session:
        for key, value in changes.items():
            set_setting(session, key, value)
        session.commit()
        return {k: v for k, v in get_settings(session).items() if k in changes}


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


@router.put("/teams/{slot}")
def rename_team(slot: int, body: TeamIn):
    with get_session() as session:
        team = session.get(Team, slot) or Team(slot=slot, name=body.name)
        team.name = body.name
        session.add(team)
        session.commit()
    return {"slot": slot, "name": body.name}


@router.post("/sync/projections")
def run_sync_projections():
    with get_session() as session:
        return sync_projections(session)


@router.post("/sync/last-season")
def run_sync_last_season():
    with get_session() as session:
        return sync_last_season(session)


@router.post("/sync/yahoo")
def run_sync_yahoo():
    with get_session() as session:
        try:
            result = yahoo_sync.sync_league(session)
        except YahooNotConnected as exc:
            raise HTTPException(400, str(exc))
        except Exception as exc:
            raise HTTPException(502, f"Yahoo sync failed: {explain_error(exc)}")
        try:
            result["draft_picks"] = yahoo_sync.sync_draft(session)
        except Exception as exc:
            result["draft_error"] = explain_error(exc)
        return result
