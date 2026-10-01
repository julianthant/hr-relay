import { RuntimeAdmission } from "../../src/infra/runtime-control/admission.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { generatedUpdateId, pendingGeneratedUpdateIds } from "../../src/core/generated-artifact-projection.js";
import { createContentAddressedArtifactWriter } from "../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { testRunLifecycle } from "../fixtures/run-lifecycle-fixtures.js";
/**
 * Ref data-intake-and-edit-data §4.1 / ref dashboard-surfaces §2.1 (D45, D164): the stable-keyed local artifact
 * projector, in three layers.
 *
 * 1. Derivation is PURE — the same checkpoint output always derives the same
 *    stable key. Replay separately binds each update to its exact checkpoint.
 * 2. The projector + xlsx sink over a REAL authority database and real files:
 *    fresh create, verified no-op, in-place update, operator-edit conflict
 *    (both files preserved, row stays pending), head/file mismatch arms, and
 *    the exclusive sink lock.
 * 3. The executor: checkpoint + outbox rows commit atomically, the node
 *    blocks on acknowledgement, a projection failure fails the run WITHOUT
 *    losing the durable rows, and a second run of the same item resumes the
 *    projection from the replayed checkpoint.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import readXlsxFile from "read-excel-file/node";
import { flow } from "../../src/base/flow.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../src/base/store.js";
import { defineTask } from "../../src/base/task.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import {
  executeClaimedRun,
  type RunExecutorDependencies,
} from "../../src/backend/runtime/run-executor.js";
import { deriveArtifactProjectionRows } from "../../src/domain/workflow/artifact-projection.js";
import { defineTaskContract } from "../../src/domain/contracts/base.js";
import { ScenarioIdSchema, TraceIdSchema, taskId } from "../../src/domain/ids.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import {
  ArtifactSinkBusyError,
  createArtifactSinkProjector,
} from "../../src/infra/artifacts/artifact-sink-projector.js";
import {
  ArtifactSinkConflictError,
  createXlsxRetentionSink,
} from "../../src/infra/artifacts/xlsx-retention-sink.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { HASH_A } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID, sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  happySessionHarness,
  ManualScheduler,
  openAuthorityHarness,
  recordingEmitter,
  recordingLogger,
  sessionManagerFor,
} from "../helpers/phase1f-executor-harness.js";

const artifactReadiness: Promise<void>[] = [];
const disposers: (() => void)[] = [];
afterEach(async () => {
  await Promise.all(artifactReadiness.splice(0));
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;
const SCENARIO = ScenarioIdSchema.parse("ocr/capability-wiring-happy");

const PROJECTION_SPECS = [{
  id: "retention-row",
  source: { nodeId: "extract", fieldPath: "disposition" },
  keyFields: ["subject"],
  sink: "xlsx-retention",
  blocking: true,
}] as const;

const OUTPUT_VALUE = { subject: "10456712", eid: "10456712", disposition: "retain" };

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/* ── 1. derivation ───────────────────────────────────────────────────────── */

describe("deriveArtifactProjectionRows", () => {
  it("derives one stable-keyed row, identically on every derivation", () => {
    const first = deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "extract", outputValue: OUTPUT_VALUE });
    const second = deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "extract", outputValue: OUTPUT_VALUE });
    assert.equal(first.length, 1);
    assert.deepEqual(first, second);
    assert.equal(first[0]?.value, "retain");
    assert.deepEqual(first[0]?.keyValues, [{ field: "subject", value: "10456712" }]);
  });

  it("skips specs sourced from other nodes", () => {
    assert.deepEqual(
      deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "other", outputValue: OUTPUT_VALUE }),
      [],
    );
  });

  it("throws by name when the projected field is absent", () => {
    assert.throws(
      () => deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "extract", outputValue: { subject: "x" } }),
      /found no value at disposition/u,
    );
  });

  it("throws by name when a declared key value is missing", () => {
    assert.throws(
      () => deriveArtifactProjectionRows({
        specs: PROJECTION_SPECS,
        nodeId: "extract",
        outputValue: { disposition: "retain" },
      }),
      /missing its declared key value at subject/u,
    );
  });
});

/* ── 2. projector + sink ─────────────────────────────────────────────────── */

function outboxRow(database: AuthorityDatabase, input: Readonly<{
  outboxId: string;
  stableSuffix: string;
  record: string;
}>): string {
  database.authority.artifactOutbox.insert({
    outboxId: input.outboxId,
    artifactId: "99999999-9999-4999-8999-999999999999",
    projectionId: "retention-row",
    stableKeyFingerprint: input.stableSuffix.repeat(64).slice(0, 64),
    keyValues: [{ field: "subject", value: "10456712" }],
    sinkId: "xlsx-retention",
    sourceRunId: RUN_ID,
    sourceNodeId: "extract",
    state: "pending",
    payload: { schemaHash: HASH_A, value: input.record },
    createdAt: "2026-08-08T12:00:00.000Z",
  });
  return input.outboxId;
}

