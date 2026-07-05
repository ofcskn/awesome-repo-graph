# Agent Ruleset — MyGithubLinks

This repository catalogs curated open-source repository links in
`sources.json`. `README.MD` is **generated** from `sources.json` — never
edit either file by hand.

## Adding a new source

Always use the CLI script:

```
node scripts/add-source.js \
  --url "https://github.com/owner/repo" \
  --path "Frontend Engineering>GSAP>GSAP Website Examples" \
  --tags gsap,landing-page \
  --title "Optional Title" \
  --description "Optional description"
```

This script:
1. Normalizes the URL and **rejects duplicates automatically** — if the
   URL (ignoring trailing slash, query string, and case) already exists in
   `sources.json`, the add is refused. Do not bypass this by editing
   `sources.json` directly.
2. Detects the provider from the URL's hostname (`github.com`, etc.).
3. For GitHub URLs, fetches star count and license automatically from the
   public GitHub API — no manual entry, no API token required.
4. Regenerates `README.MD` automatically.

**Before adding a source, check for near-duplicates the script can't
catch** (e.g. a fork or mirror of an already-tracked repo, or the same
project linked under a different URL shape) by scanning `sources.json`.

## Taxonomy (`path` field)

`path` is an array, broadest to narrowest, with **no fixed depth** — add
as many or as few levels as the source needs. Reuse existing top-level
sectors before inventing new ones. Current sectors in use: check
`sources.json` for the current set (e.g. `Frontend Engineering`).

Example: `["Frontend Engineering", "GSAP", "GSAP Website Examples"]`

## Tags

- Lowercase, kebab-case (`scroll-animation`, not `ScrollAnimation`).
- **Reuse existing tags** where applicable — scan `sources.json`'s `tags`
  fields before adding a new one. Tags drive the shared-tag "related
  sources" graph (`scripts/lib/graph.js`), so consistency matters more
  than precision.

## Scoring

- `score.stars` and `license` are fetched automatically for GitHub
  sources by `add-source.js` and refreshed by `refresh-scores.js`. Never
  hand-edit these fields.
- Run `node scripts/refresh-scores.js` periodically (e.g. weekly) to keep
  star counts current across all tracked sources.

## Inspecting relationships

`node scripts/related.js --id <source-id>` lists other sources that share
tags or taxonomy path with the given source, ranked by overlap.

## Secrets

All GitHub API calls in these scripts are unauthenticated (public REST
API, no token). Do not add credentials or tokens to any script or commit.
