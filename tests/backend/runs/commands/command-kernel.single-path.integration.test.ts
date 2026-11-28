import { createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { failedSourceReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { RunRecordService, lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { recordHistoricalRecover } from "../../../support/helpers/backend/record-historical-recover.js";
import { admitFixtureSlot } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";
import { seedSyntheticRuntimeConfig,singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";

import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createCommandKernel, type CommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-repositories.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { COMMAND_FAMILY_REGISTRY,CommandRequestSchema,CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { COMMAND_FIXTURES,HASH_B,NOW,UUID_2,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { boundProfileCredentials,createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const ASSISTANT_PREFERENCE_PROFILE = "11111111-1111-4111-8111-111111111111";

const CURRENT_COMMAND_FIXTURES: readonly unknown[] = Object.freeze([
  ...COMMAND_FIXTURES,
  { commandId: "67676767-6767-4676-8676-676767676767", requestedAt: NOW, requestedBy: "local-operator", source: "run-detail",
    family: "run", type: "resolve-workbook-row", target: { runId: UUID_2, expectedVersion: 1, libraryId: "workbook-fixture",
      operationId: "operation-fixture", receiptDigest: HASH_B, workbookVersion: 1 }, payload: { sheetId: "sheet-1", rowId: "row-1" } },
  ...["remove-worker", "retry-worker"].map((type, index) => ({
    commandId: index === 0 ? "10101010-1010-4010-8010-101010101010" : "20202020-2020-4020-8020-202020202020",
    requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type,
    target: { workflowId: "fixture-graph", workerId: "fixture-graph-worker-1", lifetimeId: null, expectedVersion: 0 },
  })),
  {
    commandId: "35353535-3535-4353-8353-353535353535",
    requestedAt: NOW, requestedBy: "local-operator", source: "run-detail", family: "worker-browser", type: "check-parked-write",
    target: {
      workerId: "fixture-graph-worker-9", lifetimeId: "49494949-4949-4494-8494-494949494949", expectedVersion: 1,
      installationId: "33333333-3333-4333-8333-333333333333", profileId: ASSISTANT_PREFERENCE_PROFILE,
      workflowId: "fixture-graph", itemId: "46464646-4646-4464-8464-464646464646",
      runId: "45454545-4545-4454-8454-454545454545", runVersion: 1, runAttempt: 1, traceId: "ab-120000-0001", nodeId: "parked-check",
      writeIntentId: "47474747-4747-4474-8474-474747474747", intentVersion: 1, intentGeneration: 1,
      writeAttemptId: "48484848-4848-4484-8484-484848484848", bindingProofDigest: HASH_B, occurrenceKeyDigest: HASH_B,
    },
  },
  {
    commandId: "12121212-1212-4121-8121-121212121212", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", family: "assistant-model-preference", type: "set-assistant-model-preference",
    target: { profileId: ASSISTANT_PREFERENCE_PROFILE, epoch: 0, expectedRevision: 1 }, payload: { slug: "gpt-6.1-sol", effort: "light" },
  },
  {
    commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard",
    family: "failure-resolution", type: "annotate-failure",
    target: { runId: UUID_2, failureId: UUID_4, expectedVersion: 1 }, payload: { action: "resolve" },
  },
  {
    commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard",
    family: "workflow-batch", type: "set-batch-grouping",
    target: { batchId: UUID_2, expectedVersion: 1 }, payload: { groupInQueue: false },
  },
  {
    commandId: UUID_2,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: 1 },
    payload: {
      protectedSchemaHash: HASH_B,
      writeId: UUID_4,
      entries: { ucpathPassword: { clear: true } },
    },
  },
]);

/* ── harness ─────────────────────────────────────────────────────────────── */

const profileFixtures: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(async () => {
  const failures: unknown[] = [];
  for (const database of openDatabases.splice(0)) { try { database.close(); } catch (error) { failures.push(error); } }
  for (const fixture of profileFixtures.splice(0)) { try { await fixture.close(); } catch (error) { failures.push(error); } }
  if (failures.length) throw new AggregateError(failures, "command guard fixture cleanup failed");
});

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;

interface GuardHarness {
  readonly path: string;
  readonly processLockRoot: string;
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
}

async function createHarness(wrap?: RepositoryWrap): Promise<GuardHarness> {
  const fixture = await createBoundProfileFixture();
  profileFixtures.push(fixture);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(fixture.admission,
    { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "command-guard" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(fixture.admission));

  seedSyntheticRuntimeConfig(database);
  openDatabases.push(database);
  const seamFailure = (seam: string) => () => {
    throw new Error(`${seam} process seam was reached before authority validation`);
  };
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: database.authority.runtimeConfig.get()!,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    workbookRows: createRunWorkbookService({ database, clock }),
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(wrap === undefined ? repositories : wrap(repositories)),
      ),
    },
    clock,
    ids: sequentialIdFactory("a"),
    authorityProfileId: ASSISTANT_PREFERENCE_PROFILE,
    authorityInstallationId: "33333333-3333-4333-8333-333333333333",
    workflowSources: { "fixture-graph": "served" },
    applicationQuitAvailable: true,
    prepareAssistantModelPreference: async () => () => true,
    descriptors: {
      resolve: (workflowId) => workflowId === "fixture-graph" ? fixtureDescriptor : undefined,
    },
    writeResolution: {
      recheck: seamFailure("recheck-write"),
      resolveAbsent: seamFailure("resolve-write-absent"),
    },
    workerRuntime: { pool: unusedWorkerPool(seamFailure("worker-pool")) },
    settings: {
      validateRequest: (command) => command.type === "apply-settings" && command.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH
        ? { state: "rejected", code: "schema-mismatch", message: "guard fixture uses a noncurrent settings schema" } : undefined,
      commitPrivate: (command) => command.type === "apply-protected-settings"
        ? { state: "conflict", currentRevision: PositiveIntSchema.parse(1), message: "guard fixture has no mutable private target" } : undefined,
      reconcileReplay: () => {
        throw new Error("guard fixture has no persisted settings replay target");
      },
      applyOrdinary: () => ({
        state: "conflict",
        currentRevision: 1,
        message: "guard fixture has no mutable settings target",
      }),
    },
  });
  return { path: fixture.path, processLockRoot: join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot), database, kernel, clock, plannerIds: sequentialIdFactory("f") };
}

let guardCommandSequence = 0;

function nextCommandId(): string {
  guardCommandSequence += 1;
  const tail = String(guardCommandSequence).padStart(4, "0");
  return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
}

function createFixturePlan(harness: GuardHarness) {
  const plan = planStart(
    { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
    {
      descriptor: fixtureDescriptor,
      submissions: [{ eid: "10800000", mode: "read-only" }],
      dryRun: false,
      priority: "bulk",
      shape: "single",
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
      configSnapshotId: harness.database.authority.runtimeConfig.get()!.configSnapshotId,
      plannedBy: "local-operator",
    },
  );
  assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
  return plan;
}

function startCommandFor(plan: ReturnType<typeof createFixturePlan>) {
  return {
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "start",
    type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version },
    payload: {
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
    },
  };
}

describe("control-command-single-path", () => {

  it("dispatches every command family/action: every arm executes", async () => {
    const harness = await createHarness();
    const seen: string[] = [];
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      // Refusals are journaled, so each arm needs its own command id.
      const parsed = { ...CommandRequestSchema.parse(fixture), commandId: nextCommandId() };
      if (parsed.type === "recover-run") continue;
      const request = parsed.family === "worker-browser" && "workflowId" in parsed.target
        ? { ...parsed, target: { ...parsed.target, workflowId: "fixture-graph" } } : parsed;
      const key = `${request.family}/${request.type}`;
      seen.push(key);
      const result = CommandResultSchema.parse(request.family === "worker-browser"
        ? await harness.kernel.executeWorkerPool(structuredClone(request))
        : request.family === "assistant-model-preference"
          ? await harness.kernel.executeAssistantModelPreference(structuredClone(request))
          : harness.kernel.execute(structuredClone(request)));
      // Arms execute: against an empty store they refuse on exact authority lookups with a typed code.
      assert.notEqual(result.state, "applied", key);
      if (result.state === "rejected") {
        assert.notEqual(result.code, "capability-unavailable", `${key} must execute`);
      }
    }
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.filter(action => action !== "recover-run").map((action) => `${family}/${action}`));
    assert.deepEqual([...new Set(seen)].sort(), [...registry].sort(), "the fixture corpus must cover every current family/action");
  });


  it("refuses new Recover commands and reads historical Recover authority", async () => {
    const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, [2]));
    try {
      const source = h.start(h.proposal());
      assert.equal((await h.execute(source)).state, "failed");
      const failed = h.fresh(source);
      const originalCheckpoints = h.database.authority.runCheckpoints.listByItem(failed.envelope.workflow, failed.envelope.itemId);
      assert.equal(originalCheckpoints.length, 1);
      const request = CommandRequestSchema.parse({ commandId: nextCommandId(), requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator", source: "dashboard", family: "run", type: "recover-run",
        target: { runId: failed.envelope.runId, expectedVersion: failed.version } });
      const generation = h.database.getMeta().authorityGeneration;
      assert.throws(() => h.kernel.execute(request), /Open Rerun/u);
      assert.equal(h.database.getMeta().authorityGeneration, generation);
      assert.equal(h.database.authority.commands.get(request.commandId), undefined);
      const result = recordHistoricalRecover(h, h.descriptor, request);
      assert.equal(h.database.getMeta().authorityGeneration, generation + 2);
      assert.ok(result.state === "applied");
      assert.equal(result.affectedTargets.length, 2);
      const target = result.affectedTargets[0]; assert.ok(target?.family === "run");
      assert.deepEqual(result.affectedTargets[1], { family: "run", runId: failed.envelope.runId });
      const recovered = h.database.authority.runs.get(target.runId); assert.ok(recovered);
      assert.ok(recovered.envelope.continuation); assert.equal(recovered.envelope.retryOf, failed.envelope.runId);
      const native = h.database.authority.lifecycleJournal.getCommand(lifecycleCommandId("operator-recover-run", request.commandId));
      assert.ok(native && "kind" in native && native.kind === "run-lifecycle"); assert.equal(native.operation, "recover");
      assert.deepEqual(h.database.authority.commands.get(request.commandId), request);
      const audit = h.database.authority.commandAudits.findByCommand(request.commandId); assert.ok(audit);
      assert.deepEqual(audit.request, request); assert.equal(audit.result.state, "applied");
      assert.throws(() => h.kernel.execute(request), /Open Rerun/u);
      assert.equal((await h.execute(recovered)).state, "done");
      assert.deepEqual(h.fresh(failed), failed);
      assert.deepEqual(h.database.authority.runCheckpoints.listByItem(failed.envelope.workflow, failed.envelope.itemId)
        .filter(checkpoint => checkpoint.runId === failed.envelope.runId), originalCheckpoints);
    } finally { await h.dispose(); }
  });

  it("CASes every run verb against the caller's version — presentation included", async () => {
    const harness = await createHarness();
    assert.equal(harness.database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
      configSnapshotId: harness.database.authority.runtimeConfig.get()!.configSnapshotId } }).state, "inserted");
    const base = {
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
    };
    const live = harness.database.authority.runs.get(UUID_2)?.version ?? 0;
    assert.ok(live > 0);

    const staleRename = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "rename",
      target: { runId: UUID_2, expectedVersion: 999 },
      payload: { displayName: "Renamed despite drift" },
    });
    assert.equal(staleRename.state, "conflict", "a stale rename may not overwrite a current name");
    assert.equal(harness.database.authority.runs.get(UUID_2)?.displayName, undefined);

    const staleBump = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "bump",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(staleBump.state, "conflict", "bump CASes the caller's value");
    assert.equal(
      harness.database.authority.runs.get(UUID_2)?.envelope.priority,
      QUEUED_RUN.envelope.priority,
      "a refused bump reorders nothing",
    );

    const cancelled = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "cancel",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(cancelled.state, "conflict", "cancel-tree is CAS-enforced");

    // At the LIVE version both land, and rename is still presentation-only:
    // the run row exists, its lifecycle is untouched.
    const renamed = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "rename",
      target: { runId: UUID_2, expectedVersion: live },
      payload: { displayName: "Renamed at the live version" },
    });
    assert.equal(renamed.state, "applied");
    const bumped = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "bump",
      target: { runId: UUID_2, expectedVersion: harness.database.authority.runs.get(UUID_2)?.version ?? 0 },
    });
    assert.equal(bumped.state, "applied");

    const afterRename = harness.database.authority.runs.get(UUID_2);
    assert.ok(afterRename !== undefined, "presentation may never delete the run row");
    assert.equal(afterRename.lifecycle.state, "queued");
    assert.equal(afterRename.displayName, "Renamed at the live version");
    assert.equal(afterRename.envelope.priority, "interactive");
  });

  it("enqueue policy is transactional: an injected active-run lookup error creates zero runs", async () => {
    let shouldFail = false;
    const harness = await createHarness((repositories) => ({
      ...repositories,
      runs: {
        ...repositories.runs,
        listByItem: (input: unknown) => {
          if (shouldFail) throw new Error("injected active-run lookup failure");
          return repositories.runs.listByItem(input);
        },
      },
    }));
    const plan = createFixturePlan(harness);
    const command = startCommandFor(plan);
    shouldFail = true;
    const generationBefore = harness.database.getMeta().authorityGeneration;
    assert.throws(() => harness.kernel.execute(command), /injected active-run lookup failure/);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId)?.commandId, command.commandId);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore + 1);
  });

  it("commands are idempotent: byte-exact replay returns already-applied; a different body on the same id fails loud", async () => {
    const harness = await createHarness();
    const plan = createFixturePlan(harness);
    const command = startCommandFor(plan);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    assert.throws(
      () => harness.kernel.execute({ ...command, reason: "different content, same id" }),
      /reused with different content/,
    );
  });

  it("typed gate results parse the descriptor's exact schema and store a checkpointed result", async () => {
    const harness = await createHarness();
    const plan = createFixturePlan(harness);
    const runId = singleAppliedRunId(harness.kernel.execute(startCommandFor(plan)));
    const slot = harness.database.withAuthorityTransaction(repositories => {
      return admitFixtureSlot(repositories, "fixture-graph", 1, NOW);
    });
    const claimed = harness.database.authority.runs.claimNext({
      workflow: "fixture-graph", workerId: slot.workerId, now: NOW,
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    const claim = { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration };
    const live = { workerId: slot.workerId, claimedAt: NOW, heartbeatAt: NOW };
    let version: number = claimed.run.version;
    for (const state of ["validating", "running"] as const) {
      assert.equal(harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim, lifecycle: { state, ...live }, now: NOW,
      }).state, "applied");
      version += 1;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "fan" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") return;

    const gateBase = {
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "gate",
      type: "resolve-gate",
    };
    const generationBefore = harness.database.getMeta().authorityGeneration;
    const wrong = harness.kernel.execute({
      ...gateBase, commandId: nextCommandId(),
      target: { runId, gateId: "approval", expectedVersion: parked.run.version },
      payload: { result: { schemaHash: "9".repeat(64), value: { approved: true } } },
    });
    assert.equal(wrong.state, "rejected");
    if (wrong.state === "rejected") assert.equal(wrong.code, "schema-mismatch");
    assert.equal(harness.database.authority.gateResults.get(`${runId}:approval`), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(wrong.commandId)?.result.state, "rejected");
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore + 2);
  });
});