function projectorFor(database: AuthorityDatabase, root: string, clock: Readonly<{ now: () => Date }>) {
  const artifacts = createContentAddressedArtifactWriter({admission: RuntimeAdmission.syntheticRoots(join(root, ".tracker"), join(root, ".tracker/artifacts"))});
  artifactReadiness.push(artifacts.ready);
  return createArtifactSinkProjector({
    authority: database.authority,
    withAuthorityTransaction: (work) => database.withAuthorityTransaction(work),
    sinks: { "xlsx-retention": createXlsxRetentionSink({ workbookPath: join(root, "retention.xlsx"), artifacts }) },
    lockDir: join(root, "locks"),
    clock: clock as never,
  });
}

async function workbookRows(root: string): Promise<string[][]> {
  const workbook = await readXlsxFile(readFileSync(join(root, "retention.xlsx")));
  const sheet = workbook[0];
  assert.ok(sheet !== undefined);
  return sheet.data.map((row) => row.map((cell) => String(cell)));
}

describe("artifact sink projector over the xlsx-retention sink", () => {
  it("creates the workbook, records the head at generation 1, and acknowledges the row", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;
    const root = tempRoot("hrauto-artifact-sink-");
    const projector = projectorFor(database, root, authority.clock);
    const id = outboxRow(database, { outboxId: "aaaaaaaa-0001-4000-8000-000000000001", stableSuffix: "a", record: "retain" });

    const first = await projector.projectOutbox([id]);
    assert.equal(first.projected, 1);
    const head = database.authority.artifactSinkHeads.get("xlsx-retention");
    assert.ok(head !== undefined);
    assert.equal(head.generation, 1);
    assert.equal(database.authority.artifactOutbox.get(id)?.state, "projected");
    const rows = await workbookRows(root);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.[2], "\"retain\"");

    // Re-projecting an acknowledged row is a no-op, not a second write.
    const second = await projector.projectOutbox([id]);
    assert.equal(second.projected, 0);
    assert.equal(database.authority.artifactSinkHeads.get("xlsx-retention")?.generation, 1);
  });

  it("treats a duplicate stable key with identical content as a verified no-op and still acknowledges", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;
    const root = tempRoot("hrauto-artifact-sink-");
    const projector = projectorFor(database, root, authority.clock);
    const first = outboxRow(database, { outboxId: "aaaaaaaa-0001-4000-8000-000000000001", stableSuffix: "a", record: "retain" });
    const duplicate = outboxRow(database, { outboxId: "aaaaaaaa-0002-4000-8000-000000000002", stableSuffix: "a", record: "retain" });

    await projector.projectOutbox([first]);
    const headAfterFirst = database.authority.artifactSinkHeads.get("xlsx-retention");
    await projector.projectOutbox([duplicate]);

    assert.equal(database.authority.artifactOutbox.get(duplicate)?.state, "projected");
    const rows = await workbookRows(root);
    assert.equal(rows.length, 2, "one logical row, never a second append");
    assert.equal(
      database.authority.artifactSinkHeads.get("xlsx-retention")?.contentSha256,
      headAfterFirst?.contentSha256,
      "a verified no-op leaves the recorded bytes untouched",
    );
  });

  it("updates a changed record in place under the same stable key", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;
    const root = tempRoot("hrauto-artifact-sink-");
    const projector = projectorFor(database, root, authority.clock);
    await projector.projectOutbox([
      outboxRow(database, { outboxId: "aaaaaaaa-0001-4000-8000-000000000001", stableSuffix: "a", record: "retain" }),
    ]);
    await projector.projectOutbox([
      outboxRow(database, { outboxId: "aaaaaaaa-0002-4000-8000-000000000002", stableSuffix: "a", record: "shred" }),
    ]);

    const rows = await workbookRows(root);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.[2], "\"shred\"");
    assert.equal(database.authority.artifactSinkHeads.get("xlsx-retention")?.generation, 2);
  });

  it("parks on an operator edit: both files preserved, row stays pending, head untouched", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;
    const root = tempRoot("hrauto-artifact-sink-");
    const projector = projectorFor(database, root, authority.clock);
    await projector.projectOutbox([
      outboxRow(database, { outboxId: "aaaaaaaa-0001-4000-8000-000000000001", stableSuffix: "a", record: "retain" }),
    ]);
    writeFileSync(join(root, "retention.xlsx"), "operator edited these bytes");
    const headBefore = database.authority.artifactSinkHeads.get("xlsx-retention");

    const conflicting = outboxRow(database, { outboxId: "aaaaaaaa-0002-4000-8000-000000000002", stableSuffix: "b", record: "shred" });
    await assert.rejects(projector.projectOutbox([conflicting]), (error: unknown) => {
      assert.ok(error instanceof ArtifactSinkConflictError);
      assert.ok(error.preservedPendingPath !== undefined);
      assert.ok(existsSync(error.preservedPendingPath));
      return true;
    });

    assert.equal(database.authority.artifactOutbox.get(conflicting)?.state, "pending");
    assert.deepEqual(database.authority.artifactSinkHeads.get("xlsx-retention"), headBefore);
    assert.equal(readFileSync(join(root, "retention.xlsx"), "utf8"), "operator edited these bytes");
  });

  it("refuses a workbook with no recorded head, and a recorded head with no workbook", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;
    const root = tempRoot("hrauto-artifact-sink-");
    const projector = projectorFor(database, root, authority.clock);
    writeFileSync(join(root, "retention.xlsx"), "somebody else's workbook");
    const row = outboxRow(database, { outboxId: "aaaaaaaa-0001-4000-8000-000000000001", stableSuffix: "a", record: "retain" });
    await assert.rejects(projector.projectOutbox([row]), /no recorded head/u);

    rmSync(join(root, "retention.xlsx"));
    await projector.projectOutbox([row]);
    rmSync(join(root, "retention.xlsx"));
    const orphaned = outboxRow(database, { outboxId: "aaaaaaaa-0002-4000-8000-000000000002", stableSuffix: "b", record: "shred" });
    await assert.rejects(projector.projectOutbox([orphaned]), /no workbook exists/u);
  });

  it("refuses to project concurrently past the exclusive sink lock", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;
    const root = tempRoot("hrauto-artifact-sink-");
    const projector = projectorFor(database, root, authority.clock);
    mkdirAndLock(root, ".retention.xlsx.writer.lock");
    const row = outboxRow(database, { outboxId: "aaaaaaaa-0001-4000-8000-000000000001", stableSuffix: "a", record: "retain" });
    await assert.rejects(projector.projectOutbox([row]), (error: unknown) => error instanceof ArtifactSinkBusyError);
    assert.equal(database.authority.artifactOutbox.get(row)?.state, "pending");
  });
});

