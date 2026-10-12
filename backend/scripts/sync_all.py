"""Pull projections and last season's stats into the local database: `npm run sync`."""

import logging

from app.db import get_session, init_db
from app.sync import sync_last_season, sync_projections


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    init_db()
    with get_session() as session:
        print("ESPN projections:", sync_projections(session))
        print("Last season (nba_api):", sync_last_season(session))


if __name__ == "__main__":
    main()
