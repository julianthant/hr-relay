
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { IntakeManifestWireSchema,IntakeSessionWireSchema } from "../../../src/models/intake/wire.js";
import { HASH_A,NOW,UUID_2,UUID_3,UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function sessionWire(overrides: Record<string, unknown> = {}) {
  return {
    wireVersion: 1,
    intakeSessionId: UUID_7,
    workflow: "person-lookup",
    artifact: {
      id: UUID_2,
      sha256: HASH_A,
      bytes: 2048,
      mediaType: "text/csv",
    },
    sourceName: "people.csv",
    state: "mapping",
    expectedVersion: 1,
    reservedManifestId: UUID_2,
    createdAt: NOW,
    updatedAt: NOW,
    sheets: ["default"],
    sheet: "default",
    headerCandidates: [],
    headerDiscoveryReason: "no-rows",
    headerRowIndex: null,
    headerFingerprint: null,
    columns: [],
    rowCount: 0,
    targets: [],
    bindings: [],
    constants: [],
    corrections: [],
    exclusions: [],
    suggestions: [],
    validation: { state: "none" },
    ...overrides,
  };
}

function manifestWire(overrides: Record<string, unknown> = {}) {
  return {
    manifestId: UUID_2,
    mappingFingerprint: HASH_A,
    mappingSnapshotHash: HASH_A,
    intakeProjectionFingerprint: HASH_A,
    workflowContractFingerprint: HASH_A,
    canonicalInputSchemaHash: HASH_A,
    createdAt: NOW,
    totals: {
      sourceRows: 0,
      valid: 0,
      rejected: 0,
      rejectionEvents: 0,
      excluded: 0,
      corrected: 0,
    },
    sourceRowDispositions: [],
    validRows: [],
    ...overrides,
  };
}

describe("intake session wire", () => {
  it("accepts the exact terminal manifest committed under the reserved identity", () => {
    const wire = IntakeSessionWireSchema.parse(sessionWire({
      state: "enqueued",
      intakeManifestId: UUID_2,
      manifest: manifestWire(),
    }));

    assert.deepEqual(wire.manifest, manifestWire());
  });

  it("refuses an enqueued session without its terminal manifest identity", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({ state: "enqueued" })),
      /an enqueued session names the manifest it fanned out as/u,
    );
  });

  it("refuses an enqueued identity without the immutable terminal manifest", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({ state: "enqueued", intakeManifestId: UUID_2 })),
      /an enqueued session serves the immutable manifest it committed/u,
    );
  });

  it("refuses a non-enqueued session with a terminal manifest identity", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({ intakeManifestId: UUID_2 })),
      /only an enqueued session carries a manifest id/u,
    );
  });

  it("refuses unequal reserved and terminal manifest identities", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({
        state: "enqueued",
        intakeManifestId: UUID_3,
        manifest: manifestWire({ manifestId: UUID_3 }),
      })),
      /an enqueued session consumes its reserved manifest id exactly/u,
    );
  });

  it("refuses a terminal manifest whose identity differs from the committed identity", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({
        state: "enqueued",
        intakeManifestId: UUID_2,
        manifest: manifestWire({ manifestId: UUID_3 }),
      })),
      /the terminal manifest matches the session's committed manifest id/u,
    );
  });

  it("refuses a terminal rerun whose identity differs from the committed manifest", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({
        state: "enqueued",
        intakeManifestId: UUID_2,
        manifest: manifestWire(),
        rerun: {
          intakeManifestId: UUID_3,
          createdAt: NOW,
          totals: manifestWire().totals,
          diff: { kind: "same-plan" },
        },
      })),
      /the terminal rerun matches the session's committed manifest id/u,
    );
  });

  it("refuses a preflight session that claims a terminal manifest exists", () => {
    assert.throws(
      () => IntakeSessionWireSchema.parse(sessionWire({ manifest: manifestWire() })),
      /a manifest exists only after the session enqueues/u,
    );
  });

  it("refuses undeclared terminal manifest facts", () => {
    assert.throws(
      () => IntakeManifestWireSchema.parse(manifestWire({ guessedStatus: "ready" })),
      /Unrecognized key/u,
    );
  });

  it("refuses duplicate stable item identities in a terminal manifest", () => {
    const validRows = [1, 2].map((sourceRow) => ({
      sourceRow,
      itemId: UUID_7,
      inputHash: HASH_A,
      parsedInput: { emplId: `row-${String(sourceRow)}` },
    }));

    assert.throws(
      () => IntakeManifestWireSchema.parse(manifestWire({
        totals: {
          sourceRows: 2,
          valid: 2,
          rejected: 0,
          rejectionEvents: 0,
          excluded: 0,
          corrected: 0,
        },
        sourceRowDispositions: validRows.map((row) => ({
          sourceRow: row.sourceRow,
          disposition: "valid",
          itemId: row.itemId,
          currentRejectIds: [],
        })),
        validRows,
      })),
      /validRows repeats a stable item identity/u,
    );
  });

  it("refuses a terminal manifest whose dispositions do not cover its row total", () => {
    const validRow = {
      sourceRow: 1,
      itemId: UUID_7,
      inputHash: HASH_A,
      parsedInput: { emplId: "row-1" },
    };

    assert.throws(
      () => IntakeManifestWireSchema.parse(manifestWire({
        totals: {
          sourceRows: 2,
          valid: 1,
          rejected: 0,
          rejectionEvents: 0,
          excluded: 0,
          corrected: 0,
        },
        sourceRowDispositions: [{
          sourceRow: 1,
          disposition: "valid",
          itemId: validRow.itemId,
          currentRejectIds: [],
        }],
        validRows: [validRow],
      })),
      /1 dispositions cover a file of 2 rows/u,
    );
  });
});
