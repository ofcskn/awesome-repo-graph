import fs from "fs";
import path from "path";

export type Source = {
  id: string;
  url: string;
  provider: string;
  owner: string | null;
  repo: string | null;
  title: string;
  description: string;
  path: string[];
  tags: string[];
  license: string | null;
  score: { stars: number | null; fetchedAt: string | null };
  addedAt: string;
};

export function loadSources(): Source[] {
  const sourcesPath = path.join(process.cwd(), "..", "sources.json");
  const raw = fs.readFileSync(sourcesPath, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data.sources) ? data.sources : [];
}

export function sharedTagCount(a: Source, b: Source): number {
  const setB = new Set(b.tags || []);
  return (a.tags || []).filter((t) => setB.has(t)).length;
}

export type Edge = { a: string; b: string; weight: number };

export function buildEdges(sources: Source[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const weight = sharedTagCount(sources[i], sources[j]);
      if (weight > 0) {
        edges.push({ a: sources[i].id, b: sources[j].id, weight });
      }
    }
  }
  return edges;
}
