export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ScoredMatch<T> {
  item: T;
  score: number;
}

/** Returns the top-K items by cosine similarity to `query`, highest first. */
export function findNearest<T>(
  query: number[],
  candidates: { vector: number[]; item: T }[],
  topK: number,
): ScoredMatch<T>[] {
  return candidates
    .map(({ vector, item }) => ({ item, score: cosineSimilarity(query, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
