# Deploy → screenshot → GIF → README automation

Design document for the subsystem that keeps `assets/demo.gif` — the animated
demo shown at the top of `README.MD` — in sync with the deployed interactive
graph, automatically, on every push to `main`.

## Problem

The README advertises the project with an animated GIF whose alt text promises
"filtering by tag, inspecting a node, and zooming into a cluster". Today that
GIF is a static, hand-produced asset: it drifts out of date as the catalog
grows, the layout changes, or the visualization is restyled. We want the demo
to be a **build artifact**, regenerated from the current site the same way the
README and the graph are already regenerated from `sources.json`.

## Goals

- On every push to `main`, capture the *current* graph in motion and refresh
  `assets/demo.gif` so the README demo always reflects the live site.
- Prefer capturing the locally-built static export (`web/out`) served on a
  local port, over hitting the public URL. This removes network flakiness and
  works before (and independently of) the Pages deploy completing.
- Script a short, deterministic scene: initial render → tag filter → zoom →
  inspect a node → settle.
- Keep the GIF small (well under ~5 MB), looping, and visually smooth.
- Make the scene shared between local and CI, so a maintainer can reproduce the
  exact demo on their machine.
- Commit the regenerated GIF back **without** creating an infinite deploy loop.

## Architecture

```
                    push to main
                         │
        ┌────────────────┴─────────────────┐
        │                                   │
  deploy-pages.yml                     demo-gif.yml
  (unchanged)                          (new, paths-ignore: assets/demo.gif)
  build web/out → Pages                     │
                                   build web/out (no basePath)
                                            │
                                   node tools/demo-capture/capture.mjs
                                            │
                          ┌─────────────────┼──────────────────┐
                          │                 │                  │
                   static-server.mjs   Playwright/Chromium   ffmpeg
                   serves web/out      runs scene.mjs        palette + gif
                   at http://127…      → PNG frames          → assets/demo.gif
                                            │
                                   git commit assets/demo.gif  [skip ci]
                                   (default GITHUB_TOKEN, only if changed)
```

The capture tool is self-contained under `tools/demo-capture/` with its own
`package.json`, so Playwright is **not** added to `web/`'s runtime dependencies.
`web/` stays a lean Next.js app; the demo tooling is a dev/CI concern.

### Components

- **`tools/demo-capture/static-server.mjs`** — a dependency-free Node static
  file server that serves the exported `web/out` directory over HTTP on
  `127.0.0.1`. It resolves directory requests to `index.html` and falls back to
  `<path>.html`, matching how `next export` lays out files.
- **`tools/demo-capture/scene.mjs`** — the single source of truth for the demo.
  It exports a `SCENE` config (viewport, GIF width, frame rate, per-beat frame
  counts) and an async `runScene()` that drives the page through the beats,
  calling a `capture()` callback to grab each frame. Shared verbatim by local
  runs and CI.
- **`tools/demo-capture/capture.mjs`** — the orchestrator. Starts the static
  server, launches headless Chromium via Playwright, waits for the graph to
  render, runs the scene to produce numbered PNG frames, then invokes `ffmpeg`
  (two-pass palette) to assemble an optimized, looping GIF at `assets/demo.gif`.
  Reports the final size and warns if it exceeds the target budget.

### Scene definition

The scene is expressed as ordered "beats". Each beat performs an interaction and
then samples several frames at a fixed interval so the resulting GIF shows the
motion rather than a jump-cut. Beats:

1. **Load / intro** — wait for `[data-node]` elements, then sample frames while
   the GSAP intro timeline pops nodes in and fades edges up.
2. **Filter by tag** — click the "Filter by tag" control, then click the first
   tag chip. Sample frames as non-matching nodes and edges dim.
3. **Zoom into a cluster** — move the pointer over the graph and dispatch a
   sequence of wheel steps (the app zooms toward the pointer), sampling a frame
   after each step for a smooth zoom-in.
4. **Inspect a node** — click a prominent node. Sample frames as the node scales
   and the details panel animates in.
5. **Settle** — hold the final composed frame briefly so the loop has a beat of
   rest before it repeats.

All selectors are role/text/attribute based (`[data-node]`, the "Filter by tag"
and "Reset view" button text, the tag search input placeholder). The web app is
**not** modified — no test hooks are added — keeping this subsystem strictly
additive.

Every knob (viewport size, output width, fps, frames-per-beat, output paths) is
configurable via the `SCENE` object and environment variables, so the scene is
scriptable without editing orchestration code.

### GIF assembly

`ffmpeg` runs a two-pass palette pipeline for quality at small size:

1. `palettegen` (with `stats_mode=diff`) derives an optimal 256-color palette
   from the frames.
2. `paletteuse` (with `dither=bayer` and `diff_mode=rectangle`) maps frames to
   that palette, only rewriting changed rectangles between frames.

Frames are downscaled with the Lanczos filter to a configurable width (default
960 px) and the GIF is written with `-loop 0` (infinite loop). This keeps a
~5–6 second scene comfortably under the ~5 MB budget while staying crisp.

