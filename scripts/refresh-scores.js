#!/usr/bin/env node
const { loadSources, saveSources } = require("./lib/store");
const { generateReadme } = require("./generate-readme");

async function fetchGithubMeta(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    stars: typeof data.stargazers_count === "number" ? data.stargazers_count : null,
    license: data.license && data.license.spdx_id ? data.license.spdx_id : null,
  };
}

async function main() {
  const data = loadSources();
  const today = new Date().toISOString().slice(0, 10);

  for (const source of data.sources) {
    if (source.provider !== "github.com" || !source.owner || !source.repo) continue;
    const meta = await fetchGithubMeta(source.owner, source.repo);
    if (!meta) {
      console.warn(`Skipped (fetch failed): ${source.id}`);
      continue;
    }
    source.score = { stars: meta.stars, fetchedAt: today };
    if (meta.license) source.license = meta.license;
    console.log(`Refreshed ${source.id}: ★ ${meta.stars}`);
  }

  saveSources(data);
  generateReadme(data);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
