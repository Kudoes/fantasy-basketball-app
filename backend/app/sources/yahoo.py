"""Yahoo Fantasy Sports via yfpy (OAuth 2, read-only).

The one-time browser login happens in `npm run yahoo:login`, which saves a refreshable token
to .env. The server only builds a query when that token exists, so it never blocks on a
login prompt.
"""

import os
from typing import Any

from dotenv import load_dotenv
from yfpy.query import YahooFantasySportsQuery

from app.config import ENV_FILE, ROOT_DIR

PLAYER_BATCH = 25


class YahooNotConnected(RuntimeError):
    pass


def _text(value: Any) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else str(value or "")


def connection_status() -> dict:
    load_dotenv(ENV_FILE, override=True)
    has_credentials = bool(os.getenv("YAHOO_CONSUMER_KEY") and os.getenv("YAHOO_CONSUMER_SECRET"))
    # yfpy saves the token either as one JSON value or as separate fields.
    has_token = bool(os.getenv("YAHOO_ACCESS_TOKEN_JSON") or os.getenv("YAHOO_REFRESH_TOKEN"))
    return {"credentials": has_credentials, "token": has_token}


def explain_error(exc: Exception) -> str:
    """Turns Yahoo's error messages into something you can act on."""
    message = str(exc)
    if "not authorized to perform this action" in message:
        # Since July 2026 Yahoo only serves Fantasy data to apps approved through its access program
        # (github.com/uberfastman/yfpy/issues/84); app permissions alone no longer work.
        return (
            "Yahoo accepted the login but refused Fantasy data. Yahoo now requires approval for Fantasy API "
            "access: apply at sports.yahoo.com/developer/access (review takes 1-2 weeks). Use Manual mode "
            "until then."
        )
    if "league" in message.lower() and ("not found" in message.lower() or "invalid" in message.lower()):
        return (
            "Yahoo couldn't find that league for this account. Check the league ID, and approve the login "
            "with the Yahoo account that's in the league."
        )
    return message


def make_query(league_id: str, interactive: bool = False) -> YahooFantasySportsQuery:
    status = connection_status()
    if not status["credentials"]:
        raise YahooNotConnected("Add YAHOO_CONSUMER_KEY and YAHOO_CONSUMER_SECRET to .env")
    if not interactive and not status["token"]:
        raise YahooNotConnected("Run `npm run yahoo:login` once to connect your Yahoo account")
    return YahooFantasySportsQuery(
        league_id=str(league_id),
        game_code="nba",
        yahoo_consumer_key=os.environ["YAHOO_CONSUMER_KEY"],
        yahoo_consumer_secret=os.environ["YAHOO_CONSUMER_SECRET"],
        env_file_location=ROOT_DIR,
        save_token_data_to_env_file=True,
        browser_callback=interactive,
        # A login always starts fresh, so a token from a misconfigured app is never reused.
        env_var_fallback=not interactive,
    )


def _roster_positions(settings) -> list[str]:
    positions = []
    for item in settings.roster_positions or []:
        rp = getattr(item, "roster_position", item)
        positions.extend([rp.position] * int(rp.count or 1))
    return positions


def fetch_league(query: YahooFantasySportsQuery) -> dict:
    meta = query.get_league_metadata()
    settings = query.get_league_settings()
    teams = query.get_league_teams()
    return {
        "league_key": meta.league_key,
        "name": _text(meta.name),
        "num_teams": int(meta.num_teams),
        "draft_status": meta.draft_status,
        "season": meta.season,
        "draft_type": settings.draft_type,
        "is_auction": bool(settings.is_auction_draft),
        "draft_time": settings.draft_time,
        "roster_positions": _roster_positions(settings),
        "teams": [
            {
                "team_key": t.team_key,
                "name": _text(t.name),
                "manager": _text(getattr(t.manager, "nickname", "")) if getattr(t, "manager", None) else None,
                "draft_position": int(t.draft_position) if t.draft_position else None,
                "is_mine": bool(t.is_owned_by_current_login),
            }
            for t in teams
        ],
    }


def fetch_draft_results(query: YahooFantasySportsQuery) -> list[dict]:
    results = query.get_league_draft_results() or []
    if not isinstance(results, list):
        results = [results]
    return [
        {"pick": int(r.pick), "round": int(r.round), "team_key": r.team_key, "player_key": r.player_key or None}
        for r in (getattr(x, "draft_result", x) for x in results)
    ]


def _player_dict(p) -> dict:
    adp = getattr(p, "average_draft_pick", None)
    try:
        adp = float(adp) if adp not in (None, "-", "") else None
    except (TypeError, ValueError):
        adp = None
    return {
        "player_key": p.player_key,
        "name": _text(p.full_name or getattr(p.name, "full", "")),
        "team": (p.editorial_team_abbr or "").upper() or None,
        "positions": [x for x in (p.display_position or "").split(",") if x],
        "adp": adp,
        "pct_drafted": getattr(p, "percent_drafted", None),
    }


def _players_page(query: YahooFantasySportsQuery, start: int, sort: str | None) -> list[dict]:
    sort_part = f";sort={sort}" if sort else ""
    url = (
        f"https://fantasysports.yahooapis.com/fantasy/v2/league/{query.get_league_key()}/players;"
        f"start={start};count={PLAYER_BATCH}{sort_part}/draft_analysis"
    )
    data = query.query(url, ["league", "players"])
    players = data if isinstance(data, list) else [data] if data else []
    return [_player_dict(getattr(p, "player", p)) for p in players]


def fetch_players_with_adp(query: YahooFantasySportsQuery, limit: int = 400) -> list[dict]:
    """Top players by Yahoo's preseason rank (OR), with Yahoo ADP."""
    out: list[dict] = []
    sort: str | None = "OR"
    for start in range(0, limit, PLAYER_BATCH):
        try:
            page = _players_page(query, start, sort)
        except Exception:
            if sort and start == 0:  # fall back to Yahoo's default order
                sort = None
                page = _players_page(query, start, sort)
            else:
                raise
        if not page:
            break
        out.extend(page)
    return out


def fetch_players_by_key(query: YahooFantasySportsQuery, player_keys: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(player_keys), PLAYER_BATCH):
        keys = ",".join(player_keys[i:i + PLAYER_BATCH])
        url = f"https://fantasysports.yahooapis.com/fantasy/v2/league/{query.get_league_key()}/players;player_keys={keys}"
        data = query.query(url, ["league", "players"])
        players = data if isinstance(data, list) else [data] if data else []
        out.extend(_player_dict(getattr(p, "player", p)) for p in players)
    return out
