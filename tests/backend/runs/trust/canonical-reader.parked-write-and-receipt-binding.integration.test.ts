import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { SectionUnavailableError } from "../../../../src/backend/runs/commands/refusals.js";
import { buildRunSection } from "../../../../src/backend/runs/queries/run-detail.js";
import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { foldTrustGate } from "../../../support/helpers/backend/trust-authority-fixture.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { WRITE_FIXTURE_KEY, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureDescriptor, writeFixtureDescriptorAfterUnrelatedEdit, writeFixtureDescriptorWithMovedKey, WriteFixtureProofSchema } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { closePersonLookupReceiptDatabase, openPersonLookupReceiptDatabase } from "../../../support/helpers/backend/person-lookup-receipt-database.js";

import { buildRunEvidenceReceipt, type ReceiptBuildInput } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { failureStatus } from "../../../../src/backend/transports/http/routes/failure-status.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { kualiReceiptEvidence, seedPersonLookupExitRun } from "../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor, separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

{
const { cleanup, roundTrip, parkedIntent, nextCommandId, resolutionCommand } = createParkedWriteRoundTripTestWorld();

describe("post-fence park → typed outcome arm → typed operator resolution", () => {
afterEach(cleanup);

  it("serves canonical parked-write evidence without a fold and refuses foreign intent membership", async () => {
    const h = roundTrip(); await h.park();
    const projection = makeWorld();
    try {
      const deps = { stateRoot: projection.stateRoot, projection: projection.projection,
        runReader: createTrustRunReader(h.database, h.clock), timeline: h.database.authority.timelineEvents,
        authority: { getRun: () => { throw new Error("raw lifecycle forbidden"); },
          latestCheckpoint: () => undefined,
          listCheckpoints: (workflow: string, item: string) => h.database.authority.runCheckpoints.listByItem(workflow, item),
          getWriteIntent: (id: string) => h.database.authority.writeIntents.get(id),
          listGateResults: (id: string) => h.database.authority.gateResults.listByRun(id) },
        descriptors: { resolve: () => undefined } };
      assert.equal(projection.projection.runFold(WRITE_FIXTURE_RUN_ID), undefined);
      const section = buildRunSection(deps, WRITE_FIXTURE_RUN_ID, "parked-write");
      assert.equal(section.section, "parked-write");
      const intent = parkedIntent(h.database);
      assert.equal(intent.status, "parked"); if (intent.status !== "parked") throw new Error("not parked");
      for (const changed of [{ workflowId: "person-lookup" }, { runAttempt: intent.runAttempt + 1 },
        { itemId: "aaaaaaaa-0000-4000-8000-000000000001" }, { runId: "aaaaaaaa-0000-4000-8000-000000000002" }]) {
        assert.throws(() => buildRunSection({ ...deps, authority: { ...deps.authority,
          getWriteIntent: () => ({ ...intent, ...changed }) as typeof intent } }, WRITE_FIXTURE_RUN_ID, "parked-write"),
        /IDENTITY_MISMATCH|belongs to/);
      }
      assert.deepEqual(parkedIntent(h.database), intent);
      const state = deps.runReader.read(WRITE_FIXTURE_RUN_ID);
      assert.equal(state.state, "present"); if (state.state !== "present") throw new Error("parked run missing");
      foldTrustGate(projection, state.run, "resolved");
      const contradictory = buildRunSection(deps, WRITE_FIXTURE_RUN_ID, "parked-write");
      assert.deepEqual(contradictory, section, "resolved fold cannot hide canonical parked-write actions");
      const resolved = h.kernel.execute(resolutionCommand("resolve-write-absent", {
        runId: WRITE_FIXTURE_RUN_ID, expectedVersion: state.run.version,
        writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
      }, { evidenceNote: "checked target: no transaction exists" }));
      assert.equal(resolved.state, "applied");
      const resumed = deps.runReader.read(WRITE_FIXTURE_RUN_ID);
      assert.equal(resumed.state, "present"); if (resumed.state !== "present") throw new Error("resumed run missing");
      assert.equal(resumed.run.lifecycle.state, "queued");
      foldTrustGate(projection, resumed.run, "open");
      assert.throws(() => buildRunSection(deps, WRITE_FIXTURE_RUN_ID, "parked-write"), SectionUnavailableError,
        "stale open evidence cannot regrant resolved write actions");

    } finally { projection.dispose(); }
  });
  it("reports parked-write as a first-class outcome over the durable parked state", async () => {
    const harness = roundTrip();
    const report = await harness.park();

    assert.equal(report.stopped, "idle");
    assert.equal(report.outcomes.length, 1);
    const outcome = report.outcomes[0];
    assert.ok(outcome && outcome.state === "parked-write");
    assert.equal(outcome.runId, WRITE_FIXTURE_RUN_ID);
    assert.equal(outcome.code, "unknown");

    const intent = parkedIntent(harness.database);
    assert.equal(intent.status, "parked");
    assert.equal(outcome.writeIntentId, intent.writeIntentId);
    assert.equal(outcome.intentGeneration, intent.generation);

    const run = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run && run.lifecycle.state === "parked-write");
    assert.equal(run.lifecycle.writeIntentId, intent.writeIntentId);
    assert.equal(run.lifecycle.code, "unknown");


    assert.deepEqual(harness.database.authority.failures.listByRun(WRITE_FIXTURE_RUN_ID), []);
    assert.equal(harness.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID), undefined);
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.completion, undefined);
  });

  it("confirmed-absent makes the run resumable at the transaction node, intent retryable", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const result = harness.kernel.execute(resolutionCommand("resolve-write-absent", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, { evidenceNote: "checked UCPath: no transaction exists for this key" }));
    assert.equal(result.state, "applied");

    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed && resumed.lifecycle.state === "queued");
    assert.equal(resumed.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    assert.equal(
      harness.database.authority.writeIntents.get(intent.writeIntentId)?.status,
      "retryable",
    );
  });


  it("resolves confirmed-absent after an unrelated edit moved the contract closure", async () => {
    const harness = roundTrip(writeFixtureDescriptorAfterUnrelatedEdit);
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);
    assert.notEqual(
      parked.envelope.contractFingerprint,
      writeFixtureDescriptorAfterUnrelatedEdit.contractFingerprint,
      "the fixture must actually model a moved closure",
    );

    const result = harness.kernel.execute(resolutionCommand("resolve-write-absent", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, { evidenceNote: "five reads of an empty field; the mutation body carried no entry at the formKey" }));
    assert.equal(result.state, "applied", "an incidental closure move may not strand a parked write");

    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "retryable");
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed && resumed.lifecycle.state === "queued");
    assert.equal(resumed.envelope.startAt, WRITE_FIXTURE_NODE_ID);

    assert.equal(resumed.envelope.contractFingerprint, parked.envelope.contractFingerprint);
  });

  it("resolves confirmed-present after an unrelated edit moved the contract closure", async () => {
    const harness = roundTrip(writeFixtureDescriptorAfterUnrelatedEdit);
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const result = harness.kernel.execute(resolutionCommand("resolve-write-present", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, {
      proof: {
        schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
        value: { transactionId: "T998877" },
      },
      evidenceNote: "receipt T998877 is visible in UCPath",
    }));
    assert.equal(result.state, "applied");
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "committed");
  });

  it("still refuses loudly when the permanent key itself moved, naming the exact check", async () => {
    const harness = roundTrip(writeFixtureDescriptorWithMovedKey);
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    assert.throws(
      () => harness.kernel.execute(resolutionCommand("resolve-write-absent", {
        runId: WRITE_FIXTURE_RUN_ID,
        expectedVersion: parked.version,
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
      }, { evidenceNote: "checked the target system" })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /permanent-key-identity moved/);
        assert.equal(error.message.includes(WRITE_FIXTURE_KEY), false, "the fenced natural key is authority-only");
        assert.ok(
          error.message.includes(WRITE_FIXTURE_KEY_DIGEST.slice(0, 12)),
          "the fenced digest reference must be named",
        );
        assert.ok(error.message.includes("[held]  transaction-node"), "held checks are shown too");
        return true;
      },
    );

    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("gives no arm but the typed resolutions any way out of a park", async () => {
    const harness = roundTrip(writeFixtureDescriptorAfterUnrelatedEdit);
    await harness.park();
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const retry = harness.kernel.execute({
      commandId: nextCommandId(),
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "retry",
      target: { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: parked.version },
    });
    assert.equal(retry.state, "rejected");
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.equal(parkedIntent(harness.database).status, "parked");
  });

  it("refuses a stale resolution against the parked generation", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const stale = harness.kernel.execute(resolutionCommand("resolve-write-absent", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation + 1,
    }, { evidenceNote: "stale browser tab" }));
    assert.equal(stale.state, "rejected");
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
  });
});


