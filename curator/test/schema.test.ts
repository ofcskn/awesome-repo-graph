import { describe, expect, it } from "vitest";
import { classificationSchema, safeParseClassification } from "../src/classification/schema.js";

const validClassification = {
  canonicalUrl: "https://github.com/example/repo",
  title: "repo",
  description: "A factual one-line description.",
  taxonomyPath: ["AI Agent Tooling", "MCP Servers"],
  tags: ["mcp-server", "typescript"],
  qualityScore: 82,
  relevanceScore: 90,
  maintenanceScore: 70,
  uniquenessScore: 60,
  confidenceScore: 0.85,
  accepted: true,
  rejectionReasons: [],
  evidence: ["1.2k stars", "active in the last 30 days"],
  relatedExistingSourceIds: [],
};

describe("classification structured-output schema", () => {
  it("accepts a well-formed classification", () => {
    expect(safeParseClassification(validClassification).success).toBe(true);
  });

  it("rejects a quality score outside the documented 0-100 range", () => {
    expect(safeParseClassification({ ...validClassification, qualityScore: 150 }).success).toBe(false);
  });

  it("rejects a confidence score outside the documented 0-1 range", () => {
    expect(safeParseClassification({ ...validClassification, confidenceScore: 1.5 }).success).toBe(false);
  });

  it("rejects a response missing a required field", () => {
    const { taxonomyPath: _omit, ...rest } = validClassification;
    expect(safeParseClassification(rest).success).toBe(false);
  });

  it("rejects unexpected extra fields (strict schema, guards against prompt-injected fields)", () => {
    expect(safeParseClassification({ ...validClassification, extraField: "nope" }).success).toBe(false);
  });

  it("throws on parseClassification for genuinely malformed AI output", () => {
    expect(() => classificationSchema.parse({ garbage: true })).toThrow();
  });
});
