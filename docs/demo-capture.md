# Demo capture

The animated demo at the top of `README.MD` (`assets/demo.gif`) is a build
artifact, regenerated from the current interactive graph rather than maintained
by hand. This document explains how it works, how to regenerate it locally, and
how to change what it shows.

## What it does

On every push to `main`, the `Refresh demo GIF` workflow
(`.github/workflows/demo-gif.yml`):

1. Builds the graph's static export (`web/out`).
2. Serves that export on a local port and drives it with a headless browser
   through a scripted scene.
3. Captures the scene as PNG frames and assembles them into an optimized,
   looping GIF with `ffmpeg`.
4. Commits the refreshed `assets/demo.gif` back to the repository — but only if
   it actually changed.

The result: the README demo always reflects the site that is live.

## The scene

The scene is defined once in `tools/demo-capture/scene.mjs` and shared by both
local and CI runs. It plays out in ordered "beats":

1. **Load / intro** — the GSAP intro pops nodes in and fades the edges up.
2. **Filter by tag** — opens the tag panel and selects a tag; non-matching
   nodes and edges dim.
3. **Zoom into a cluster** — parks the pointer over a prominent node and zooms
   in toward it.
4. **Inspect a node** — clicks a node; it scales and its details panel appears.
5. **Settle** — holds the final frame so the loop has a beat of rest.

The scene uses only selectors that already exist in the app (the `[data-node]`
attribute, the "Filter by tag" / "Reset view" button text, the tag search input
placeholder). The web app itself is never modified to support capture.

## Components

All capture tooling lives under `tools/demo-capture/` and has its own
`package.json`, so Playwright is not part of the `web/` app's dependencies.

- `static-server.mjs` — a dependency-free static file server for `web/out`.
- `scene.mjs` — the `SCENE` config and the `runScene()` driver (the scene).
- `capture.mjs` — the orchestrator: serve → drive → frames → `ffmpeg` → GIF.

## Regenerating locally

Prerequisites: Node.js 20+ and `ffmpeg` on your `PATH`.

```bash
# Build the static export (no basePath, so it serves from "/")
cd web && npm ci && npm run build

# Install the capture tool and a headless browser, then capture
cd ../tools/demo-capture
npm install
npx playwright install --with-deps chromium
npm run capture:demo
```

`assets/demo.gif` is rewritten in place. Review it, then commit if you're happy.

## Tuning the demo

Every knob is configurable via environment variables (defaults in `scene.mjs`);
see the table in `tools/demo-capture/README.md`. Common tweaks:

- Shrink the file: lower `DEMO_GIF_WIDTH` or `DEMO_GIF_FPS`, or reduce the
  `DEMO_FRAMES_*` per-beat counts.
- Change what's shown: edit the beats in `runScene()`.

The tool prints the final GIF size and warns if it exceeds the ~5 MB budget.

## Why it can't cause an infinite deploy loop

The workflow commits back to the same branch that triggers it, which could loop.
Three independent guards prevent that — any one alone is enough:

1. **`[skip ci]`** in the commit message: GitHub Actions skips all workflow runs
   for that push.
2. **`paths-ignore: ['assets/demo.gif']`** on the push trigger: a commit that
   only changes the GIF does not re-trigger the workflow.
3. **The default `GITHUB_TOKEN`** pushes the commit, and by GitHub's design a
   `GITHUB_TOKEN` push does not trigger further `on: push` workflow runs (so it
   also does not needlessly re-run the Pages deploy).

The commit is additionally made only when the GIF changed, avoiding empty
commits.

## Why a separate workflow

The refresh runs as its own workflow rather than as a job inside
`deploy-pages.yml` so that the Pages deploy stays fast and on its own critical
path, the `paths-ignore` anti-loop boundary can be expressed cleanly, and a
capture failure never blocks a deployment. Both workflows trigger on the same
push and run in parallel; the capture builds its own equivalent export, so the
GIF reflects the same commit being deployed.

See `docs/superpowers/specs/2026-07-05-deploy-demo-gif-design.md` for the full
design rationale and tradeoffs.