describe("a confirmed-present proof that does not fit", () => {
afterEach(cleanup);

  async function refusedPresent(payload: Record<string, unknown>) {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);
    const result = harness.kernel.execute(resolutionCommand("resolve-write-present", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, payload));
    const after = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(after && after.lifecycle.state === "parked-write", "the park survived the refusal");
    assert.equal(after.version, parked.version);
    const settled = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(settled && settled.status === "parked");
    assert.equal(settled.generation, intent.generation);
    return result;
  }

  it("rejects a proof bound to a schema this build does not have", async () => {
    const result = await refusedPresent({
      proof: { schemaHash: "1".repeat(64), value: { transactionId: "T998877" } },
      evidenceNote: "pasted from a stale tab",
    });
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "schema-mismatch");
    assert.match(result.message, /bound to schema/);
  });

  it("rejects a proof that does not parse, naming the leaf that failed", async () => {
    const result = await refusedPresent({
      proof: {
        schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
        // The contract's receipt is `T` + at least six digits.
        value: { transactionId: "nope" },
      },
      evidenceNote: "typed what the page showed",
    });
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "schema-mismatch");
    assert.match(result.message, /does not parse through/);
    assert.match(result.message, /transactionId/);
  });
});


describe("cancel over an unresolved fenced write", () => {
afterEach(cleanup);

  function cancelCommand(runId: string, expectedVersion: number) {
    return {
      commandId: nextCommandId(),
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "cancel",
      target: { runId, expectedVersion },
    } as const;
  }

  it("refuses the cancel by name and cancels nothing while the intent is parked", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const result = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, parked.version));
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "invalid-state");
    assert.ok(result.message.includes(intent.writeIntentId), "the refusal names the intent to answer");
    assert.match(result.message, /parked/);
    assert.match(result.message, /ref write-safety §4\.1/);

    // Nothing moved — not the run, not the intent, not the version.
    const after = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(after && after.lifecycle.state === "parked-write");
    assert.equal(after.version, parked.version);
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "parked");
  });

  it("refuses it for an ATTEMPTING intent too — the state with no section at all", async () => {
    const harness = roundTrip();
    let observed = false;
    harness.world.onCommitClick = () => {
      const attempting = parkedIntent(harness.database);
      assert.equal(attempting.status, "attempting");
      const run = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
      assert.ok(run);
      const result = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, run.version));
      assert.ok(result.state === "rejected");
      assert.equal(result.code, "invalid-state");
      assert.ok(result.message.includes(attempting.writeIntentId));
      assert.match(result.message, /attempting/);
      observed = true;
      throw new Error("browser crashed after cancel refusal");
    };
    await harness.park(false);
    assert.equal(observed, true);
    assert.equal(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("lifts the moment the write is answered ABSENT", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    assert.equal(
      harness.kernel.execute(resolutionCommand("resolve-write-absent", {
        runId: WRITE_FIXTURE_RUN_ID,
        expectedVersion: parked.version,
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
      }, { evidenceNote: "checked UCPath: no transaction exists for this key" })).state,
      "applied",
    );
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed);

    const cancelled = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, resumed.version));
    assert.equal(cancelled.state, "applied");
    const settled = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(settled && settled.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    // The retryable intent is untouched by the cancel, exactly as §4.1 says.
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "retryable");
  });

  it("lifts the moment the write is answered PRESENT", async () => {
    const harness = roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    assert.equal(
      harness.kernel.execute(resolutionCommand("resolve-write-present", {
        runId: WRITE_FIXTURE_RUN_ID,
        expectedVersion: parked.version,
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
      }, {
        proof: {
          schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
          value: { transactionId: "T998877" },
        },
        evidenceNote: "receipt T998877 is visible in UCPath",
      })).state,
      "applied",
    );
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed);

    const cancelled = harness.kernel.execute(cancelCommand(WRITE_FIXTURE_RUN_ID, resumed.version));
    assert.equal(cancelled.state, "applied");
    assert.equal(harness.database.authority.writeIntents.get(intent.writeIntentId)?.status, "committed");
  });
});


