from fastapi import APIRouter

from app.db import get_session
from app.playbook import load_playbook, resolve_names
from app.sync import player_index

router = APIRouter(prefix="/api")


@router.get("/playbook")
def playbook():
    data = load_playbook()
    if data is None:
        return {"available": False}
    with get_session() as session:
        ids, unmatched = resolve_names(data, player_index(session))
    return {"available": True, **data, "ids": ids, "unmatched": unmatched}
