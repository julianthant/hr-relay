import { createTrustRunReader } from "../../src/server/trust/canonical-reader.js";
/**
 * D199 — a settled run's receipt is bound to the semantic surfaces its
 * derivation consumes, not to the descriptor's whole source closure.
 *
 * The defect this pins was found in production, not in a fixture: chunk 2's
 * five live-proof `separations-kuali-read` receipts (traces `sd-140241-ca44`,
 * `sd-140505-28ff`, `sd-140917-2b9e`, `sd-140921-3385`, `sd-140921-c0af`) were
 * stranded when a raw-control-byte fix moved `contractFingerprint` without
 * changing one thing the derivation reads. `explain run` answered
 * `evidence receipt … already exists with different content` for all five.
 *
 * Both outcomes that live database now produces are proved here in fixture
 * form: a closure that moved with every consumed surface intact re-derives
 * byte-identically, and a genuinely moved declaration refuses while NAMING
 * what moved.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { deriveTerminalDependencyDigest } from "../../src/domain/run/result.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../src/domain/trust/evidence.js";
import {
  buildRunEvidenceReceipt,
  ensureRunEvidenceReceipt,
  type EvidenceReceiptStore,
  type ReceiptBuildInput,
  type ReceiptWriteEvidence,
} from "../../src/core/evidence-receipt.js";
import { diffReceipts } from "../../src/core/receipt-derivation-binding.js";
import { failureStatus } from "../../src/server/dashboard/routes/failure-status.js";
import { createReceiptService } from "../../src/server/trust/receipt-service.js";
import { separationsKualiFinalizationDescriptor } from "../helpers/registered-workflows.js";
import { kualiReceiptEvidence, seedPersonLookupExitRun } from "../fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

/**
 * A closure hash this build does not have. It stands for "the tree moved after
 * this run settled" — which is the ONLY thing that changed for chunk 2's
 * receipts.
 */
const MOVED_CLOSURE = "9".repeat(64);

const descriptor = separationsKualiFinalizationDescriptor;

/** The fixture run, retaining a closure this build no longer carries. */
function runUnderMovedClosure(patch: Readonly<{
  envelope?: Record<string, unknown>;
  inputParsed?: Record<string, unknown>;
}> = {}): unknown {
  const run = RunRecordSchema.parse(kualiReceiptEvidence().run);
  return {
    ...run,
    envelope: { ...run.envelope, contractFingerprint: MOVED_CLOSURE, ...(patch.envelope ?? {}) },
    input: { ...run.input, parsed: { ...run.input.parsed, ...(patch.inputParsed ?? {}) } },
  };
}

function receiptFrom(overrides: Partial<ReceiptBuildInput> = {}): RunEvidenceReceipt {
  return buildRunEvidenceReceipt({ descriptor, ...kualiReceiptEvidence(), ...overrides });
}

