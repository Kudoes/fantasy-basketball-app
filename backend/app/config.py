import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
ENV_FILE = ROOT_DIR / ".env"
DB_PATH = DATA_DIR / "app.db"

load_dotenv(ENV_FILE)

# The season we are drafting for. Yahoo and nba_api label seasons by start year
# ("2026-27" / 2026); ESPN labels them by end year (2027).
SEASON_START_YEAR = 2026
ESPN_SEASON = SEASON_START_YEAR + 1


def season_label(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[-2:]}"


CURRENT_SEASON = season_label(SEASON_START_YEAR)
LAST_SEASON = season_label(SEASON_START_YEAR - 1)

YAHOO_LEAGUE_ID = os.getenv("YAHOO_LEAGUE_ID", "38764")
