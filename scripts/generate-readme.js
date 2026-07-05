#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { loadSources } = require("./lib/store");

const README_PATH = path.join(__dirname, "..", "README.MD");

function buildTree(sources) {
  const root = {};
  for (const source of sources) {
    let node = root;
    for (const segment of source.path) {
      node.children = node.children || {};
      node.children[segment] = node.children[segment] || {};
      node = node.children[segment];
    }
    node.items = node.items || [];
    node.items.push(source);
  }
  return root;
}

function formatEntry(source) {
  const stars = source.score && typeof source.score.stars === "number"
    ? ` (★ ${source.score.stars})`
    : "";
  const license = source.license ? ` [${source.license}]` : "";
  return `- [${source.title}](${source.url})${stars}${license}`;
}

function renderNode(node, depth, lines) {
  if (node.children) {
    const headingLevel = Math.min(depth + 1, 6);
    const hashes = "#".repeat(headingLevel);
    for (const key of Object.keys(node.children)) {
      lines.push(`${hashes} ${key}`);
      renderNode(node.children[key], depth + 1, lines);
    }
  }
  if (node.items) {
    const sorted = [...node.items].sort((a, b) => {
      const starsA = a.score && typeof a.score.stars === "number" ? a.score.stars : -1;
      const starsB = b.score && typeof b.score.stars === "number" ? b.score.stars : -1;
      if (starsB !== starsA) return starsB - starsA;
      return a.title.localeCompare(b.title);
    });
    for (const source of sorted) {
      lines.push(formatEntry(source));
    }
    lines.push("");
  }
}

function countBySector(sources) {
  const counts = new Map();
  for (const source of sources) {
    const sector = source.path[0] || "Uncategorized";
    counts.set(sector, (counts.get(sector) || 0) + 1);
  }
  return counts;
}

function generateReadme(data) {
  const tree = buildTree(data.sources);
  const totalStars = data.sources.reduce(
    (sum, s) => sum + (s.score && typeof s.score.stars === "number" ? s.score.stars : 0),
    0
  );
  const sectorCounts = countBySector(data.sources);

  const lines = [
    "# awesome-repo-graph",
    "",
    `![Sources](https://img.shields.io/badge/sources-${data.sources.length}-blue)` +
      ` ![Stars Tracked](https://img.shields.io/badge/stars_tracked-${totalStars}-yellow)` +
      ` ![License](https://img.shields.io/badge/license-MIT-green)`,
    "",
    "A curated, structured collection of open-source repositories, grouped by " +
      "sector and category, cross-linked by shared tags. `sources.json` is the " +
      "single source of truth; this file and the graph visualization are both " +
      "generated from it.",
    "",
    "## Contents",
    "",
    "- [How this repository works](#how-this-repository-works)",
    "- [Adding a source](#adding-a-source)",
    "- [Graph visualization](#graph-visualization)",
    "- [Sectors](#sectors)",
    "- [Catalog](#catalog)",
    "- [License](#license)",
    "",
    "## How this repository works",
    "",
    "- **`sources.json`** holds every tracked source: URL, provider, taxonomy " +
      "`path`, tags, license, and GitHub star score.",
    "- **This file (`README.MD`)** is generated from `sources.json` by " +
      "`scripts/generate-readme.js` — do not edit it directly.",
    "- **`AGENTS.MD`** documents the ruleset for adding sources correctly " +
      "(dedup, taxonomy, tagging conventions) for both humans and AI agents.",
    "- **`web/`** is a Next.js app that renders the same data as an " +
      "interactive graph (node size = stars, edges = shared tags, clusters = sector).",
    "",
    "## Adding a source",
    "",
    "```",
    'node scripts/add-source.js \\',
    '  --url "https://github.com/owner/repo" \\',
    '  --path "Sector>Category>Subcategory" \\',
    "  --tags tag-one,tag-two",
    "```",
    "",
    "This automatically rejects duplicates, detects the provider, fetches " +
      "GitHub stars/license, and regenerates this README. See `AGENTS.MD` for " +
      "full conventions. Refresh star counts periodically with:",
    "",
    "```",
    "node scripts/refresh-scores.js",
    "```",
    "",
    "## Graph visualization",
    "",
    "```",
    "cd web && npm install && npm run dev",
    "```",
    "",
    "Opens an interactive, GSAP-animated graph of every source at `localhost:3000` " +
      "— circle size reflects star count, edges connect sources sharing tags.",
    "",
    "## Sectors",
    "",
    ...Array.from(sectorCounts.entries()).map(
      ([sector, count]) => `- **${sector}** — ${count} source${count === 1 ? "" : "s"}`
    ),
    "",
    "## Catalog",
    "",
  ];
  renderNode(tree, 2, lines);
  lines.push(
    "## License",
    "",
    "This repository is licensed under the [MIT License](LICENSE). Per-source " +
      "licenses are noted next to each entry above where known."
  );
  fs.writeFileSync(README_PATH, lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
}

if (require.main === module) {
  const data = loadSources();
  generateReadme(data);
  console.log("README.MD regenerated.");
}

module.exports = { generateReadme };
