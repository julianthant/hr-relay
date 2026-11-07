
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import {
DIAGNOSTIC_ORDINARY_RETENTION_DAYS,
diagnosticOriginOfTrigger,
planDiagnosticRetention,
planDiagnosticSweep,
} from "../../../src/models/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema } from "../../../src/models/trust/diagnostic.js";
import { HASH_A,HASH_B,NOW,UUID_1 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("diagnostic capture triggers", () => {
  it("maps every ref operator-trust §2.2 trigger onto its stored origin arm", () => {
    const failureId = UUID_1;
    assert.deepEqual(diagnosticOriginOfTrigger({ trigger: "task-failure", failureId }), { kind: "failure", failureId });
    assert.deepEqual(diagnosticOriginOfTrigger({ trigger: "unexpected-state", failureId }), { kind: "unexpected-state", failureId });
    assert.deepEqual(diagnosticOriginOfTrigger({ trigger: "subject-mismatch", failureId }), { kind: "subject-mismatch", failureId });
    assert.deepEqual(diagnosticOriginOfTrigger({ trigger: "recovery-park", failureId }), { kind: "recovery-park", failureId });
    assert.deepEqual(
      diagnosticOriginOfTrigger({ trigger: "operator-request", requestedBy: "local-operator" }),
      { kind: "operator-request", requestedBy: "local-operator" },
    );
  });

  it("refuses a capture whose trigger and evidence disagree", () => {
    assert.throws(
      () => diagnosticOriginOfTrigger({ trigger: "task-failure" }),
      /must name the failure it explains/,
    );
    assert.throws(
      () => diagnosticOriginOfTrigger({ trigger: "operator-request" }),
      /must name the requesting actor/,
    );
    assert.throws(
      () => diagnosticOriginOfTrigger({ trigger: "operator-request", requestedBy: "local-operator", failureId: UUID_1 }),
      /names no failure/,
    );
    assert.throws(() => diagnosticOriginOfTrigger({ trigger: "screenshot-please" }), /invalid|expected/i);
  });
});

describe("retention and the pin sweep", () => {
  it("derives an ordinary purge instant from the capture instant, not from now", () => {
    const retention = planDiagnosticRetention({ capturedAt: NOW, request: { kind: "ordinary" } });
    assert.equal(retention.kind, "ordinary");
    assert.equal(
      retention.kind === "ordinary" ? retention.purgeAfter : "",
      new Date(Date.parse(NOW) + DIAGNOSTIC_ORDINARY_RETENTION_DAYS * 86_400_000).toISOString(),
    );
    assert.deepEqual(
      planDiagnosticRetention({ capturedAt: NOW, request: { kind: "pinned", reason: "knowledge" } }),
      { kind: "pinned", reason: "knowledge" },
    );
  });

  it("plans one closed disposition per bundle", () => {
    const bundles = [
      { retention: { kind: "ordinary", purgeAfter: NOW } },
      { retention: { kind: "ordinary", purgeAfter: "2999-01-01T00:00:00.000Z" } },
      { retention: { kind: "pinned", reason: "write-recovery" } },
    ].map((partial, index) => ({
      bundleId: `0000000${index}-0000-4000-8000-00000000000a`,
      runId: RUN_ID,
      origin: { kind: "operator-request" as const, requestedBy: "local-operator" },
      createdAt: NOW,
      contentDigest: HASH_A,
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      redaction: { fields: [], warnings: [] },
      attachments: [],
      ...partial,
    })).map((bundle) => DiagnosticBundleSchema.parse(bundle));
    assert.deepEqual(
      planDiagnosticSweep({ now: NOW, bundles }).map(({ state }) => state),
      ["purge", "retain-live", "retain-pinned"],
    );
  });
});
