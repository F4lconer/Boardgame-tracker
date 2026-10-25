# Boardgame Tracker

- `site/` is the only deployed folder (Cloudflare Pages). `admin/` is offline-only.
- Python: uv for everything. Run tests with `cd admin && uv run pytest`.

## BGG rules come first

Read `BGG_RULES.md` before touching BGG data, the footer, images, the BGG client, or anything public-facing.

- Never weaken, skip, or delete `admin/tests/test_bgg_compliance.py` or the `MIN_DELAY` floor.
- If a request or design idea conflicts with a rule (e.g. shortening BGG names, removing or shrinking the logo,
  re-hosting box art, faster API calls, ads, feeding BGG data to an LLM): **stop, do not implement it**, and ask the user
  what to do instead. In the question, quote the rule number and text from `BGG_RULES.md` that it would break,
  and offer compliant alternatives.
