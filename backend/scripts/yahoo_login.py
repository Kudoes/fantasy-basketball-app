"""One-time Yahoo login: `npm run yahoo:login`.

Opens Yahoo in your browser. Approve access, copy the code Yahoo shows, and paste it here.
The refreshable token is saved to .env; the app refreshes it automatically after that.
Running it again always starts a fresh login.
"""

import os
import sys

from app.config import YAHOO_LEAGUE_ID
from app.sources import yahoo


def main() -> None:
    status = yahoo.connection_status()
    if not status["credentials"]:
        sys.exit("Missing YAHOO_CONSUMER_KEY / YAHOO_CONSUMER_SECRET in .env (copy .env.example to .env first).")

    league_id = os.getenv("YAHOO_LEAGUE_ID") or YAHOO_LEAGUE_ID
    print(f"Connecting to Yahoo league {league_id}. A browser window will open...")
    query = yahoo.make_query(league_id, interactive=True)
    try:
        meta = query.get_league_metadata()
    except Exception as exc:
        sys.exit(f"\nLogged in, but reading the league failed:\n  {yahoo.explain_error(exc)}")
    name = meta.name.decode() if isinstance(meta.name, bytes) else meta.name
    print(f"\nConnected: {name} ({meta.num_teams} teams, draft status: {meta.draft_status})")
    print("Token saved to .env. Open the app's League page and click Import league.")


if __name__ == "__main__":
    main()
