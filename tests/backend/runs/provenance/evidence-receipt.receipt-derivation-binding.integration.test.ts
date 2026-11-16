import { closePersonLookupReceiptDatabase, openPersonLookupReceiptDatabase } from "../../../support/helpers/backend/person-lookup-receipt-database.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
ensureRunEvidenceReceipt,
type EvidenceReceiptStore,
type ReceiptWriteEvidence
} from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunEvidenceReceiptSchema,type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { seedPersonLookupExitRun } from "../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor,separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";


const MOVED_CLOSURE = "9".repeat(64);

const _descriptor = separationsKualiFinalizationDescriptor;

/* ── (c) chunk 2's shape, through the real immutable insert ──────────────── */

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) await closePersonLookupReceiptDatabase(database);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


async function seededStore(): Promise<Readonly<{ store: EvidenceReceiptStore; runId: string }>> {
  const database = await openPersonLookupReceiptDatabase(roots, databases, "hrauto-receipt-binding-", "receipt-binding-test");
  const seeded = seedPersonLookupExitRun(database);
  const { authority } = database;
  const runId = String(seeded.run.envelope.runId);
  const run = {
    ...seeded.run,
    envelope: { ...seeded.run.envelope, contractFingerprint: MOVED_CLOSURE },
  };
  return Object.freeze({
    runId,
    store: Object.freeze({
      getRun: () => run,
      getResult: () => authority.runResults.get(runId),
      getFailure: (failureId: string) => authority.failures.get(failureId),
      listCheckpointsByRun: () => seeded.checkpoints,
      listWritesByRun: (): readonly ReceiptWriteEvidence[] => [],
      listGateResultsByRun: () => authority.gateResults.listByRun(runId),
      findReceiptByRun: () => authority.evidenceReceipts.findByRun(runId),
      insertReceipt: (receipt: unknown) => authority.evidenceReceipts.insert(receipt),
    }),
  });
}

/** A stored receipt with one field replaced, re-parsed as authority would. */
function storedVariant(
  receipt: RunEvidenceReceipt,
  mutate: (draft: Record<string, unknown>) => void,
): RunEvidenceReceipt {
  const draft = JSON.parse(canonicalJsonStringify(receipt)) as Record<string, unknown>;
  mutate(draft);
  return RunEvidenceReceiptSchema.parse(draft);
}

describe("receipt derivation binding — the stored receipt survives a moved closure", () => {
  it("re-derives an already-stored receipt as `existing` after the closure moved", async () => {
    const { store, runId } = await seededStore();
    const first = ensureRunEvidenceReceipt(store, personLookupDescriptor, runId);
    assert.equal(first.state, "derived");
    assert.equal(first.receipt.descriptorFingerprint, MOVED_CLOSURE);

    // The re-read chunk 2 could not perform. It must reach the SAME row.
    const second = ensureRunEvidenceReceipt(store, personLookupDescriptor, runId);
    assert.equal(second.state, "existing");
    assert.equal(canonicalJsonStringify(second.receipt), canonicalJsonStringify(first.receipt));
  });

  it("refuses a stored receipt whose declared redaction moved, naming the declaration", async () => {
    const { store, runId } = await seededStore();
    const derived = ensureRunEvidenceReceipt(store, personLookupDescriptor, runId).receipt;

    // Probe moved classifications against the original stored declaration, not a recomputed receipt.
    const priorDeclaration = storedVariant(derived, (draft) => {
      const observations = draft.observations as Record<string, unknown>[];
      const index = observations.findIndex((row) => {
        const value = row.value;
        return value !== null && typeof value === "object" && "state" in value && value.state === "allowed";
      });
      assert.ok(index >= 0, "the fixture must carry an `allowed` observation to re-classify");
      const row = observations[index];
      const value = row.value as Record<string, unknown>;
      const raw = value.value;
      observations[index] = {
        ...row,
        value: {
          state: "transformed",
          key: value.key,
          classification: "direct-identifier",
          transform: "last4",
          value: typeof raw === "string" ? raw.slice(-4) : "0000",
        },
      };
    });

    const frozen: EvidenceReceiptStore = Object.freeze({
      ...store,
      findReceiptByRun: () => priorDeclaration,
    });
    assert.throws(
      () => ensureRunEvidenceReceipt(frozen, personLookupDescriptor, runId),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /declared-evidence moved/);
        assert.match(message, /declared-redaction \(\d+ path\(s\)/);
        assert.match(message, /observations\[\d+]\.value\./);
        assert.match(message, /\[held] {2}workflow-identity/, "the held rows must still be printed");
        return true;
      },
    );
  });

  it("refuses a stored receipt bound to the BUILD's closure instead of the run's", async () => {

    const { store, runId } = await seededStore();
    const derived = ensureRunEvidenceReceipt(store, personLookupDescriptor, runId).receipt;
    const preFix = storedVariant(derived, (draft) => {
      draft.descriptorFingerprint = personLookupDescriptor.contractFingerprint;
    });
    const frozen: EvidenceReceiptStore = Object.freeze({ ...store, findReceiptByRun: () => preFix });
    assert.throws(
      () => ensureRunEvidenceReceipt(frozen, personLookupDescriptor, runId),
      /declared-evidence moved[\s\S]*run-identity/u,
    );
  });
});
