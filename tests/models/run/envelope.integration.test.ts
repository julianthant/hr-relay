
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunEnvelopeSchema } from "../../../src/models/run/envelope.js";
import {
NOW
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
RUN_ENVELOPE,
RUN_ID
} from "../../support/fixtures/phase1f-run-fixtures.js";

describe("RunEnvelope", () => {
  it("accepts the minimum legal first-attempt envelope", () => {
    assert.equal(RunEnvelopeSchema.parse(RUN_ENVELOPE).attempt, 1);
  });

  it("refuses a run that is its own retry or its own parent", () => {
    assert.throws(() => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, retryOf: RUN_ID }), /retry of itself/);
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        parent: { runId: RUN_ID, tracePrefix: "pl-170000-2222", edgeId: "member" },
      }),
      /its own parent/,
    );
  });

  it("refuses a resolved instance that ignores or contradicts the request", () => {
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        requestedInstance: { ucpath: "test" },
        resolvedInstance: { ucpath: "prod", crm: "prod" },
      }),
      /requested as test but resolved to prod/,
    );
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        requestedInstance: { kuali: "test" },
      }),
      /requested but enqueue resolved no instance/,
    );
  });

  it("refuses an unknown browser system in an instance map", () => {
    assert.throws(
      () => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, resolvedInstance: { peoplesoft: "prod" } }),
      /invalid|unrecognized|expected/i,
    );
  });

  it("refuses a freshness override scoped to a different attempt", () => {
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        attempt: 2,
        freshnessOverride: [{
          nodeId: "searching",
          fieldPaths: ["selection.status"],
          confirmedAt: NOW,
          reason: "operator confirmed the person is unchanged",
          validForAttempt: 1,
        }],
      }),
      /scoped to attempt 1 but this run is attempt 2/,
    );
  });

  it("accepts injected patches without an entry node, refusing entry-node and duplicate patches", () => {
    const patch = {
      nodeId: "searching",
      fieldPath: "selection.status",
      value: "resolved",
      correctedAt: NOW,
      reason: "operator corrected the selection",
    };

    assert.equal(
      RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, injected: [patch] }).injected?.length,
      1,
    );
    assert.throws(
      () => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, startAt: "searching", injected: [patch] }),
      /is the entry node and will re-run/,
    );
    assert.throws(
      () => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, startAt: "active-status", injected: [patch, patch] }),
      /two patches target searching.selection.status/,
    );
    assert.equal(
      RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, startAt: "active-status", injected: [patch] }).injected?.length,
      1,
    );
  });
});
