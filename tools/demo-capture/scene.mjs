// Shared demo scene definition.
//
// This module is the single source of truth for what the demo GIF shows. It is
// imported unchanged by `capture.mjs` in both local and CI runs, so the demo is
// reproducible everywhere. `SCENE` holds every tunable knob; `runScene()` drives
// the page through the beats, calling the supplied `capture()` once per frame.
//
// The scene deliberately uses only role/text/attribute selectors that already
// exist in the app (`[data-node]`, the "Filter by tag" / "Reset view" button
// text, the tag search input placeholder). It never depends on test-only hooks,
// so the web app stays untouched.

const numberFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

export const SCENE = {
  // Browser viewport the scene is filmed at (frames are downscaled for the GIF).
  viewport: {
    width: numberFromEnv("DEMO_VIEWPORT_WIDTH", 1280),
    height: numberFromEnv("DEMO_VIEWPORT_HEIGHT", 800),
  },
  // GIF output settings.
  output: {
    // Target GIF width in px (height keeps aspect). Smaller => smaller file.
    width: numberFromEnv("DEMO_GIF_WIDTH", 960),
    // Playback frame rate of the assembled GIF.
    fps: numberFromEnv("DEMO_GIF_FPS", 12),
    // Soft budget; the tool warns if the produced GIF exceeds this (bytes).
    maxBytes: numberFromEnv("DEMO_GIF_MAX_BYTES", 5 * 1024 * 1024),
  },
  // Per-beat frame counts. Total frames ≈ sum; duration ≈ total / fps.
  beats: {
    intro: numberFromEnv("DEMO_FRAMES_INTRO", 16),
    filter: numberFromEnv("DEMO_FRAMES_FILTER", 12),
    zoom: numberFromEnv("DEMO_FRAMES_ZOOM", 10),
    inspect: numberFromEnv("DEMO_FRAMES_INSPECT", 12),
    settle: numberFromEnv("DEMO_FRAMES_SETTLE", 10),
  },
  // Interval between sampled frames within a beat (ms).
  frameIntervalMs: numberFromEnv("DEMO_FRAME_INTERVAL_MS", 90),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sample `count` frames spaced `frameIntervalMs` apart, so a beat's motion is
// spread across several GIF frames instead of a single jump-cut.
async function sampleFrames(capture, count, intervalMs = SCENE.frameIntervalMs) {
  for (let i = 0; i < count; i++) {
    await capture();
    if (i < count - 1) await sleep(intervalMs);
  }
}

// Pick a visually prominent, non-dimmed node and return its viewport center.
// Filtering drops non-matching nodes to low opacity, so we prefer fully opaque
// nodes (the ones the current filter highlights) and, among those, the largest.
async function pickProminentNode(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("[data-node]"));
    const scored = nodes
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const opacity = Number(el.getAttribute("opacity") ?? "1");
        return { rect, opacity, area: rect.width * rect.height };
      })
      .filter(
        (n) =>
          n.rect.width > 0 &&
          n.rect.left >= 0 &&
          n.rect.top >= 0 &&
          n.rect.right <= window.innerWidth &&
          n.rect.bottom <= window.innerHeight
      );
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.opacity - a.opacity || b.area - a.area);
    const best = scored[0];
    return {
      x: Math.round(best.rect.left + best.rect.width / 2),
      y: Math.round(best.rect.top + best.rect.height / 2),
    };
  });
}

/**
 * Drive the page through the demo scene.
 * @param {object} ctx
 * @param {import('playwright').Page} ctx.page
 * @param {() => Promise<void>} ctx.capture  captures one frame
 * @param {(msg: string) => void} [ctx.log]
 */
export async function runScene({ page, capture, log = () => {} }) {
  const { viewport } = SCENE;
  const centerX = Math.round(viewport.width / 2);
  const centerY = Math.round(viewport.height / 2);

  // Beat 1 — initial render. The GSAP timeline pops nodes in and fades edges up.
  log("beat: intro render");
  await sampleFrames(capture, SCENE.beats.intro);

  // Beat 2 — filter by tag. Open the panel and select the first tag chip, then
  // sample as non-matching nodes/edges dim.
  log("beat: filter by tag");
  try {
    await page.getByRole("button", { name: /filter by tag/i }).click();
    // Anchor on the search input, walk up to the panel, then take its first
    // button. Chips are the panel's only buttons before a filter is active (the
    // "Clear" control appears only afterwards), so the first is a tag chip.
    const searchInput = page.getByPlaceholder(/search tags/i);
    await searchInput.waitFor({ state: "visible", timeout: 5000 });
    const panel = searchInput.locator("xpath=../..");
    const firstTag = panel.locator("button").first();
    await firstTag.click({ timeout: 5000 });
  } catch (err) {
    log(`filter interaction skipped: ${err.message}`);
  }
  await sampleFrames(capture, SCENE.beats.filter);

  // Beat 3 — zoom into the cluster. Park the pointer over a prominent node and
  // dispatch wheel steps; the app zooms toward the pointer. Sample each step.
  log("beat: zoom into cluster");
  const focus = (await pickProminentNode(page)) ?? { x: centerX, y: centerY };
  await page.mouse.move(focus.x, focus.y);
  for (let i = 0; i < SCENE.beats.zoom; i++) {
    await page.mouse.wheel(0, -120); // negative delta => zoom in
    await capture();
    await sleep(SCENE.frameIntervalMs);
  }

  // Beat 4 — inspect a node. Click a prominent (highlighted) node; the node
  // scales and the details panel animates in.
  log("beat: inspect node");
  const target = (await pickProminentNode(page)) ?? focus;
  try {
    await page.mouse.click(target.x, target.y);
  } catch (err) {
    log(`node click skipped: ${err.message}`);
  }
  await sampleFrames(capture, SCENE.beats.inspect);

  // Beat 5 — settle. Hold the composed final frame so the loop has a beat of
  // rest before repeating.
  log("beat: settle");
  await sampleFrames(capture, SCENE.beats.settle, SCENE.frameIntervalMs * 1.5);
}
