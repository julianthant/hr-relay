import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArtifactRefSchema } from "../../../../../../src/models/artifacts/artifacts.js";
import type { VerifiedByteLease } from "../../../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { verifiedByteResponse } from "../../../../../../src/backend/transports/http/routes/verified-byte-response.js";

const REF = ArtifactRefSchema.parse({
  id: "00000000-0000-4000-8000-000000000303",
  sha256: "a".repeat(64),
  bytes: 8,
  mediaType: "application/octet-stream",
});

function responseOf(lease: VerifiedByteLease): Promise<Response> {
  return verifiedByteResponse({ lease, method: "GET", range: undefined, profile: "generic" });
}

describe("verified byte response lease failures", () => {
  it("disposes after takeBody rejects and preserves that primary failure", async () => {
    const primary = new Error("take body failed");
    const events: string[] = [];
    const lease: VerifiedByteLease = {
      ref: REF,
      takeBody: async () => {
        events.push("takeBody");
        throw primary;
      },
      dispose: async () => { events.push("dispose"); },
    };

    await assert.rejects(responseOf(lease), (error: unknown) => error === primary);
    assert.deepEqual(events, ["takeBody", "dispose"]);
  });

  it("orders takeBody primary before dispose failure in the aggregate", async () => {
    const primary = new Error("take body failed");
    const cleanup = new Error("dispose failed");
    const lease: VerifiedByteLease = {
      ref: REF,
      takeBody: async () => { throw primary; },
      dispose: async () => { throw cleanup; },
    };

    await assert.rejects(responseOf(lease), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanup]);
      assert.equal(error.cause, primary);
      return true;
    });
  });
});
