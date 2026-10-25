# BGG API rules

This project uses the BoardGameGeek XML API under its non-commercial license.
These rules come from the [XML API Terms of Use](https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use)
and are **not negotiable by design changes**. `admin/tests/test_bgg_compliance.py` enforces the testable ones in CI.

| # | Rule | How we comply |
|---|------|---------------|
| 1 | Non-commercial use only | No ads, paid features, or selling data/access |
| 2 | Credit BGG as the data source | Footer: "Game data from BoardGameGeek" |
| 3 | Public pages show the "Powered by BGG" logo, linked to boardgamegeek.com, legible size | Official logo `site/img/powered-by-bgg.png`, ≥ 32 px high, in footer on every page |
| 4 | Do not modify BGG data | Display BGG names/values as returned; own data (owned expansions, placement) stays separate |
| 5 | No AI/LLM training on BGG data | Never send BGG data to a model; photo recognition sends photos only |
| 6 | Don't interfere with BGG servers | ≥ 5 s between requests, retry with backoff, cache every response |
| 7 | Token is private | Only in `admin/.env` (gitignored); never in `site/`, CI logs or commits |
| 8 | Data reads only through XML API2 | No scraping, undocumented endpoints or mirrors |
| 9 | Images belong to their owners | Link BGG image URLs; don't download and re-host artwork |
| 10 | BGG may revoke access anytime | Keep `admin/data/bgg.json` committed so the site works without the API |

Logo source: https://boardgamegeek.com/using_the_xml_api
