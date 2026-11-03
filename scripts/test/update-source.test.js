"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyUpdate, buildChanges } = require("../update-source");

function fixture() {
  return [
    {
      id: "acme-widget",
      url: "https://github.com/acme/widget",
      title: "widget",
      description: "Old text.",
      path: ["A", "B"],
      tags: ["x"],
      score: { stars: 10, fetchedAt: "2026-01-01" },
    },
  ];
}

test("updates only the requested field and reports it", () => {
  const sources = fixture();
  const { changed } = applyUpdate(sources, "acme-widget", { description: "New text." });
  assert.deepEqual(changed, ["description"]);
  assert.equal(sources[0].description, "New text.");
  assert.equal(sources[0].url, "https://github.com/acme/widget");
  assert.deepEqual(sources[0].score, { stars: 10, fetchedAt: "2026-01-01" });
});

test("reports no change when the value is identical", () => {
  const sources = fixture();
  const { changed } = applyUpdate(sources, "acme-widget", { description: "Old text." });
  assert.deepEqual(changed, []);
});

test("rejects unknown ids", () => {
  assert.throws(() => applyUpdate(fixture(), "nope", { title: "t" }), /Unknown source id/);
});

test("rejects immutable fields such as id, url and score", () => {
  for (const field of ["id", "url", "score", "license"]) {
    assert.throws(() => applyUpdate(fixture(), "acme-widget", { [field]: "x" }), /not editable/);
  }
});

test("rejects empty updates and empty values", () => {
  assert.throws(() => applyUpdate(fixture(), "acme-widget", {}), /Nothing to update/);
  assert.throws(() => applyUpdate(fixture(), "acme-widget", { tags: [] }), /cannot be empty/);
  assert.throws(() => applyUpdate(fixture(), "acme-widget", { description: "" }), /cannot be empty/);
});

test("buildChanges parses path and tags and ignores unrelated args", () => {
  const changes = buildChanges({ id: "acme-widget", path: "A > B > C", tags: "Foo, bar" });
  assert.deepEqual(changes, { path: ["A", "B", "C"], tags: ["foo", "bar"] });
});
