#!/usr/bin/env node
/**
 * Query sources.json without loading the whole file into an AI agent's
 * context window. sources.json only grows over time (curator runs add to it
 * daily), so "read the whole file to find the 3 entries I care about" gets
 * more wasteful every day. This script does the reading/parsing in Node and
 * prints back only the matching, field-trimmed entries.
 *
 * Usage:
 *   node scripts/filter-sources.js --stats
 *   node scripts/filter-sources.js --tag mcp-server,agent-framework
 *   node scripts/filter-sources.js --path "AI Agent Tooling"
 *   node scripts/filter-sources.js --provider github.com --min-stars 500
 *   node scripts/filter-sources.js --query "vector database"
 *   node scripts/filter-sources.js --id nousresearch-hermes-agent
 *   node scripts/filter-sources.js --tag cli --fields id,title,url --limit 5
 *
 * Filters combine with AND. With no filters and no --stats, prints every
 * source (still field-trimmed) — used sparingly, prefer at least one filter.
 */
const { loadSources } = require("./lib/store");

const DEFAULT_FIELDS = ["id", "title", "url", "path", "tags", "score"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true; // boolean flag, e.g. --stats
    } else {
      args[key] = argv[++i];
    }
  }
  return args;
}

function matchesTag(source, wantedTags) {
  if (!wantedTags) return true;
  const have = new Set(source.tags || []);
  return wantedTags.every((tag) => have.has(tag));
}

function matchesPath(source, wantedPathPrefix) {
  if (!wantedPathPrefix) return true;
  const joined = (source.path || []).join(">").toLowerCase();
  return joined.startsWith(wantedPathPrefix.toLowerCase());
}

function matchesProvider(source, wantedProvider) {
  if (!wantedProvider) return true;
  return (source.provider || "").toLowerCase() === wantedProvider.toLowerCase();
}

function matchesQuery(source, query) {
  if (!query) return true;
  const haystack = [source.title, source.description, source.id, ...(source.tags || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesMinStars(source, minStars) {
  if (minStars === undefined) return true;
  const stars = source.score && typeof source.score.stars === "number" ? source.score.stars : 0;
  return stars >= minStars;
}

function projectFields(source, fields) {
  const result = {};
  for (const field of fields) {
    if (field in source) result[field] = source[field];
  }
  return result;
}

function printStats(sources) {
  const tagCounts = new Map();
  const providerCounts = new Map();
  const sectorCounts = new Map();

  for (const source of sources) {
    for (const tag of source.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    providerCounts.set(source.provider, (providerCounts.get(source.provider) || 0) + 1);
    const sector = (source.path || [])[0];
    if (sector) sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
  }

  const toSortedEntries = (map) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]);

  console.log(
    JSON.stringify(
      {
        totalSources: sources.length,
        providers: Object.fromEntries(toSortedEntries(providerCounts)),
        sectors: Object.fromEntries(toSortedEntries(sectorCounts)),
        tags: Object.fromEntries(toSortedEntries(tagCounts)),
      },
      null,
      2,
    ),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = loadSources();

  if (args.stats) {
    printStats(data.sources);
    return;
  }

  if (args.id) {
    const match = data.sources.find((s) => s.id === args.id);
    console.log(JSON.stringify(match ?? null, null, 2));
    return;
  }

  const wantedTags = typeof args.tag === "string" ? args.tag.split(",").map((t) => t.trim()) : null;
  const minStars = args["min-stars"] !== undefined ? Number(args["min-stars"]) : undefined;
  const fields = typeof args.fields === "string" ? args.fields.split(",").map((f) => f.trim()) : DEFAULT_FIELDS;
  const limit = args.limit !== undefined ? Number(args.limit) : undefined;

  let matches = data.sources.filter(
    (source) =>
      matchesTag(source, wantedTags) &&
      matchesPath(source, typeof args.path === "string" ? args.path : null) &&
      matchesProvider(source, typeof args.provider === "string" ? args.provider : null) &&
      matchesQuery(source, typeof args.query === "string" ? args.query : null) &&
      matchesMinStars(source, minStars),
  );

  if (limit !== undefined) matches = matches.slice(0, limit);

  console.log(JSON.stringify(matches.map((source) => projectFields(source, fields)), null, 2));
  console.error(`(${matches.length} of ${data.sources.length} sources matched)`);
}

main();
