#!/usr/bin/env node
/**
 * Repository-wide duplication ruleset for sources.json. Run in CI (and
 * locally before committing) so a duplicate entry can never merge, no
 * matter which path it was added through — add-source.js's own
 * findDuplicate/findDuplicateId checks only protect the single-insert path;
 * this script re-checks the whole file as an independent gate.
 *
 * Checks:
 *   1. Duplicate `id` values.
 *   2. Duplicate `url` values after case-insensitive normalization
 *      (scripts/lib/store.js's normalizeUrl — same rule add-source.js uses).
 *   3. Duplicate (owner, repo) pairs, case-insensitively — catches
 *      same-project entries added under differently-cased or differently
 *      shaped URLs that still resolve to the same repo.
 */
const { loadSources, normalizeUrl } = require("./lib/store");

function main() {
  const data = loadSources();
  const problems = [];

  const byId = new Map();
  const byUrl = new Map();
  const byOwnerRepo = new Map();

  for (const source of data.sources) {
    const idGroup = byId.get(source.id) || [];
    idGroup.push(source);
    byId.set(source.id, idGroup);

    let normalizedUrl;
    try {
      normalizedUrl = normalizeUrl(source.url);
    } catch {
      problems.push(`Unparseable URL on "${source.id}": ${source.url}`);
      continue;
    }
    const urlGroup = byUrl.get(normalizedUrl) || [];
    urlGroup.push(source);
    byUrl.set(normalizedUrl, urlGroup);

    if (source.owner && source.repo) {
      const key = `${source.owner.toLowerCase()}/${source.repo.toLowerCase()}`;
      const ownerRepoGroup = byOwnerRepo.get(key) || [];
      ownerRepoGroup.push(source);
      byOwnerRepo.set(key, ownerRepoGroup);
    }
  }

  for (const [id, group] of byId) {
    if (group.length > 1) {
      problems.push(`Duplicate id "${id}": ${group.map((s) => s.url).join(", ")}`);
    }
  }
  for (const [url, group] of byUrl) {
    if (group.length > 1) {
      problems.push(`Duplicate URL "${url}": ${group.map((s) => s.id).join(", ")}`);
    }
  }
  for (const [key, group] of byOwnerRepo) {
    if (group.length > 1) {
      problems.push(`Duplicate owner/repo "${key}": ${group.map((s) => s.id).join(", ")}`);
    }
  }

  if (problems.length > 0) {
    console.error(`Found ${problems.length} duplication problem(s) in sources.json:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(`OK: ${data.sources.length} sources, no duplicates found.`);
}

main();