function mkdirAndLock(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "held");
}

/* ── 3. the executor ─────────────────────────────────────────────────────── */

const FixtureInput = z.strictObject({ name: z.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ name: z.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);
const ProjectionOutput = z.strictObject({
  subject: z.string().min(1),
  eid: z.string().min(1),
  disposition: z.string().min(1),
});

const projectionContract = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Projection fixture",
  effect: "read",
  input: FixtureInput,
  output: ProjectionOutput,
  errorCodes: ["provider-unavailable"] as const,
  subject: { kind: "none", reason: "executor projection fixture" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  example: { subject: "10456712", eid: "10456712", disposition: "retain" },
});

const projectionTask = defineTask(projectionContract, {
  sessions: [],
  async run({ ctx }) {
    ctx.recordData([
      { direction: "read", field: "subject", value: OUTPUT_VALUE.subject },
      { direction: "read", field: "eid", value: OUTPUT_VALUE.eid },
      { direction: "read", field: "disposition", value: OUTPUT_VALUE.disposition },
    ]);
    return { ...OUTPUT_VALUE };
  },
});

function projectionDescriptor(): AnyWorkflowDescriptor {
  const fixtureFlow = flow(FixtureInput)
    .step("extract", projectionContract, {
      dependsOn: [],
      replay: "checkpoint",
      bind: ({ input }) => ({ name: input.name }),
    })
    .build({
      schema: z.strictObject({ done: z.boolean() }),
      dependsOn: ["extract"],
      derive: () => ({ done: true }),
    });
  return defineWorkflowDescriptor({
    id: "wiring-projection",
    version: 1,
    contractFingerprint: HASH_A,
    code: "wj",
    label: "Projection fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "name",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof FixtureInput>) => `name:${input.name}` },
    presentation: { title: (input: z.output<typeof FixtureInput>) => input.name },
    scenarios: ["wiring-projection/happy"],
    artifactProjections: [...PROJECTION_SPECS],
    flow: fixtureFlow,
  });
}

/**
 * D221 — a second run of the SAME logical item takes the item's next attempt;
 * authority refuses one that reuses an attempt the item already spent.
 */
