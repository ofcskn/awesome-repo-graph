import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredSource } from "../store-bridge.js";
import type { Candidate } from "../types.js";
import type { EmbeddingProvider } from "../embeddings/types.js";

const curatorSrcDir = fileURLToPath(new URL(".", import.meta.url));
export const EMBEDDING_STATE_PATH = path.resolve(curatorSrcDir, "..", "state", "embeddings.json");

export interface EmbeddingRecord {
  sourceId: string;
  canonicalUrl: string;
  textHash: string;
  model: string;
  dimensions: number;
  vector: number[];
  updatedAt: string;
}

function stableHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

export function computeTextHash(text: string): string {
  return stableHash(text);
}

/** Text an already-catalogued source is embedded from — includes its assigned taxonomy/tags. */
export function existingSourceEmbeddingText(source: StoredSource): string {
  return [source.title, source.description, source.path.join(" > "), source.tags.join(", ")].join("\n");
}

/** Text a not-yet-classified candidate is embedded from — no taxonomy/tags exist yet, so this uses raw repo metadata instead. */
export function candidateEmbeddingText(candidate: Candidate): string {
  return [
    candidate.title,
    candidate.description,
    candidate.topics.join(", "),
    candidate.primaryLanguage ?? "",
  ].join("\n");
}

export function loadEmbeddingStore(): EmbeddingRecord[] {
  if (!fs.existsSync(EMBEDDING_STATE_PATH)) return [];
  try {
    const raw = fs.readFileSync(EMBEDDING_STATE_PATH, "utf8");
    const data = JSON.parse(raw) as { embeddings?: EmbeddingRecord[] };
    return Array.isArray(data.embeddings) ? data.embeddings : [];
  } catch {
    return [];
  }
}

export function saveEmbeddingStore(records: EmbeddingRecord[]): void {
  fs.mkdirSync(path.dirname(EMBEDDING_STATE_PATH), { recursive: true });
  const sorted = [...records].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  fs.writeFileSync(EMBEDDING_STATE_PATH, `${JSON.stringify({ embeddings: sorted }, null, 2)}\n`);
}

export interface SyncResult {
  embedded: number;
  skipped: number;
  removed: number;
}

const EMBED_BATCH_SIZE = 96;

/**
 * Diffs `sources` against `previousRecords` and embeds only what's new or
 * changed (compared via textHash) — this is the "update embedded memory
 * when sources.json changes" step, and it never re-embeds unchanged
 * sources, so a stable catalog costs nothing on repeat runs. Pure aside
 * from the embed()/save() calls: callers pass in the previously-loaded
 * store explicitly (rather than this function reading the state file
 * itself), which keeps the diffing logic unit-testable without real I/O.
 */
export async function syncEmbeddings(
  sources: StoredSource[],
  previousRecords: EmbeddingRecord[],
  provider: EmbeddingProvider,
  model: string,
  dimensions: number,
  persist: boolean,
): Promise<{ store: EmbeddingRecord[]; result: SyncResult }> {
  const existingById = new Map(previousRecords.map((record) => [record.sourceId, record]));
  const currentIds = new Set(sources.map((source) => source.id));

  let removed = 0;
  for (const id of Array.from(existingById.keys())) {
    if (!currentIds.has(id)) {
      existingById.delete(id);
      removed += 1;
    }
  }

  const toEmbed: { source: StoredSource; text: string; hash: string }[] = [];
  for (const source of sources) {
    const text = existingSourceEmbeddingText(source);
    const hash = computeTextHash(text);
    const current = existingById.get(source.id);
    if (!current || current.textHash !== hash || current.model !== model || current.dimensions !== dimensions) {
      toEmbed.push({ source, text, hash });
    }
  }

  let embedded = 0;
  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    const chunk = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await provider.embed(chunk.map((item) => item.text));
    chunk.forEach((item, index) => {
      existingById.set(item.source.id, {
        sourceId: item.source.id,
        canonicalUrl: item.source.url,
        textHash: item.hash,
        model,
        dimensions,
        vector: vectors[index] ?? [],
        updatedAt: new Date().toISOString(),
      });
      embedded += 1;
    });
  }

  const finalRecords = Array.from(existingById.values());
  if (persist && (embedded > 0 || removed > 0)) {
    saveEmbeddingStore(finalRecords);
  }

  return {
    store: finalRecords,
    result: { embedded, skipped: sources.length - toEmbed.length, removed },
  };
}

/** Embeds and appends a single newly-inserted source without a full resync — used right after insertSource() succeeds. */
export async function embedAndStoreOne(
  source: StoredSource,
  provider: EmbeddingProvider,
  model: string,
  dimensions: number,
  currentStore: EmbeddingRecord[],
): Promise<EmbeddingRecord[]> {
  const text = existingSourceEmbeddingText(source);
  const [vector] = await provider.embed([text]);
  const record: EmbeddingRecord = {
    sourceId: source.id,
    canonicalUrl: source.url,
    textHash: computeTextHash(text),
    model,
    dimensions,
    vector: vector ?? [],
    updatedAt: new Date().toISOString(),
  };
  const next = [...currentStore.filter((r) => r.sourceId !== source.id), record];
  saveEmbeddingStore(next);
  return next;
}
