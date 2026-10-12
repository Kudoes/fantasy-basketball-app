# Courtside

A personal fantasy basketball assistant for a Yahoo H2H 9-cat league: projections, z-score rankings with punting, and a live draft room that recommends picks for the team you're building. See [docs/PLAN.md](docs/PLAN.md) for goals and architecture.

## Setup

Requires Python 3.11+ and Node 20+.

```bash
# backend
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# frontend + dev runner
npm install
npm --prefix frontend install

# data: ESPN projections + last season's NBA stats
npm run sync
```

### Connect Yahoo (once)

1. Create an app at https://developer.yahoo.com/apps/create: Confidential Client, **Fantasy Sports: Read**, redirect URI `https://localhost:8080`.
2. `cp .env.example .env` and fill in `YAHOO_CONSUMER_KEY` / `YAHOO_CONSUMER_SECRET`.
3. `npm run yahoo:login`: approve access in the browser and paste the code Yahoo shows. The token is saved to `.env` and refreshes automatically.
4. In the app, open **League → Import league**.

## Run

```bash
npm run dev   # API on :8000, web app on http://localhost:5173
npm test      # engine tests
```

## Draft night

- **Draft Room** → set the sync toggle to **Yahoo live** to pull picks every few seconds, or **Manual** to click **Draft** for each pick.
- Rehearse in a Yahoo mock draft first: put the mock's league ID on the League page, import, draft, then **Reset draft** and switch the ID back.
- If Yahoo sync misbehaves, switch to **Manual**. Nothing else changes.
