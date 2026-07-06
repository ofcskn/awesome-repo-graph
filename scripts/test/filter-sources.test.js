"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "filter-sources.js");
const { loadSources } = require("../lib/store");

function run(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

test("--stats reports the true total source count", () => {
  const stats = JSON.parse(run(["--stats"]));
  const data = loadSources();
  assert.equal(stats.totalSources, data.sources.length);
});

test("--id returns exactly one matching source or null", () => {
  const data = loadSources();
  const first = data.sources[0];
  const result = JSON.parse(run(["--id", first.id]));
  assert.equal(result.id, first.id);

  const missing = JSON.parse(run(["--id", "definitely-not-a-real-id"]));
  assert.equal(missing, null);
});

test("--tag filters and --fields projects only the requested fields", () => {
  const data = loadSources();
  const tag = data.sources[0].tags[0];
  const results = JSON.parse(run(["--tag", tag, "--fields", "id,tags"]));
  assert.ok(results.length > 0);
  for (const entry of results) {
    assert.deepEqual(Object.keys(entry).sort(), ["id", "tags"]);
    assert.ok(entry.tags.includes(tag));
  }
});

test("combined filters never return more sources than the unfiltered total", () => {
  const data = loadSources();
  const results = JSON.parse(run(["--provider", "github.com"]));
  assert.ok(results.length <= data.sources.length);
});
