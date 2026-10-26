# Boardgame Tracker

Find where each board game sits on my shelves.

- `site/` – static viewer, deployed to Cloudflare Pages. Only this folder is published.
- `admin/` – offline tool that turns `admin/data/collection.yaml` into `site/collection.json`.

## Setup
```bash
cd admin
uv sync
cp .env.example .env   # add BGG_API_TOKEN
```

## Update the collection
```bash
cd admin
uv run shelf-admin admin        # edit storages + game placement in the browser, saves YAML and rebuilds
uv run shelf-admin validate
uv run shelf-admin bgg          # match games on BGG, fetch expansions (needs token)
uv run shelf-admin expansions   # owned / missing expansions per game
uv run shelf-admin build        # writes ../site/collection.json
uv run shelf-admin serve        # http://localhost:8000
git add -A && git commit -m "Update collection" && git push
```

## Tests
```bash
cd admin
uv run pytest
```

## Deploy (Cloudflare Workers)
Connect the GitHub repo in Cloudflare Workers & Pages:
- Build command: *(empty)*, deploy command: `npx wrangler deploy`
- `wrangler.jsonc` serves only `site/`; the Cloudflare project name must match its `name`

Every push to `main` redeploys.

## Notes
- `shelf-admin admin` runs on http://localhost:8001 only. Drag boxes between cubes, click a cube or storage name to edit; Save writes `collection.yaml` (comments kept) and `site/collection.json`.
- BGG API rules: see `BGG_RULES.md`. The official "Powered by BGG" logo must be at `site/img/powered-by-bgg.webp` (CI fails without it).
- BGG API needs a registered app token: https://boardgamegeek.com/applications. Never commit `.env`.
- Pin a wrong BGG match with `bgg: <id>` on the game in `collection.yaml`, then rerun `bgg`.
- `admin/data/bgg.json` is generated but committed, so builds work without the token.
