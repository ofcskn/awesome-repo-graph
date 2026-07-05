import { z } from "zod";

/**
 * Runtime schema for the AI provider's structured classification output.
 * Score fields are fixed to a documented 0-100 range; confidenceScore is
 * 0-1. Any response failing this schema is treated as a provider failure
 * (retried / falls back) rather than trusted.
 */
export const classificationSchema = z
  .object({
    canonicalUrl: z.string().url(),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(600),
    taxonomyPath: z.array(z.string().min(1)).min(1).max(6),
    tags: z.array(z.string().min(1)).max(20),
    qualityScore: z.number().min(0).max(100),
    relevanceScore: z.number().min(0).max(100),
    maintenanceScore: z.number().min(0).max(100),
    uniquenessScore: z.number().min(0).max(100),
    confidenceScore: z.number().min(0).max(1),
    accepted: z.boolean(),
    rejectionReasons: z.array(z.string()).max(20),
    evidence: z.array(z.string()).max(20),
    relatedExistingSourceIds: z.array(z.string()).max(20),
  })
  .strict();

export type ClassificationSchemaType = z.infer<typeof classificationSchema>;

/** JSON Schema mirror of classificationSchema, for providers that need a raw JSON Schema (OpenAI/DeepSeek response_format, Gemini responseSchema). */
export const classificationJsonSchema = {
  type: "object",
  properties: {
    canonicalUrl: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    taxonomyPath: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    qualityScore: { type: "number" },
    relevanceScore: { type: "number" },
    maintenanceScore: { type: "number" },
    uniquenessScore: { type: "number" },
    confidenceScore: { type: "number" },
    accepted: { type: "boolean" },
    rejectionReasons: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    relatedExistingSourceIds: { type: "array", items: { type: "string" } },
  },
  required: [
    "canonicalUrl",
    "title",
    "description",
    "taxonomyPath",
    "tags",
    "qualityScore",
    "relevanceScore",
    "maintenanceScore",
    "uniquenessScore",
    "confidenceScore",
    "accepted",
    "rejectionReasons",
    "evidence",
    "relatedExistingSourceIds",
  ],
  additionalProperties: false,
} as const;

export function parseClassification(raw: unknown): ClassificationSchemaType {
  return classificationSchema.parse(raw);
}

export function safeParseClassification(raw: unknown) {
  return classificationSchema.safeParse(raw);
}