function refusalFor(overrides: Partial<ReceiptBuildInput>): string {
  try {
    receiptFrom(overrides);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the derivation was expected to refuse and did not");
}

/* ── (a) the stranded receipt: a moved closure re-derives byte-identically ── */

describe("receipt derivation binding — a moved closure does not strand a receipt", () => {
  it("stamps the closure the RUN executed under, never the build's", () => {
    const receipt = receiptFrom({ run: runUnderMovedClosure() });
    assert.equal(receipt.descriptorFingerprint, MOVED_CLOSURE);
    assert.notEqual(
      receipt.descriptorFingerprint,
      descriptor.contractFingerprint,
      "the receipt took the current build's closure, which is exactly the stranding defect",
    );
  });

  it("changes NOTHING else when only the closure moved", () => {
    assert.deepEqual(
      diffReceipts(receiptFrom(), receiptFrom({ run: runUnderMovedClosure() })).map(({ path }) => path),
      ["descriptorFingerprint"],
      "a closure move touched a fact about the run",
    );
  });

  it("is still a pure function of authority under the moved closure", () => {
    assert.equal(
      canonicalJsonStringify(receiptFrom({ run: runUnderMovedClosure() })),
      canonicalJsonStringify(receiptFrom({ run: runUnderMovedClosure() })),
    );
  });
});

/* ── (b) a genuinely moved surface refuses, naming it ────────────────────── */

describe("receipt derivation binding — a moved surface refuses by name", () => {
  it("refuses a run from another workflow's graph", () => {
    const message = refusalFor({ descriptor: personLookupDescriptor });
    assert.match(message, /workflow-identity moved/);
    assert.match(message, /refusing to explain a run with another workflow's graph/);
    assert.match(message, /\[skip] {2}descriptor-version/, "a check that could not run was not reported as skipped");
    assert.doesNotMatch(message, /\[held] {2}descriptor-version/, "an unevaluated check was reported as held");
  });

  it("refuses a descriptor version the run was not planned under", () => {
    const message = refusalFor({ run: runUnderMovedClosure({ envelope: { descriptorVersion: 2 } }) });
    assert.match(message, /descriptor-version moved/);
    assert.match(message, /planned under v2 and this build declares v1/);
  });

  it("refuses when the canonical-input schema the snapshot binds has moved", () => {
    const message = refusalFor({
      run: runUnderMovedClosure({ inputParsed: { schemaHash: "d".repeat(64) } }),
    });
    assert.match(message, /canonical-input moved/);
    assert.match(message, /redacted under a declaration authored for a different shape/);
  });

  it("refuses when a node the run's durable evidence names left the graph", () => {
    const evidence = kualiReceiptEvidence();
    const first = evidence.checkpoints[0];
    assert.ok(first !== null && typeof first === "object", "the fixture must carry a checkpoint");
    const message = refusalFor({
      run: runUnderMovedClosure(),
      checkpoints: [...evidence.checkpoints, { ...first, nodeId: "retired-node" }],
    });
    assert.match(message, /evidence-graph moved/);
    assert.match(message, /checkpoint node "retired-node" left the graph/);
  });

  it("refuses when the terminal dependency set the stored result was built from has moved", () => {
    const evidence = kualiReceiptEvidence();
    assert.ok(evidence.result !== null && typeof evidence.result === "object");
    // The record self-checks its own digest, so the digest is recomputed here:
    // the row stays internally consistent and only the SET moves.
    const message = refusalFor({
      run: runUnderMovedClosure(),
      result: {
        ...evidence.result,
        dependencies: [],
        dependencyDigest: deriveTerminalDependencyDigest([]),
      },
    });
    assert.match(message, /terminal-dependency-set moved/);
    assert.match(message, /the mandatory-evidence set would move/);
  });

  it("prints the whole check table with both fingerprints and no waiver", () => {
    const message = refusalFor({ run: runUnderMovedClosure({ envelope: { descriptorVersion: 2 } }) });
    assert.ok(message.includes(`${MOVED_CLOSURE.slice(0, 12)}…`), "the run's retained closure was not printed");
    assert.ok(
      message.includes(`${descriptor.contractFingerprint.slice(0, 12)}…`),
      "this build's closure was not printed",
    );
    assert.match(message, /\[held] {2}workflow-identity/, "held rows must be shown, not only the refusal");
    assert.doesNotMatch(message, /force|override|waive/iu, "a refusal must not advertise an escape hatch");
  });
});

/* ── (c) chunk 2's shape, through the real immutable insert ──────────────── */

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A real authority database holding the live person-lookup exit run, served
 * through a store whose `getRun` reports the closure the run retained. That is
 * the production shape: the durable row is fixed forever and the BUILD moved.
 */
function seededStore(): Readonly<{ store: EvidenceReceiptStore; runId: string }> {
  const root = mkdtempSync(join(tmpdir(), "hrauto-receipt-binding-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "receipt-binding-test" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  databases.push(database);
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
  it("re-derives an already-stored receipt as `existing` after the closure moved", () => {
    const { store, runId } = seededStore();
    const first = ensureRunEvidenceReceipt(store, personLookupDescriptor, runId);
    assert.equal(first.state, "derived");
    assert.equal(first.receipt.descriptorFingerprint, MOVED_CLOSURE);

    // The re-read chunk 2 could not perform. It must reach the SAME row.
    const second = ensureRunEvidenceReceipt(store, personLookupDescriptor, runId);
    assert.equal(second.state, "existing");
    assert.equal(canonicalJsonStringify(second.receipt), canonicalJsonStringify(first.receipt));
  });

  it("refuses a stored receipt whose declared redaction moved, naming the declaration", () => {
    const { store, runId } = seededStore();
    const derived = ensureRunEvidenceReceipt(store, personLookupDescriptor, runId).receipt;

    // The D197 shape: a leaf declared `safe-diagnostic`/`allow` when the
    // receipt was written is declared a `direct-identifier` today. The stored
    // row holds the OLD verdict; this build produces the new one.
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

  it("keeps legacy receipt sentences out of the service and HTTP divergence error", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-receipt-binding-http-"));
    roots.push(root);
    const database = AuthorityDatabase.open(
      { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "receipt-binding-http-test" },
      manualClock(new Date("2026-08-04T00:11:13.500Z")),
    );
    databases.push(database);
    const seeded = seedPersonLookupExitRun(database);
    const runId = String(seeded.run.envelope.runId);
    const authority = database.authority;
    const result = authority.runResults.get(runId);
    assert.ok(result);
    const compositionTwo = buildRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: seeded.run,
      result,
      checkpoints: seeded.checkpoints,
      writes: [],
      gateResults: authority.gateResults.listByRun(runId),
    }, 2);
    const rawPermanentKey = "ucpath:termination|10812345|2026-08-29";
    const legacy = storedVariant(compositionTwo, (draft) => {
      const decisions = draft.decisions as Record<string, unknown>[];
      const first = decisions[0];
      assert.ok(first !== undefined, "the composition-2 fixture must carry a decision sentence");
      decisions[0] = { ...first, reason: `legacy permanent key ${rawPermanentKey}` };
    });
    authority.evidenceReceipts.insert(legacy);

    const service = createReceiptService({ database, runReader: createTrustRunReader(database), descriptors: [personLookupDescriptor] });
    let refusal: unknown;
    try {
      service.ensureReceipt(runId);
    } catch (error) {
      refusal = error;
    }
    assert.ok(refusal instanceof Error, "the divergent immutable receipt must refuse");
    assert.equal(refusal.message.includes(rawPermanentKey), false);
    assert.match(refusal.message, /decisions\[0\]\.reason/u);
    assert.match(refusal.message, /evidence digest [a-f0-9]{12}…/u);

    const projected = failureStatus(refusal);
    assert.equal(projected.status, 500);
    assert.equal(projected.body.code, "INTERNAL_FAILURE");
    assert.equal(JSON.stringify(projected.body).includes(rawPermanentKey), false);
    assert.match(String(projected.body.message), /evidence digest [a-f0-9]{12}…/u);
  });

  it("refuses a stored receipt bound to the BUILD's closure instead of the run's", () => {
    // The pre-D199 derivation stamped `descriptor.contractFingerprint`, so a
    // row written that way claims the run executed under whatever tree happened
    // to be checked out. Reading it back must refuse, not quietly agree.
    const { store, runId } = seededStore();
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
