"""Category z-score player values (the Basketball Monster-style approach).

- The baseline is the pool of players who will actually be rostered (teams x roster spots),
  iterated so the pool and the averages computed from it agree.
- Percentages are weighted by volume: impact = attempts x (player % - pool %).
- Turnovers count against a player.
- Punted categories are left out of the total (and out of pool selection).
"""

from collections.abc import Iterable, Sequence

import numpy as np
import pandas as pd

from app.engine.categories import NINE_CAT, Category

COUNTING = ("pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "ftm", "fta", "tov")


def to_totals(stats: pd.DataFrame) -> pd.DataFrame:
    """Per-game lines -> season totals (projected games x per-game)."""
    out = stats.copy()
    for col in COUNTING:
        out[col] = out[col] * out["gp"]
    return out


def category_scores(
    stats: pd.DataFrame, pool_mask: pd.Series, categories: Sequence[Category] = NINE_CAT
) -> pd.DataFrame:
    """z-score of every player in every category, using the pool's mean and spread."""
    pool = stats[pool_mask]
    scores = {}
    for cat in categories:
        if cat.kind == "count":
            raw = stats[cat.stat]
            pool_raw = pool[cat.stat]
        else:
            attempts = pool[cat.attempts].sum()
            pool_pct = pool[cat.stat].sum() / attempts if attempts else 0.0
            raw = stats[cat.stat] - pool_pct * stats[cat.attempts]
            pool_raw = raw[pool_mask]
        sd = pool_raw.std(ddof=0)
        z = (raw - pool_raw.mean()) / sd if sd and not np.isnan(sd) else raw * 0.0
        scores[cat.key] = z if cat.higher_is_better else -z
    return pd.DataFrame(scores, index=stats.index)


def compute_values(
    stats: pd.DataFrame,
    pool_size: int,
    punts: Iterable[str] = (),
    mode: str = "per_game",
    categories: Sequence[Category] = NINE_CAT,
    iterations: int = 3,
) -> pd.DataFrame:
    """Returns z_<cat> columns, `value` (sum over non-punted cats) and `rank`, indexed like `stats`."""
    if stats.empty:
        return pd.DataFrame(columns=[*(f"z_{c.key}" for c in categories), "value", "rank"])

    data = to_totals(stats) if mode == "total" else stats
    active = [c.key for c in categories if c.key not in set(punts)]
    pool_size = max(2, min(pool_size, len(data)))

    # Start from everyone, then repeatedly re-select the top `pool_size` by value.
    pool_mask = pd.Series(True, index=data.index)
    for _ in range(iterations):
        scores = category_scores(data, pool_mask, categories)
        value = scores[active].sum(axis=1)
        pool_mask = value.rank(ascending=False, method="first") <= pool_size

    scores = category_scores(data, pool_mask, categories)
    result = scores.add_prefix("z_")
    result["value"] = scores[active].sum(axis=1)
    result["rank"] = result["value"].rank(ascending=False, method="first").astype(int)
    return result
