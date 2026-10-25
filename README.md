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

## Deploy (Cloudflare Pages)
Connect the GitHub repo in Cloudflare Pages:
- Build command: *(empty)*
- Build output directory: `site`

Every push to `main` redeploys.

## Notes
- BGG API needs a registered app token: https://boardgamegeek.com/applications. Never commit `.env`.
- Pin a wrong BGG match with `bgg: <id>` on the game in `collection.yaml`, then rerun `bgg`.
- `admin/data/bgg.json` is generated but committed, so builds work without the token.
