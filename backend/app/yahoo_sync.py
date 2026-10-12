"""Copies Yahoo league data and live draft picks into the local database."""

import asyncio
import logging
import threading
from datetime import datetime

from sqlmodel import Session, delete, select

from app.config import YAHOO_LEAGUE_ID
from app.db import Adp, DraftPick, Player, Team, get_session, get_settings, set_setting, utcnow
from app.engine.draft import round_for_pick, slot_for_pick
from app.names import normalize
from app.sources import yahoo
from app.sync import match_player, player_index

log = logging.getLogger(__name__)
POLL_SECONDS = 4


class YahooSync:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._query = None
        self._query_league: str | None = None
        self.last_draft_sync: datetime | None = None
        self.last_error: str | None = None

    def league_id(self, session: Session) -> str:
        return str(get_settings(session).get("league_id") or YAHOO_LEAGUE_ID)

    def _get_query(self, league_id: str):
        if self._query is None or self._query_league != league_id:
            self._query = yahoo.make_query(league_id)
            self._query_league = league_id
        return self._query

    def status(self) -> dict:
        return {
            **yahoo.connection_status(),
            "last_draft_sync": self.last_draft_sync.isoformat() if self.last_draft_sync else None,
            "last_error": self.last_error,
        }

    # --- League import --------------------------------------------------------------------

    def sync_league(self, session: Session) -> dict:
        with self._lock:
            try:
                query = self._get_query(self.league_id(session))
                league = yahoo.fetch_league(query)
                players = yahoo.fetch_players_with_adp(query)
            except Exception as exc:
                self._query = None
                self.last_error = yahoo.explain_error(exc)
                raise

        slots = self._save_teams(session, league)
        set_setting(session, "num_teams", league["num_teams"])
        set_setting(session, "roster_positions", league["roster_positions"])
        set_setting(session, "rounds", sum(1 for p in league["roster_positions"] if p not in ("IL", "IL+")))
        mine = next((t for t in league["teams"] if t["is_mine"]), None)
        if mine and mine["draft_position"]:
            set_setting(session, "my_slot", mine["draft_position"])
        set_setting(session, "yahoo_league", {k: v for k, v in league.items() if k != "teams"})

        matched, unmatched = self._save_players(session, players)
        set_setting(session, "yahoo_synced_at", utcnow().isoformat())
        session.commit()
        self.last_error = None
        return {
            "league": league["name"],
            "teams": len(league["teams"]),
            "draft_order_known": len(slots) == league["num_teams"],
            "players_matched": matched,
            "players_unmatched": unmatched[:40],
        }

    def _save_teams(self, session: Session, league: dict) -> dict[str, int]:
        """Stores teams by draft slot. Returns team_key -> slot for teams with a known slot."""
        session.exec(delete(Team))
        slots: dict[str, int] = {}
        unslotted = []
        for t in league["teams"]:
            if t["draft_position"]:
                slots[t["team_key"]] = t["draft_position"]
            else:
                unslotted.append(t)
        free = [s for s in range(1, league["num_teams"] + 1) if s not in slots.values()]
        for t in league["teams"]:
            slot = slots.get(t["team_key"]) or free.pop(0)
            session.add(Team(slot=slot, name=t["name"], team_key=t["team_key"], manager=t["manager"], is_mine=t["is_mine"]))
        return slots

    def _save_players(self, session: Session, players: list[dict]) -> tuple[int, list[str]]:
        index = player_index(session)
        matched, unmatched = 0, []
        for p in players:
            player = match_player(index, p["name"], p["team"])
            if player is None:
                unmatched.append(p["name"])
                continue
            matched += 1
            player.yahoo_key = p["player_key"]
            if p["positions"]:
                player.positions = ",".join(p["positions"])  # Yahoo eligibility is what the league uses
            session.add(player)
            if p["adp"]:
                adp = session.get(Adp, (player.id, "yahoo")) or Adp(player_id=player.id, source="yahoo", avg_pick=0)
                adp.avg_pick = p["adp"]
                adp.pct_drafted = float(p["pct_drafted"]) if p["pct_drafted"] not in (None, "-") else None
                session.add(adp)
        return matched, unmatched

    # --- Live draft -------------------------------------------------------------------------

    def sync_draft(self, session: Session) -> int:
        """Mirrors Yahoo's draft results into draft_pick. Returns the number of picks made."""
        settings = get_settings(session)
        with self._lock:
            try:
                query = self._get_query(self.league_id(session))
                all_results = yahoo.fetch_draft_results(query)
                results = [r for r in all_results if r["player_key"]]
                known = {p.yahoo_key: p for p in session.exec(select(Player).where(Player.yahoo_key.is_not(None)))}
                missing = sorted({r["player_key"] for r in results} - known.keys())
                extra = yahoo.fetch_players_by_key(query, missing) if missing else []
            except Exception as exc:
                self._query = None
                self.last_error = yahoo.explain_error(exc)
                raise

        for p in extra:  # drafted players we had no projection for
            index = player_index(session)
            player = match_player(index, p["name"], p["team"]) or Player(name=p["name"], norm_name=normalize(p["name"]), team=p["team"])
            player.yahoo_key = p["player_key"]
            player.positions = player.positions or ",".join(p["positions"])
            session.add(player)
            session.flush()
            known[p["player_key"]] = player

        n_teams = settings["num_teams"]
        self._apply_draft_order(session, all_results, n_teams)
        team_slots = {t.team_key: t.slot for t in session.exec(select(Team)) if t.team_key}
        session.exec(delete(DraftPick))
        for r in results:
            player = known.get(r["player_key"])
            if player is None:
                continue
            session.add(DraftPick(
                overall=r["pick"],
                round=round_for_pick(r["pick"], n_teams),
                team_slot=team_slots.get(r["team_key"]) or slot_for_pick(r["pick"], n_teams),
                player_id=player.id,
                source="yahoo",
            ))
        session.commit()
        self.last_draft_sync = utcnow()
        self.last_error = None
        return len(results)

    def _apply_draft_order(self, session: Session, results: list[dict], n_teams: int) -> None:
        """Yahoo may only publish the draft order once the draft starts; round 1 pick k is slot k."""
        order = {r["team_key"]: r["pick"] for r in results if r["round"] == 1 and r["team_key"]}
        teams = list(session.exec(select(Team)))
        if len(order) != n_teams or not teams or all(order.get(t.team_key) == t.slot for t in teams):
            return
        snapshot = [(order.get(t.team_key), t.name, t.team_key, t.manager, t.is_mine) for t in teams]
        session.exec(delete(Team))
        session.flush()
        for slot, name, team_key, manager, is_mine in snapshot:
            if slot is None:
                continue
            session.add(Team(slot=slot, name=name, team_key=team_key, manager=manager, is_mine=is_mine))
            if is_mine:
                set_setting(session, "my_slot", slot)
        log.info("Draft order updated from Yahoo draft results")


yahoo_sync = YahooSync()


async def poll_draft_forever() -> None:
    """While sync mode is "yahoo", mirror the draft every few seconds."""
    while True:
        try:
            with get_session() as session:
                if get_settings(session)["sync_mode"] == "yahoo":
                    await asyncio.to_thread(yahoo_sync.sync_draft, session)
        except yahoo.YahooNotConnected as exc:
            yahoo_sync.last_error = str(exc)
        except Exception as exc:  # keep polling; surface the error in the UI
            log.warning("Yahoo draft sync failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