describe("kernel outer resolution rollback", () => {
afterEach(cleanup);

  it("unwinds product/lifecycle journals and all write evidence after inner lifecycle settlement", async () => {
    const h = roundTrip(writeFixtureDescriptor, { afterSequencedStep: (step) => {
      if (step === "run-transition") throw new Error("kernel outer resolution rollback");
    } });
    await h.park();
    const intent = parkedIntent(h.database);
    const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run);
    const command = resolutionCommand("resolve-write-present", { runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: run.version, writeIntentId: intent.writeIntentId, intentGeneration: intent.generation },
      { proof: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: { transactionId: "T998877" } },
        evidenceNote: "synthetic confirmed receipt" });
    const generation = h.database.getMeta().authorityGeneration;
    assert.throws(() => h.kernel.execute(command), /kernel outer resolution rollback/);
    assert.deepEqual(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID), run);
    assert.deepEqual(h.database.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, run.envelope.itemId, WRITE_FIXTURE_NODE_ID), undefined);
    assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
});
}

{
const MOVED_CLOSURE = "9".repeat(64);

const descriptor = separationsKualiFinalizationDescriptor;


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
afterEach(() => {
  for (const database of databases.splice(0)) closePersonLookupReceiptDatabase(database);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

  it("stamps the closure the RUN executed under, never the build's", () => {
    const receipt = receiptFrom({ run: runUnderMovedClosure() });
    assert.equal(receipt.descriptorFingerprint, MOVED_CLOSURE);
    assert.notEqual(
      receipt.descriptorFingerprint,
      descriptor.contractFingerprint,
      "the receipt took the current build's closure, which is exactly the stranding defect",
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
afterEach(() => {
  for (const database of databases.splice(0)) closePersonLookupReceiptDatabase(database);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
afterEach(() => {
  for (const database of databases.splice(0)) closePersonLookupReceiptDatabase(database);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


  it("keeps divergent receipt sentences out of the service and HTTP divergence error", () => {
    const database = openPersonLookupReceiptDatabase(roots, databases, "hrauto-receipt-binding-http-", "receipt-binding-http-test");
    const seeded = seedPersonLookupExitRun(database);
    const runId = String(seeded.run.envelope.runId);
    const authority = database.authority;
    const result = authority.runResults.get(runId);
    assert.ok(result);
    const currentReceipt = buildRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: seeded.run,
      result,
      checkpoints: seeded.checkpoints,
      writes: [],
      gateResults: authority.gateResults.listByRun(runId),
    });
    const rawPermanentKey = "ucpath:termination|10812345|2026-08-29";
    const divergent = storedVariant(currentReceipt, (draft) => {
      const decisions = draft.decisions as Record<string, unknown>[];
      const first = decisions[0];
      assert.ok(first !== undefined, "the current fixture must carry a decision sentence");
      decisions[0] = { ...first, reason: `divergent permanent key ${rawPermanentKey}` };
    });
    authority.evidenceReceipts.insert(divergent);

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
});
}
