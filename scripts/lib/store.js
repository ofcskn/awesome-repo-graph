const fs = require("fs");
const path = require("path");

const SOURCES_PATH = path.join(__dirname, "..", "..", "sources.json");

function loadSources() {
  const raw = fs.readFileSync(SOURCES_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.sources)) data.sources = [];
  return data;
}

function saveSources(data) {
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(data, null, 2) + "\n");
}

function normalizeUrl(rawUrl) {
  const u = new URL(rawUrl);
  u.hash = "";
  u.search = "";
  let pathname = u.pathname.replace(/\/+$/, "");
  return `${u.hostname.toLowerCase()}${pathname}`;
}

function parseGithubOwnerRepo(rawUrl) {
  const u = new URL(rawUrl);
  if (u.hostname.toLowerCase() !== "github.com") return null;
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findDuplicate(sources, rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  return sources.find((s) => normalizeUrl(s.url) === normalized);
}

module.exports = {
  SOURCES_PATH,
  loadSources,
  saveSources,
  normalizeUrl,
  parseGithubOwnerRepo,
  slugify,
  findDuplicate,
};
