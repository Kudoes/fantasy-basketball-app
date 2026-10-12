# Plan

Personal fantasy basketball assistant for a Yahoo H2H 9-cat league (league 38764, snake draft).
First milestone: a draft room that is ready for the draft on 2026-10-12 at 7:30 PM ET.
Code freeze: 2026-10-12 at 5:30 PM ET.

## Goals

**P0 (draft)**
1. Projections for every relevant player (ESPN public projections, $0).
2. 9-cat values: z-scores against the drafted-player pool, volume-weighted FG%/FT%, TO counted negative, punt toggles, per-game or season totals.
3. League import from Yahoo: settings, teams, draft slot, ADP.
4. Live draft room: picks sync from Yahoo (manual mode as a fallback), live best-available values, category profile vs. the league, recommendations with reasons, punt suggestions, ADP urgency.

**P1 (in season)**: nightly box-score ingestion (nba_api), My Team, waiver suggestions, matchup preview, trade analyzer, streaming.

**P2**: injury alerts, live scoring, multi-league, dynasty values, H-scoring.

## Architecture

```
ESPN projections ─┐
nba_api stats ────┼─► SQLite ─► engine (pandas) ─► FastAPI ─► React (Vite)
Yahoo (yfpy) ─────┘
```

| Layer | Choice |
|---|---|
| Frontend | Vite, React, TypeScript, Tailwind, shadcn/ui, TanStack Table + Query, React Router |
| Backend | FastAPI, pandas, SQLModel/SQLite, yfpy, nba_api |

## Data sources

| Source | Use | Notes |
|---|---|---|
| ESPN `kona_player_info` | Season projections, ESPN ADP, positions, injuries | Undocumented; snapshot saved to `backend/data/raw/` on each sync |
| nba_api (stats.nba.com) | Last-season actuals, in-season game logs | Unofficial; works from a home IP, often blocked from cloud IPs |
| Yahoo Fantasy API (yfpy) | League settings, teams, draft results, Yahoo ADP | OAuth, read-only |

## Engine

1. Pool = top `teams x roster spots` players; values are iterated so the pool and the averages agree.
2. Counting stats: `z = (x - pool mean) / pool sd`; TO is negated.
3. Percentages: `impact = attempts x (player % - pool %)`, then z-scored.
4. Punted categories are dropped from the total.
5. In the draft, values are recomputed against the players still available.
6. Fit = sum of category z weighted by team need + ADP urgency.

## Build order and cut line

1. Scaffold. 2. Data sync. 3. Engine + tests. 4. Rankings page. 5. Draft room (manual). 6. Yahoo sync. 7. Mock-draft rehearsal. 8. Freeze.

If behind, cut in this order: draft board grid, punt suggestions, ADP urgency, live Yahoo sync. Manual draft room is never cut.
