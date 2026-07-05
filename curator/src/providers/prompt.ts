import type { Candidate, ExistingSourceSummary } from "../types.js";

const SYSTEM_INSTRUCTIONS = `You are a strict, evidence-based curator classifying open-source repositories for a technical catalog.

Rules:
- Base every claim ONLY on the provided repository metadata (description, topics, language, stars, license, README excerpt if given). Never invent facts, integrations, adoption numbers, or comparisons.
- The description you write must be factual, concise (1-3 sentences), and neutral — no marketing superlatives ("best", "revolutionary"), no unverifiable claims.
- Reuse an existing taxonomy path or tag whenever it reasonably fits. Only introduce a new path/tag when nothing existing fits — this is expensive, so prefer reuse. Exception: if a target category is listed below and the candidate genuinely belongs there, use it as the taxonomyPath's first element even though it isn't in the existing list yet — don't force-fit the candidate into an unrelated existing sector just to avoid introducing the target category.
- taxonomyPath must go broad-to-specific, e.g. ["AI Agent Tooling", "MCP Servers"].
- tags must be lowercase kebab-case, describe durable technical characteristics, and avoid generic filler ("tool", "project", "awesome", "repository") and redundant synonyms.
- Score qualityScore/relevanceScore/maintenanceScore/uniquenessScore on a fixed 0-100 scale. Score confidenceScore on a 0-1 scale reflecting how certain you are in this classification overall.
- Set accepted=false and populate rejectionReasons if the repository is spam, a placeholder, abandoned, off-topic, or you lack enough evidence to classify it confidently.
- relatedExistingSourceIds should list ids of existing sources that are clearly related (shared purpose or tags), if any.
- Respond with ONLY the JSON object matching the provided schema — no prose, no markdown fences.`;

/**
 * Fallback used only when no embedding provider is configured/available
 * (see run.ts). When embeddings are available, run.ts instead passes an
 * embedding-nearest-neighbor selection into buildClassificationPrompt,
 * which tends to surface more genuinely similar sources than a raw
 * topic-string overlap.
 */
export function selectRelatedSourcesByTopic(
  candidate: Candidate,
  existingSources: ExistingSourceSummary[],
  limit = 15,
): ExistingSourceSummary[] {
  return existingSources.filter((s) => s.tags.some((t) => candidate.topics.includes(t))).slice(0, limit);
}

export function buildClassificationPrompt(
  candidate: Candidate,
  existingTaxonomyPaths: string[][],
  existingTags: string[],
  /** Already-narrowed related sources to show as context — see selectRelatedSourcesByTopic's doc comment for why this isn't filtered here. */
  relatedSources: ExistingSourceSummary[],
  /** config.discovery.categories: sector names this run is actively trying to seed, even though they aren't in existingTaxonomyPaths yet. */
  targetCategories: string[] = [],
): { system: string; user: string } {
  const taxonomyList = existingTaxonomyPaths
    .map((path) => `- ${path.join(" > ")}`)
    .join("\n");
  const tagsList = existingTags.join(", ");
  const relatedCandidates = relatedSources
    .slice(0, 15)
    .map((s) => `- ${s.id} (${s.path.join(" > ")}) tags: ${s.tags.join(", ")}`)
    .join("\n");
  const targetCategoriesList = targetCategories.map((c) => `- ${c}`).join("\n");

  const user = `Classify this repository candidate:

${JSON.stringify(
  {
    url: candidate.canonicalUrl,
    owner: candidate.owner,
    repo: candidate.repo,
    title: candidate.title,
    description: candidate.description,
    stars: candidate.stars,
    forks: candidate.forks,
    license: candidate.license,
    primaryLanguage: candidate.primaryLanguage,
    topics: candidate.topics,
    createdAt: candidate.createdAt,
    lastPushAt: candidate.lastPushAt,
    archived: candidate.archived,
    isFork: candidate.isFork,
    homepage: candidate.homepage,
  },
  null,
  2,
)}

Existing taxonomy paths in the catalog (reuse when reasonable):
${taxonomyList || "(none yet)"}

Existing tags in the catalog (reuse when reasonable):
${tagsList || "(none yet)"}

Possibly-related existing sources by shared topic:
${relatedCandidates || "(none found)"}

Target categories for this run (prefer these over forcing a fit into an unrelated existing path — see system rules):
${targetCategoriesList || "(none configured for this run)"}`;

  return { system: SYSTEM_INSTRUCTIONS, user };
}
