import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import draft, league, players
from app.db import init_db
from app.yahoo_sync import poll_draft_forever

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    poller = asyncio.create_task(poll_draft_forever())
    yield
    poller.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await poller


app = FastAPI(title="Fantasy Basketball Assistant", lifespan=lifespan)
app.include_router(players.router)
app.include_router(draft.router)
app.include_router(league.router)


@app.get("/api/health")
def health():
    return {"ok": True}