function queuedRunFor(descriptor: AnyWorkflowDescriptor, runId?: string, attempt = 1) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      ...(runId === undefined ? {} : { runId }),
      attempt,
      workflow: descriptor.id,
      traceId: TraceIdSchema.parse(`${descriptor.code}-170000-2222`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
    },
    input: {
      raw: { name: "Battistessa, Johnnie" },
      parsed: {
        schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"),
        value: { name: "Battistessa, Johnnie" },
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

function claim(database: AuthorityDatabase, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const claimed = database.authority.runs.claimNext({
    workflow: descriptor.id,
    workerId: WORKER_ID,
    now: new Date("2026-08-03T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration } };
}

function executorHarness(descriptor: AnyWorkflowDescriptor, root: string | undefined) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const sessions = happySessionHarness();
  const emitter = recordingEmitter();
  const store = defineServiceStore("ocr", { fixture: projectionTask });
  const stores = defineTaskStoreRegistry([store], {
    scenarioIds: [SCENARIO],
    tasks: [{ id: projectionContract.id, effect: projectionContract.effect }],
  });
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor,
    stores,
    authority: authority.database,
    sessions: sessionManagerFor(sessions, authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("f"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
    ...(root === undefined ? {} : {
      artifactProjector: projectorFor(authority.database, root, authority.clock),
    }),
  };
  return { authority, deps };
}

describe("executor projection wiring", () => {
  it("commits checkpoint + outbox atomically, blocks on ack, and replays without rewriting", async () => {
    const descriptor = projectionDescriptor();
    const root = tempRoot("hrauto-executor-projection-");
    const harness = executorHarness(descriptor, root);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(descriptor));
    const first = claim(database, descriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL });
    if (outcome.state !== "done") {
      const failedRun = database.authority.runs.get(RUN_ID);
      const failureId = failedRun?.lifecycle.state === "terminal" ? failedRun.lifecycle.failureId : undefined;
      const failure = failureId === undefined ? undefined : database.authority.failures.get(failureId);
      assert.fail(`run ended ${outcome.state}: ${failure?.summary ?? "no failure record"}`);
    }
    assert.equal(database.authority.artifactOutbox.listPending().length, 0);
    const head = database.authority.artifactSinkHeads.get("xlsx-retention");
    assert.ok(head !== undefined && head.generation === 1);
    assert.equal((await workbookRows(root)).length, 2);

    // A later producer owes the same workbook key. Replaying this checkpoint
    // must not acknowledge that other producer's update.
    const original = database.authority.generatedArtifacts.list()[0]?.updates[0]?.record;
    assert.ok(original !== undefined);
    const newerId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const { projectedAt: _projectedAt, ...pending } = original;
    database.authority.artifactOutbox.insert({ ...pending, outboxId: newerId,
      sourceRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", state: "pending" });

    // A second run of the same item replays the checkpoint; nothing is owed,
    // so the workbook and head stay EXACTLY as they were.
    database.authority.runs.enqueue(queuedRunFor(descriptor, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", 2));
    const second = claim(database, descriptor);
    const replayed = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    assert.equal(replayed.state, "done");
    assert.equal(database.authority.artifactSinkHeads.get("xlsx-retention")?.generation, 1);
    assert.equal(database.authority.artifactOutbox.get(newerId)?.state, "pending");
  });

  it("fails the node loudly when no projector is composed", async () => {
    const descriptor = projectionDescriptor();
    const harness = executorHarness(descriptor, undefined);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(descriptor));
    const claimed = claim(database, descriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure !== undefined);
    assert.match(failure.summary, /wires no artifact sink projector/u);
    // Nothing durable was minted: no checkpoint, no outbox row.
    assert.equal(database.authority.artifactOutbox.listPending().length, 0);
  });

  it("fails the run on a blocking conflict, keeps the durable rows, and resumes on relaunch", async () => {
    const descriptor = projectionDescriptor();
    const root = tempRoot("hrauto-executor-projection-");
    const harness = executorHarness(descriptor, root);
    const { database } = harness.authority;
    // A foreign workbook this projector cannot vouch for: the sink conflicts.
    writeFileSync(join(root, "retention.xlsx"), "somebody else's workbook");
    database.authority.runs.enqueue(queuedRunFor(descriptor));
    const first = claim(database, descriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...first, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    // The checkpoint and its outbox row survived the failure — that is the
    // atomic-commit half of the contract.
    assert.equal(database.authority.artifactOutbox.listPending().length, 1);

    // The operator resolves the conflict; a relaunch replays the checkpoint
    // and the resume arm projects the pending row to done.
    rmSync(join(root, "retention.xlsx"));
    database.authority.runs.enqueue(queuedRunFor(descriptor, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", 2));
    const second = claim(database, descriptor);
    const resumed = await executeClaimedRun(harness.deps, { ...second, signal: SIGNAL });
    assert.equal(resumed.state, "done");
    assert.equal(database.authority.artifactOutbox.listPending().length, 0);
    assert.equal(database.authority.artifactSinkHeads.get("xlsx-retention")?.generation, 1);
    assert.equal((await workbookRows(root)).length, 2);
  });
});


describe("F exact checkpoint publication recovery", () => {
  for (const historical of [false, true]) {
    it(`isolates same-run claim generations (${historical ? "historical ambiguity refusal" : "bound updates"})`, async () => {
      const descriptor = projectionDescriptor();
      const root = tempRoot("hrauto-checkpoint-update-");
      const h = executorHarness(descriptor, root);
      const { database } = h.authority;
      writeFileSync(join(root, "retention.xlsx"), "foreign workbook");
      database.authority.runs.enqueue(queuedRunFor(descriptor));
      assert.equal((await executeClaimedRun(h.deps, { ...claim(database, descriptor), signal: SIGNAL })).state, "failed");
      const source = database.authority.artifactOutbox.listPending()[0];
      assert.ok(source !== undefined);
      const checkpoint = database.authority.runCheckpoints.latest(descriptor.id, QUEUED_RUN.envelope.itemId, "extract");
      assert.ok(checkpoint !== undefined);
      const row = deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "extract", outputValue: checkpoint.output.value })[0];
      assert.ok(row !== undefined);
      const legacyId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      if (historical) {
        database.authority.artifactOutbox.insert({ ...source, outboxId: legacyId });
        assert.deepEqual(pendingGeneratedUpdateIds(database.authority, checkpoint, PROJECTION_SPECS), [source.outboxId, legacyId]);
      }
      const newer = RunCheckpointRecordSchema.parse({ ...checkpoint, claimGeneration: 2 });
      database.authority.runCheckpoints.insert(newer);
      const newerId = generatedUpdateId(newer, row);
      database.authority.artifactOutbox.insert({ ...source, outboxId: newerId });
      const before = database.authority.artifactOutbox.listPending();
      if (historical) {
        assert.throws(() => pendingGeneratedUpdateIds(database.authority, checkpoint, PROJECTION_SPECS), /checkpoint-ambiguous/u);
      } else {
        assert.deepEqual(pendingGeneratedUpdateIds(database.authority, checkpoint, PROJECTION_SPECS), [source.outboxId]);
        assert.deepEqual(pendingGeneratedUpdateIds(database.authority, newer, PROJECTION_SPECS), [newerId]);
      }
      assert.deepEqual(database.authority.artifactOutbox.listPending(), before);
      if (!historical) {
        const orphan = RunCheckpointRecordSchema.parse({ ...checkpoint, claimGeneration: 3 });
        database.authority.artifactOutbox.insert({ ...source, outboxId: generatedUpdateId(orphan, row) });
        assert.throws(() => pendingGeneratedUpdateIds(database.authority, checkpoint, PROJECTION_SPECS), /checkpoint-unresolved/u);
      }
    });
  }
});


it("F executor replay holds writer exclusion while selecting checkpoint witnesses and pending updates", async () => {
 const descriptor = projectionDescriptor();
 const h = executorHarness(descriptor, tempRoot("hrauto-replay-selection-"));
 const { database, clock, path } = h.authority;
 const contender = AuthorityDatabase.open({ path, busyTimeoutMs: 1, migrationOwner: "contender" }, clock);
 disposers.push(() => contender.close());
 database.authority.runs.enqueue(queuedRunFor(descriptor));
 assert.equal((await executeClaimedRun(h.deps, { ...claim(database, descriptor), signal: SIGNAL })).state, "done");
 let observed = 0;
 const transaction = database.withAuthorityTransaction.bind(database);
 database.withAuthorityTransaction = work => transaction(repositories => work({ ...repositories,
  artifactOutbox: { ...repositories.artifactOutbox, listPending: () => {
   observed += 1;
   assert.throws(() => contender.withAuthorityTransaction(() => {}), /database is locked/u);
   return repositories.artifactOutbox.listPending();
  } },
 }));
 database.authority.runs.enqueue(queuedRunFor(descriptor, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", 2));
 assert.equal((await executeClaimedRun(h.deps, { ...claim(database, descriptor), signal: SIGNAL })).state, "done");
 assert.equal(observed, 1);
});
