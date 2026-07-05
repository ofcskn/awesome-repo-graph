# demo-capture

Regenerates `assets/demo.gif` by driving the built graph through a scripted
scene (load → filter → zoom → inspect → settle) and assembling the frames into
an optimized, looping GIF.

## Prerequisites

- Node.js 20+
- `ffmpeg` on your `PATH`
- A built static export at `web/out`

## Usage

```bash
# 1. Build the static export (no basePath, so it serves from "/")
(cd web && npm ci && npm run build)

# 2. Capture the demo
cd tools/demo-capture
npm install
npx playwright install --with-deps chromium
npm run capture:demo
```

The refreshed GIF is written to `assets/demo.gif`.

## Configuration

Everything is overridable via environment variables (defaults in `scene.mjs`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_WEB_OUT` | `web/out` | Static export directory to serve |
| `DEMO_OUT_GIF` | `assets/demo.gif` | Output GIF path |
| `DEMO_GIF_WIDTH` | `960` | Output GIF width (px) |
| `DEMO_GIF_FPS` | `12` | GIF frame rate |
| `DEMO_GIF_MAX_BYTES` | `5242880` | Soft size budget; warns if exceeded |
| `DEMO_FRAMES_*` | see `scene.mjs` | Frames per beat (`INTRO`/`FILTER`/`ZOOM`/`INSPECT`/`SETTLE`) |
| `DEMO_FRAME_INTERVAL_MS` | `90` | Delay between sampled frames |
| `DEMO_KEEP_FRAMES` | unset | Keep intermediate PNG frames for debugging |

See `docs/demo-capture.md` for the full architecture and the CI wiring.
