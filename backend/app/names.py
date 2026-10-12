"""Player-name normalization so ESPN, NBA.com and Yahoo names line up."""

import json
import re
import unicodedata
from functools import lru_cache

from app.config import DATA_DIR

OVERRIDES_FILE = DATA_DIR / "name_overrides.json"
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _base_normalize(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[.'’]", "", ascii_name.lower())
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned)
    tokens = [t for t in cleaned.split() if t not in SUFFIXES]
    return " ".join(tokens)


@lru_cache(maxsize=1)
def _overrides() -> dict[str, str]:
    """Maps a normalized alias to the normalized canonical name, e.g. "nic claxton" -> "nicolas claxton"."""
    if not OVERRIDES_FILE.exists():
        return {}
    raw = json.loads(OVERRIDES_FILE.read_text())
    return {_base_normalize(k): _base_normalize(v) for k, v in raw.items() if not k.startswith("_")}


def normalize(name: str) -> str:
    base = _base_normalize(name)
    return _overrides().get(base, base)
