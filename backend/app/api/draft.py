from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import delete

from app.data import load_picks, load_player_data, load_teams
from app.db import DraftPick, get_session, get_settings
from app.engine.draft import DraftConfig, build_draft_state, round_for_pick, slot_for_pick
from app.yahoo_sync import yahoo_sync

router = APIRouter(prefix="/api/draft")


def _config(settings: dict) -> DraftConfig:
    return DraftConfig(
        num_teams=settings["num_teams"],
        rounds=settings["rounds"],
        my_slot=settings["my_slot"],
        punts=settings["punts"],
        value_mode=settings["value_mode"],
        roster_positions=settings["roster_positions"],
    )


@router.get("/state")
def draft_state():
    with get_session() as session:
        settings = get_settings(session)
        data = load_player_data(session)
        picks = load_picks(session)
        teams = load_teams(session, settings["num_teams"])

    stats = data.stats
    # Drafted players with no projection still count as picks; give them an empty line.
    missing = [p.player_id for p in picks if p.player_id not in stats.index]
    if missing:
        stats = stats.reindex(stats.index.union(missing), fill_value=0.0)

    state = build_draft_state(stats, data.positions, data.adp_values, picks, _config(settings))
    names = {t.slot: t for t in teams}
    for team in state["teams"]:
        t = names[team["slot"]]
        team.update(name=t.name, manager=t.manager, is_mine=team["slot"] == settings["my_slot"])
    state["drafted_players"] = {
        p.player_id: {"name": data.players[p.player_id].name, "team": data.players[p.player_id].team,
                      "positions": data.positions.get(p.player_id, [])}
        for p in picks
    }
    state["settings"] = {k: settings[k] for k in ("num_teams", "rounds", "my_slot", "punts", "value_mode", "sync_mode", "roster_positions")}
    state["sync"] = yahoo_sync.status()
    return state


class PickIn(BaseModel):
    player_id: int
    overall: int | None = None
    team_slot: int | None = None


@router.post("/picks")
def add_pick(body: PickIn):
    with get_session() as session:
        settings = get_settings(session)
        if settings["sync_mode"] == "yahoo":
            raise HTTPException(409, "Picks come from Yahoo while live sync is on. Switch to manual mode to edit.")
        picks = load_picks(session)
        if any(p.player_id == body.player_id for p in picks):
            raise HTTPException(409, "That player has already been drafted.")
        n_teams, total = settings["num_teams"], settings["num_teams"] * settings["rounds"]
        made = {p.overall for p in picks}
        overall = body.overall or next((o for o in range(1, total + 1) if o not in made), None)
        if overall is None:
            raise HTTPException(409, "The draft is complete.")
        if overall in made:
            raise HTTPException(409, f"Pick {overall} has already been made.")
        session.add(DraftPick(
            overall=overall,
            round=round_for_pick(overall, n_teams),
            team_slot=body.team_slot or slot_for_pick(overall, n_teams),
            player_id=body.player_id,
        ))
        session.commit()
    return {"overall": overall}


@router.delete("/picks/{overall}")
def remove_pick(overall: int):
    with get_session() as session:
        if get_settings(session)["sync_mode"] == "yahoo":
            raise HTTPException(409, "Picks come from Yahoo while live sync is on.")
        pick = session.get(DraftPick, overall)
        if pick is None:
            raise HTTPException(404, "No such pick.")
        session.delete(pick)
        session.commit()
    return {"removed": overall}


@router.post("/reset")
def reset_draft():
    with get_session() as session:
        session.exec(delete(DraftPick))
        session.commit()
    return {"ok": True}
