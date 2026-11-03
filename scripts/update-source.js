#!/usr/bin/env node
/**
 * Corrects metadata on an existing source without re-adding it.
 *
 * Only descriptive fields can be changed (title, description, path, tags).
 * Identity and measured fields — id, url, provider, owner, repo, license,
 * score, addedAt — are deliberately immutable here: the id/URL are the
 * dedup keys, and score/license are owned by refresh-scores.js.
 */
const { loadSources, saveSources } = require("./lib/store");
const { generateReadme } = require("./generate-readme");

const EDITABLE_FIELDS = ["title", "description", "path", "tags"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    args[key] = value;
  }
  return args;
}

function splitList(value, sep) {
  return value
    .split(sep)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Converts CLI args into a `changes` object containing only editable fields. */
function buildChanges(args) {
  const changes = {};
  if (args.title !== undefined) changes.title = args.title.trim();
  if (args.description !== undefined) changes.description = args.description.trim();
  if (args.path !== undefined) changes.path = splitList(args.path, ">");
  if (args.tags !== undefined) changes.tags = splitList(args.tags, ",").map((t) => t.toLowerCase());
  return changes;
}

/**
 * Applies `changes` to the entry with the given id, in place.
 * Throws on unknown id, unknown/immutable fields, or empty values.
 * Returns { entry, changed } where `changed` lists fields that actually differ.
 */
function applyUpdate(sources, id, changes) {
  const entry = sources.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown source id "${id}"`);

  const keys = Object.keys(changes);
  if (keys.length === 0) {
    throw new Error(`Nothing to update; pass at least one of: ${EDITABLE_FIELDS.map((f) => `--${f}`).join(", ")}`);
  }
  for (const key of keys) {
    if (!EDITABLE_FIELDS.includes(key)) {
      throw new Error(`Field "${key}" is not editable (allowed: ${EDITABLE_FIELDS.join(", ")})`);
    }
    const value = changes[key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      throw new Error(`Field "${key}" cannot be empty`);
    }
  }

  const changed = keys.filter((key) => JSON.stringify(entry[key]) !== JSON.stringify(changes[key]));
  for (const key of changed) entry[key] = changes[key];
  return { entry, changed };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id) {
    console.error(
      'Usage: node scripts/update-source.js --id <source-id> [--title "..."] [--description "..."] [--path "A>B>C"] [--tags a,b]'
    );
    process.exitCode = 1;
    return;
  }

  const data = loadSources();
  const { changed } = applyUpdate(data.sources, args.id, buildChanges(args));
  if (changed.length === 0) {
    console.log(`No changes for "${args.id}"; already up to date.`);
    return;
  }

  saveSources(data);
  generateReadme(data);
  console.log(`Updated "${args.id}": ${changed.join(", ")}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { applyUpdate, buildChanges, EDITABLE_FIELDS };
