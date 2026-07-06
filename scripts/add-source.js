#!/usr/bin/env node
const {
  loadSources,
  saveSources,
  parseGithubOwnerRepo,
  slugify,
  findDuplicate,
  findDuplicateId,
} = require("./lib/store");
const { generateReadme } = require("./generate-readme");

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

async function fetchGithubMeta(owner, repo) {
  const headers = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!res.ok) return { stars: null, license: null };
  const data = await res.json();
  return {
    stars: typeof data.stargazers_count === "number" ? data.stargazers_count : null,
    license: data.license && data.license.spdx_id ? data.license.spdx_id : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url || !args.path) {
    console.error(
      'Usage: node scripts/add-source.js --url <url> --path "Sector>Category>Sub" --tags a,b,c [--title "..."] [--description "..."]'
    );
    process.exitCode = 1;
    return;
  }

  const data = loadSources();

  const existing = findDuplicate(data.sources, args.url);
  if (existing) {
    console.error(`Duplicate: URL already tracked as "${existing.id}" (${existing.url})`);
    process.exitCode = 1;
    return;
  }

  const pathParts = args.path.split(">").map((p) => p.trim()).filter(Boolean);
  const tags = (args.tags || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const url = new URL(args.url);
  const provider = url.hostname.toLowerCase();
  const githubRef = parseGithubOwnerRepo(args.url);

  let owner = null;
  let repo = null;
  let license = null;
  let stars = null;
  let fetchedAt = null;
  let id;
  let defaultTitle;

  if (githubRef) {
    owner = githubRef.owner;
    repo = githubRef.repo;
    id = slugify(`${owner}-${repo}`);
    defaultTitle = repo;
    const meta = await fetchGithubMeta(owner, repo);
    stars = meta.stars;
    license = meta.license;
    fetchedAt = new Date().toISOString().slice(0, 10);
  } else {
    id = slugify(`${provider}-${url.pathname}`);
    defaultTitle = args.title || url.pathname;
  }

  // Independent from the URL-based findDuplicate check above: a different
  // URL (e.g. a renamed repo, or the same slug on a different host path)
  // can still collide on the generated id, which would silently overwrite
  // one entry's identity with another's in every id-keyed lookup (related.js,
  // the web graph, attestation digests). Refuse rather than risk that.
  const idCollision = findDuplicateId(data.sources, id);
  if (idCollision) {
    console.error(`Duplicate: id "${id}" already used by "${idCollision.url}"`);
    process.exitCode = 1;
    return;
  }

  const entry = {
    id,
    url: args.url,
    provider,
    owner,
    repo,
    title: args.title || defaultTitle,
    description: args.description || "",
    path: pathParts,
    tags,
    license,
    score: { stars, fetchedAt },
    addedAt: new Date().toISOString().slice(0, 10),
  };

  data.sources.push(entry);
  saveSources(data);
  generateReadme(data);

  console.log(`Added "${entry.id}" -> ${entry.path.join(" > ")}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
