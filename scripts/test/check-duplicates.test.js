"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { normalizeUrl } = require("../lib/store");

const SCRIPT = path.join(__dirname, "..", "check-duplicates.js");

test("check-duplicates.js passes against the committed sources.json", () => {
  const output = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.match(output, /^OK: \d+ sources, no duplicates found\.\n$/);
});

test("normalizeUrl treats differently-cased owner/repo paths as identical (regression for the Hermes duplicate)", () => {
  // This is the exact shape of bug check-duplicates.js and add-source.js
  // both guard against: two URLs differing only by owner/repo casing used
  // to slip past duplicate detection because normalizeUrl lowercased the
  // hostname but not the path.
  assert.equal(
    normalizeUrl("https://github.com/nousresearch/hermes-agent"),
    normalizeUrl("https://github.com/NousResearch/hermes-agent"),
  );
});
