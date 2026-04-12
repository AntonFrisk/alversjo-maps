NOTE: This doc is written by AI agent from Cursor. 
Status: Unverified
Verify correctness and update status if you want to keep the doc

# Alversjö Maps

Interactive satellite map viewer for sound zoning at Borderland festival. Next.js 16 + React 19 + MapLibre GL.

## Cursor Cloud specific instructions

### Services

| Service | Command | Notes |
|---------|---------|-------|
| Next.js dev server | `npm run dev` (from `webapp/`) | Runs on port 3000. Reads `.env` from repo root via `next.config.mjs`. |
| Python utilities | `uv run python/main.py` (from repo root) | Optional offline data pipeline scripts; not needed for the webapp. |

### Lint / Build / Dev

- **Lint:** `npm run lint` in `webapp/` (ESLint; 0 errors, 3 warnings expected)
- **Build:** `npm run build` in `webapp/`
- **Dev:** `npm run dev` in `webapp/` (port 3000)

### Environment variables

Copy `.env.example` to `.env` at the repo root. The webapp's `next.config.mjs` loads env vars from `../.env` automatically. For read-only map viewing, no real secrets are needed — the placeholder `.env` is sufficient. GitHub OAuth + PAT secrets are only required for editing/committing map changes.

### Key caveats

- The webapp uses `package-lock.json` — always use `npm install` (not pnpm/yarn).
- Satellite tiles are pre-cached in `webapp/public/tiles/` and GeoJSON data in `webapp/public/data/` — no external API calls are needed to view the maps.
- The `app/` directory at the repo root is a legacy static HTML viewer, unrelated to the main Next.js webapp in `webapp/`.
- Python scripts in `python/` require `uv sync` in that directory; they use Python 3.13.
