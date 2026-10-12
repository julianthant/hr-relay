import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDeterministicProviderHarness } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { FingerprintSchema,IsoInstantSchema } from "../../../../src/rules/identity/ids.js";


{

describe("task, store, session, provider, and artifact seams", () => {

  it("validates deterministic provider envelopes and fails loud when scripted outcomes end", async () => {
    const hash = FingerprintSchema.parse("a".repeat(64));
    const response = {
      state: "produced" as const,
      value: { schemaHash: hash, value: { text: "recognized" } },
    };
    const harness = createDeterministicProviderHarness("ocr.extract", [{
      kind: "return",

      outcome: {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    }]);
    const signal = new AbortController().signal;
    const request = { capability: "ocr.extract" as const, payload: { schemaHash: hash, value: { artifact: "fixture" } } };
    assert.deepEqual(
      await harness.adapter.invoke(request, {
        signal,
        deadlineMonotonicMs: 100,
        requestId: "00000000-0000-4000-8000-000000000021",
      }),
      {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    );
    assert.equal(harness.calls().length, 1);
    await assert.rejects(harness.adapter.invoke(request, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000022" }), /no queued script/);
    await assert.rejects(harness.adapter.invoke({ capability: "geocode.nominatim", payload: request.payload }, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000023" }), /cannot invoke capability/);

  })
});
}
