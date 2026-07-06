/**
 * Thin CJS-interop bridge to the repository's existing scripts/lib/store.js
 * and scripts/lib/graph.js. We reuse their exact URL-normalization,
 * duplicate-detection, and shared-tag logic rather than reimplementing it,
 * so the curator can never disagree with scripts/add-source.js about what
 * counts as a duplicate.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const curatorSrcDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(curatorSrcDir, "..", "..");

interface StoreModule {
  SOURCES_PATH: string;
  loadSources(): SourcesFile;
  saveSources(data: SourcesFile): void;
  normalizeUrl(url: string): string;
  parseGithubOwnerRepo(url: string): { owner: string; repo: string } | null;
  slugify(text: string): string;
  findDuplicate(sources: StoredSource[], url: string): StoredSource | undefined;
  findDuplicateId(sources: StoredSource[], id: string): StoredSource | undefined;
}

interface GraphModule {
  relatedTo(id: string, sources: StoredSource[]): unknown[];
  sharedTagCount(a: { tags?: string[] }, b: { tags?: string[] }): number;
  sharedPathPrefixLength(a: { path?: string[] }, b: { path?: string[] }): number;
}

export interface StoredSource {
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
}

export interface SourcesFile {
  sources: StoredSource[];
}

const store = require(path.join(repoRoot, "scripts", "lib", "store.js")) as StoreModule;
const graph = require(path.join(repoRoot, "scripts", "lib", "graph.js")) as GraphModule;

export const SOURCES_PATH: string = store.SOURCES_PATH;

export function loadSources(): SourcesFile {
  return store.loadSources();
}

export function normalizeSourceUrl(url: string): string {
  return store.normalizeUrl(url);
}

export function parseGithubOwnerRepo(url: string): { owner: string; repo: string } | null {
  return store.parseGithubOwnerRepo(url);
}

export function slugify(text: string): string {
  return store.slugify(text);
}

export function findDuplicateSource(
  sources: StoredSource[],
  url: string,
): StoredSource | undefined {
  return store.findDuplicate(sources, url);
}

export function findDuplicateSourceId(
  sources: StoredSource[],
  id: string,
): StoredSource | undefined {
  return store.findDuplicateId(sources, id);
}

export function sharedTagCount(a: { tags?: string[] }, b: { tags?: string[] }): number {
  return graph.sharedTagCount(a, b);
}
