"""NBA.com stats via nba_api (unofficial; works from a home connection)."""

from nba_api.stats.endpoints import leaguedashplayerstats

COLUMNS = {
    "GP": "gp", "MIN": "min", "PTS": "pts", "REB": "reb", "AST": "ast", "STL": "stl",
    "BLK": "blk", "FG3M": "fg3m", "FGM": "fgm", "FGA": "fga", "FTM": "ftm", "FTA": "fta", "TOV": "tov",
}


def fetch_season_per_game(season: str) -> list[dict]:
    """Per-game averages for every player who appeared in `season` (e.g. "2025-26")."""
    df = leaguedashplayerstats.LeagueDashPlayerStats(
        season=season, per_mode_detailed="PerGame", timeout=60
    ).get_data_frames()[0]
    return [
        {
            "nba_id": int(row["PLAYER_ID"]),
            "name": row["PLAYER_NAME"],
            "team": row["TEAM_ABBREVIATION"],
            "stats": {col: float(row[src] or 0) for src, col in COLUMNS.items()},
        }
        for _, row in df.iterrows()
    ]
