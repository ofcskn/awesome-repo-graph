import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateAttestation, ATTESTATION_PATH } from "../src/git/attest.js";

// The curator-side wrapper around scripts/attest.js. The behaviour that must
// never regress is fail-open: with no signing key present, a run must still
// complete — the attestation step is skipped, not failed. (The signing/
// verification itself is covered end-to-end by scripts/test/attestation.test.js.)
describe("generateAttestation (approved-agent wiring)", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.AGENT_SIGNING_KEY;
    delete process.env.AGENT_SIGNING_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENT_SIGNING_KEY;
    else process.env.AGENT_SIGNING_KEY = savedKey;
  });

  it("skips (never fails) when no signing key is available", async () => {
    const result = await generateAttestation({ agentId: "any", keyId: "any" });
    expect(result.skipped).toBe(true);
    expect(result.created).toBe(false);
    expect(result.path).toBeNull();
    expect(result.error).toBeNull();
  });

  it("treats an empty AGENT_SIGNING_KEY as absent", async () => {
    process.env.AGENT_SIGNING_KEY = "";
    const result = await generateAttestation({ agentId: "any", keyId: "any" });
    expect(result.skipped).toBe(true);
    expect(result.created).toBe(false);
  });

  it("exposes the repo-relative attestation path the commit step stages", () => {
    expect(ATTESTATION_PATH).toBe("agent-attestation.json");
  });
});
