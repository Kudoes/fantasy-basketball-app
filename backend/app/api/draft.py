from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import delete, select

from app.data import load_picks, load_player_data, load_teams
from app.db import DraftPick, Player, get_session, get_settings
from app.engine.categories import CATEGORY_KEYS
from app.engine.draft import DraftConfig, Pick, build_draft_state, round_for_pick, shift_picks, slot_for_pick
from app.engine.plan import build_plan
from app.engine.valuation import compute_values
from app.names import normalize
from app.playbook import ids_for_players, load_playbook
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

    # Drafted players without a projection still count as picks; they just add nothing to category totals.
    positions = data.positions
    state = build_draft_state(data.stats, positions, data.adp_values, picks, _config(settings))
    names = {t.slot: t for t in teams}
    for team in state["teams"]:
        t = names[team["slot"]]
        team.update(name=t.name, manager=t.manager, is_mine=team["slot"] == settings["my_slot"])
    state["drafted_players"] = {
        p.player_id: {"name": data.players[p.player_id].name, "team": data.players[p.player_id].team,
                      "positions": positions.get(p.player_id, [])}
        for p in picks
    }
    state["plan"] = _plan(state, settings, data, positions)
    state["settings"] = {k: settings[k] for k in ("num_teams", "rounds", "my_slot", "punts", "value_mode", "sync_mode", "roster_positions", "playbook_branch")}
    state["sync"] = yahoo_sync.status()
    return state


def _require_manual(settings: dict) -> None:
    if settings["sync_mode"] == "yahoo":
        raise HTTPException(409, "Picks come from Yahoo while live sync is on. Switch to manual mode to edit.")


def _save_picks(session, picks: list[Pick], num_teams: int) -> None:
    """Rewrites the whole pick list (at most a few hundred rows), so overall numbers can move freely."""
    session.exec(delete(DraftPick))
    session.flush()
    for p in picks:
        session.add(DraftPick(
            overall=p.overall,
            round=round_for_pick(p.overall, num_teams),
            team_slot=p.team_slot,
            player_id=p.player_id,
            source=p.source,
        ))


def _plan(state: dict, settings: dict, data, positions: dict) -> dict | None:
    """The playbook re-read against this exact draft state (None without a playbook)."""
    playbook = load_playbook()
    if not playbook:
        return None
    static = compute_values(data.stats, pool_size=settings["num_teams"] * settings["rounds"], mode=settings["value_mode"])
    return build_plan(
        playbook,
        ids_for_players(playbook, data.players.values()),
        state,
        settings,
        data.stats,
        positions,
        data.adp_values,
        {pid: p.name for pid, p in data.players.items()},
        {pid: p.team for pid, p in data.players.items()},
        static[[f"z_{k}" for k in CATEGORY_KEYS]],
    )


class PickIn(BaseModel):
    player_id: int | None = None
    player_name: str | None = Field(None, min_length=2, max_length=60)  # a player the app doesn't list
    overall: int | None = None
    team_slot: int | None = None
    insert: bool = False  # a missed pick: move this pick and every later one back a spot


@router.post("/picks")
def add_pick(body: PickIn):
    with get_session() as session:
        settings = get_settings(session)
        _require_manual(settings)
        if body.player_id is None:
            if not body.player_name:
                raise HTTPException(422, "Give a player_id or a player_name.")
            body.player_id = _find_or_create_player(session, body.player_name.strip())
        picks = load_picks(session)
        if any(p.player_id == body.player_id for p in picks):
            raise HTTPException(409, "That player has already been drafted.")
        n_teams, total = settings["num_teams"], settings["num_teams"] * settings["rounds"]
        made = {p.overall for p in picks}
        overall = body.overall or max(made, default=0) + 1  # same rule as the draft clock
        if overall > total and not body.overall:
            raise HTTPException(409, "The draft is complete.")
        if not 1 <= overall <= total:
            raise HTTPException(422, f"Pick must be between 1 and {total}.")
        team_slot = body.team_slot or slot_for_pick(overall, n_teams)

        if body.insert:
            if max(made, default=0) >= total:
                raise HTTPException(409, "Can't insert: the last pick of the draft is already filled.")
            shifted = shift_picks(picks, overall, +1, n_teams)
            _save_picks(session, [*shifted, Pick(overall, team_slot, body.player_id)], n_teams)
        else:
            if overall in made:
                raise HTTPException(409, f"Pick {overall} has already been made.")
            session.add(DraftPick(
                overall=overall,
                round=round_for_pick(overall, n_teams),
                team_slot=team_slot,
                player_id=body.player_id,
            ))
        session.commit()
    return {"overall": overall}


def _find_or_create_player(session, name: str) -> int:
    norm = normalize(name)
    player = session.exec(select(Player).where(Player.norm_name == norm)).first()
    if player is None:
        player = Player(name=name, norm_name=norm)
        session.add(player)
        session.flush()
    return player.id


class ReplaceIn(BaseModel):
    player_id: int


@router.put("/picks/{overall}")
def replace_pick(overall: int, body: ReplaceIn):
    with get_session() as session:
        _require_manual(get_settings(session))
        pick = session.get(DraftPick, overall)
        if pick is None:
            raise HTTPException(404, "No such pick.")
        if any(p.player_id == body.player_id and p.overall != overall for p in load_picks(session)):
            raise HTTPException(409, "That player has already been drafted.")
        pick.player_id = body.player_id
        pick.source = "manual"
        session.add(pick)
        session.commit()
    return {"overall": overall}


@router.delete("/picks/{overall}")
def remove_pick(overall: int, shift: bool = False):
    """Removes one pick. With shift=true, later picks move up a spot (fixes a pick recorded twice)."""
    with get_session() as session:
        settings = get_settings(session)
        _require_manual(settings)
        picks = load_picks(session)
        if not any(p.overall == overall for p in picks):
            raise HTTPException(404, "No such pick.")
        remaining = [p for p in picks if p.overall != overall]
        if shift:
            remaining = shift_picks(remaining, overall + 1, -1, settings["num_teams"])
        _save_picks(session, remaining, settings["num_teams"])
        session.commit()
    return {"removed": overall, "shifted": shift}


@router.post("/reset")
def reset_draft():
    with get_session() as session:
        session.exec(delete(DraftPick))
        session.commit()
    return {"ok": True}
