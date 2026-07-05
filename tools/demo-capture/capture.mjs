#!/usr/bin/env node
// Demo capture orchestrator.
//
//   serve web/out  →  drive the graph with Playwright (scene.mjs)  →  PNG frames
//   →  assemble an optimized looping GIF with ffmpeg  →  assets/demo.gif
//
// Everything the scene does lives in scene.mjs so local and CI runs are
// identical. Paths and knobs are overridable via environment variables (see
// docs/demo-capture.md).

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./static-server.mjs";
import { SCENE, runScene } from "./scene.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const WEB_OUT = process.env.DEMO_WEB_OUT
  ? path.resolve(process.env.DEMO_WEB_OUT)
  : path.join(repoRoot, "web", "out");
const OUT_GIF = process.env.DEMO_OUT_GIF
  ? path.resolve(process.env.DEMO_OUT_GIF)
  : path.join(repoRoot, "assets", "demo.gif");
const FRAMES_DIR = process.env.DEMO_FRAMES_DIR
  ? path.resolve(process.env.DEMO_FRAMES_DIR)
  : path.join(here, ".frames");

const log = (msg) => console.log(`[demo-capture] ${msg}`);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

async function assembleGif(framePattern, outGif) {
  const { width, fps } = SCENE.output;
  const palette = path.join(FRAMES_DIR, "palette.png");

  // Pass 1: derive an optimal 256-color palette from the frames.
  await run("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", framePattern,
    "-vf", `scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    palette,
  ]);

  // Pass 2: map frames onto that palette, only rewriting changed rectangles.
  await run("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", framePattern,
    "-i", palette,
    "-lavfi",
    `scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    "-loop", "0",
    outGif,
  ]);
}

async function main() {
  if (!existsSync(WEB_OUT)) {
    throw new Error(
      `Static export not found at ${WEB_OUT}. Build it first:\n` +
        `  (cd web && npm ci && npm run build)`
    );
  }

  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });
  await mkdir(path.dirname(OUT_GIF), { recursive: true });

  const server = await startStaticServer(WEB_OUT);
  log(`serving ${WEB_OUT} at ${server.url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let frameIndex = 0;
  try {
    const page = await browser.newPage({
      viewport: SCENE.viewport,
      deviceScaleFactor: 1,
    });

    log("loading graph…");
    await page.goto(`${server.url}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("[data-node]", { timeout: 30000 });
    // Give remote node icons a brief, bounded chance to load. We never block on
    // full network idle — GitHub avatars may keep connections open, and the app
    // falls back to inline marks for any icon that fails.
    await page.waitForTimeout(400);

    const capture = async () => {
      const name = `frame-${String(++frameIndex).padStart(4, "0")}.png`;
      await page.screenshot({ path: path.join(FRAMES_DIR, name) });
    };

    await runScene({ page, capture, log });
    log(`captured ${frameIndex} frames`);
  } finally {
    await browser.close();
    await server.close();
  }

  if (frameIndex === 0) {
    throw new Error("No frames were captured; aborting GIF assembly.");
  }

  log("assembling GIF with ffmpeg…");
  await assembleGif(path.join(FRAMES_DIR, "frame-%04d.png"), OUT_GIF);

  const { size } = await stat(OUT_GIF);
  const mb = (size / (1024 * 1024)).toFixed(2);
  log(`wrote ${OUT_GIF} (${mb} MB, ${frameIndex} frames)`);
  if (size > SCENE.output.maxBytes) {
    const budgetMb = (SCENE.output.maxBytes / (1024 * 1024)).toFixed(2);
    log(
      `WARNING: GIF is ${mb} MB, over the ${budgetMb} MB budget. ` +
        `Lower DEMO_GIF_WIDTH / DEMO_GIF_FPS or reduce per-beat frame counts.`
    );
  }

  // Leave frames dir clean unless the caller asked to keep it for debugging.
  if (!process.env.DEMO_KEEP_FRAMES) {
    await rm(FRAMES_DIR, { recursive: true, force: true });
  } else {
    const files = await readdir(FRAMES_DIR);
    log(`kept ${files.length} files in ${FRAMES_DIR}`);
  }
}

main().catch((err) => {
  console.error(`[demo-capture] failed: ${err.message}`);
  process.exit(1);
});
