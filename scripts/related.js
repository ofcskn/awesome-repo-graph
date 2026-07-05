#!/usr/bin/env node
const { loadSources } = require("./lib/store");
const { relatedTo } = require("./lib/graph");

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id) {
    console.error("Usage: node scripts/related.js --id <source-id>");
    process.exitCode = 1;
    return;
  }

  const data = loadSources();
  const results = relatedTo(args.id, data.sources);

  if (results.length === 0) {
    console.log(`No related sources found for "${args.id}".`);
    return;
  }

  for (const r of results) {
    console.log(
      `${r.id} — shared tags: ${r.sharedTags}, shared path depth: ${r.sharedPathDepth} — ${r.url}`
    );
  }
}

main();
