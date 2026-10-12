from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    kind: Literal["count", "pct"]
    stat: str  # counting column, or the "makes" column for percentages
    attempts: str | None = None
    higher_is_better: bool = True


NINE_CAT: tuple[Category, ...] = (
    Category("pts", "PTS", "count", "pts"),
    Category("reb", "REB", "count", "reb"),
    Category("ast", "AST", "count", "ast"),
    Category("stl", "STL", "count", "stl"),
    Category("blk", "BLK", "count", "blk"),
    Category("fg3m", "3PM", "count", "fg3m"),
    Category("fg_pct", "FG%", "pct", "fgm", "fga"),
    Category("ft_pct", "FT%", "pct", "ftm", "fta"),
    Category("tov", "TO", "count", "tov", higher_is_better=False),
)

CATEGORY_KEYS = tuple(c.key for c in NINE_CAT)
STAT_COLUMNS = ("gp", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "ftm", "fta", "tov")
