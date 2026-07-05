# MyGithubLinks

![Sources](https://img.shields.io/badge/sources-2-blue) ![Stars Tracked](https://img.shields.io/badge/stars_tracked-1214-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

A curated, structured collection of open-source repositories, grouped by sector and category, cross-linked by shared tags. `sources.json` is the single source of truth; this file and the graph visualization are both generated from it.

## Contents

- [How this repository works](#how-this-repository-works)
- [Adding a source](#adding-a-source)
- [Graph visualization](#graph-visualization)
- [Sectors](#sectors)
- [Catalog](#catalog)
- [License](#license)

## How this repository works

- **`sources.json`** holds every tracked source: URL, provider, taxonomy `path`, tags, license, and GitHub star score.
- **This file (`README.MD`)** is generated from `sources.json` by `scripts/generate-readme.js` — do not edit it directly.
- **`AGENTS.MD`** documents the ruleset for adding sources correctly (dedup, taxonomy, tagging conventions) for both humans and AI agents.
- **`web/`** is a Next.js app that renders the same data as an interactive graph (node size = stars, edges = shared tags, clusters = sector).

## Adding a source

```
node scripts/add-source.js \
  --url "https://github.com/owner/repo" \
  --path "Sector>Category>Subcategory" \
  --tags tag-one,tag-two
```

This automatically rejects duplicates, detects the provider, fetches GitHub stars/license, and regenerates this README. See `AGENTS.MD` for full conventions. Refresh star counts periodically with:

```
node scripts/refresh-scores.js
```

## Graph visualization

```
cd web && npm install && npm run dev
```

Opens an interactive, GSAP-animated graph of every source at `localhost:3000` — circle size reflects star count, edges connect sources sharing tags.

## Sectors

- **Frontend Engineering** — 2 sources

## Catalog

### Frontend Engineering
#### GSAP
##### GSAP Website Examples
- [award-winning-website](https://github.com/adrianhajdin/award-winning-website) (★ 1018)
- [jsm_gta_vi_landing](https://github.com/adrianhajdin/jsm_gta_vi_landing) (★ 196)

## License

This repository is licensed under the [MIT License](LICENSE). Per-source licenses are noted next to each entry above where known.
