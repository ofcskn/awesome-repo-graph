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
  // Path is lowercased too: every provider we track (GitHub, GitLab, npm,
  // Hugging Face) treats owner/repo/package slugs case-insensitively, so
  // "owner/repo" and "Owner/Repo" must normalize identically or the same
  // project can be added twice under different casing.
  let pathname = u.pathname.replace(/\/+$/, "").toLowerCase();
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

/**
 * Second, independent duplicate gate: two distinct URLs can still slugify to
 * the same id (e.g. a homepage-style URL vs. an owner/repo URL for the same
 * project), so findDuplicate's URL comparison alone isn't sufficient. Any
 * insertion path must check both.
 */
function findDuplicateId(sources, id) {
  return sources.find((s) => s.id === id);
}

module.exports = {
  SOURCES_PATH,
  loadSources,
  saveSources,
  normalizeUrl,
  parseGithubOwnerRepo,
  slugify,
  findDuplicate,
  findDuplicateId,
};