`ffmpeg` is chosen over `gifski` because it is already ubiquitous (present on
GitHub's `ubuntu-latest` images and most developer machines) and needs no extra
install step in CI. `gifski` would yield marginally better dithering but at the
cost of an install; the palette pass is more than good enough here. The tool
isolates assembly in one function, so swapping in `gifski` later is a localized
change.

## Anti-loop strategy

A workflow that commits back to the same branch it triggers on can loop forever.
This design stops that with **three independent, defense-in-depth layers** — any
one of them alone is sufficient:

1. **`[skip ci]` in the commit message.** GitHub Actions honors `[skip ci]`
   (and `[ci skip]`) in the head commit message and skips *all* workflow runs
   for that push. This is the primary, strongest guard.
2. **`paths-ignore: ['assets/demo.gif']` on the `demo-gif.yml` push trigger.**
   The bot commit only ever touches `assets/demo.gif`, so even without
   `[skip ci]` the workflow would not re-trigger itself.
3. **Pushing with the built-in `GITHUB_TOKEN`.** By GitHub's own design, a push
   made using the default `GITHUB_TOKEN` does **not** emit events that trigger
   further `on: push` (or other) workflow runs. This means the GIF commit also
   does not needlessly re-trigger `deploy-pages.yml`.

The commit is additionally made **only when the GIF actually changed** (`git
diff --quiet` guard), so identical re-captures produce no commit at all — no
empty-commit churn.

## Local vs CI

The scene and orchestrator are identical in both environments; only the entry
differs:

- **CI (`.github/workflows/demo-gif.yml`)** installs `web` deps, builds
  `web/out` (no `GITHUB_PAGES`, so the export is served from the site root),
  installs the capture tool + Chromium, runs the capture, and commits the GIF
  back if it changed.
- **Local** — a maintainer runs the same `web` build and the same
  `tools/demo-capture` capture command (see `docs/demo-capture.md`). Because the
  local build also omits `GITHUB_PAGES`, the served paths match CI exactly.

Building the export *without* `basePath` for capture (rather than reusing the
Pages artifact, which is prefixed with `/awesome-repo-graph`) is a deliberate
choice: it lets both the static server and the scene assume the site lives at
`/`, keeping local and CI byte-for-byte consistent and avoiding a prefix-aware
server. The extra `web` build in CI is cheap relative to the browser run.

### CI wiring: separate workflow vs. extending `deploy-pages.yml`

We add a **separate** `demo-gif.yml` rather than bolting a job onto
`deploy-pages.yml`, because:

- **The Pages deploy stays fast and on its own critical path.** GIF capture
  (browser + ffmpeg) adds a minute-plus and should not gate or slow the deploy.
- **`paths-ignore` gives a clean, self-contained anti-loop boundary** at the
  workflow level — it cannot be expressed per-job inside the deploy workflow.
- **Independent failure domains.** A capture hiccup never fails or blocks a
  Pages deployment, and vice versa.
- **Concurrency isolation** via its own `concurrency` group.

Both workflows trigger on the same `push` to `main` and run in parallel; the
capture builds its own equivalent export, so the GIF reflects the same commit
that is being deployed.

An alternative — triggering via `workflow_run` after `deploy-pages.yml`
succeeds — is more literally "after deploy", but `workflow_run` ignores
`paths-ignore`, removing anti-loop layer #2 and leaning entirely on `[skip ci]`
and `GITHUB_TOKEN`. The parallel push-triggered approach is simpler and keeps
all three guards, so we prefer it.

## Tradeoffs and limitations

- **Second `web` build in CI.** Accepted for local/CI parity and simplicity.
- **Non-determinism.** GSAP intro uses `from: "random"` staggering and remote
  avatar/favicon icons load over the network, so frames vary slightly run to
  run. The `git diff` guard means most runs will still commit (pixels differ),
  which is acceptable — the goal is freshness, not byte-stability. Icons that
  fail to load fall back to inline marks, so the scene never blocks on them.
- **Headless rendering fidelity.** Fonts/anti-aliasing differ subtly from a
  local desktop browser, but the scene is illustrative, not pixel-perfect.
- **ffmpeg dependency locally.** Documented as a prerequisite; ubiquitous.

## Implementation plan

1. **Design doc** (this file).
2. **Capture tool** under `tools/demo-capture/`:
   - `package.json` scoping `playwright` and exposing a `capture:demo` script.
   - `static-server.mjs` — dependency-free static server for `web/out`.
   - `scene.mjs` — `SCENE` config + `runScene()` (the shared scene).
   - `capture.mjs` — orchestrator: serve → drive → frames → ffmpeg → GIF.
   - `README.md` — quick usage for the tool.
3. **CI workflow** `.github/workflows/demo-gif.yml` — build export, run capture,
   commit GIF back with the three anti-loop guards.
4. **Docs**: `docs/demo-capture.md` (how it works, how to run locally, how to
   tweak the scene) and a "Demo capture" section surfaced through the README
   generator (`scripts/generate-readme.js`), since `README.MD` is generated and
   must never be hand-edited.
5. **Verification**: build `web/out` and run the capture locally against it to
   confirm a valid, looping, under-budget GIF is produced; document the exact
   commands.
