// Dependency-free static file server for a `next export` output directory.
//
// It serves files from a root directory over HTTP on 127.0.0.1, resolving
// directory requests to `index.html` and falling back to `<path>.html`, which
// mirrors how Next.js lays out a static export. This lets the capture tool
// drive the exact bytes that get deployed to GitHub Pages without any network
// dependency.

import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function resolveFile(rootDir, urlPath) {
  // Strip query/hash and normalize, guarding against path traversal.
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const rel = path.normalize(clean).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const base = path.join(rootDir, rel);
  if (!base.startsWith(rootDir)) return null;

  const candidates = [];
  if (clean.endsWith("/") || clean === "") {
    candidates.push(path.join(base, "index.html"));
  } else {
    candidates.push(base);
    candidates.push(`${base}.html`);
    candidates.push(path.join(base, "index.html"));
  }

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Start a static server for `rootDir`.
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startStaticServer(rootDir, { host = "127.0.0.1", port = 0 } = {}) {
  const absRoot = path.resolve(rootDir);

  const server = http.createServer(async (req, res) => {
    try {
      const filePath = await resolveFile(absRoot, req.url || "/");
      if (!filePath) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      res.setHeader("Content-Type", contentTypeFor(filePath));
      res.setHeader("Cache-Control", "no-store");
      createReadStream(filePath)
        .on("error", () => {
          res.statusCode = 500;
          res.end("Read error");
        })
        .pipe(res);
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://${host}:${boundPort}`,
        port: boundPort,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
