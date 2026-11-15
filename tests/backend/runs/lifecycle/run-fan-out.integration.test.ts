import { requireLifecycleApplied, RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { seedSyntheticRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { fanOutQueuedRuns } from "../../../../src/backend/runs/lifecycle/run-fan-out.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import type { StepOmissions } from "../../../../src/models/workflow/step-omission.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema,StartPlanIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput,PersonLookupInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { NOW,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const profiles: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function openDatabase(profile?: Awaited<ReturnType<typeof createBoundProfileFixture>>): Promise<AuthorityDatabase> {
  profile ??= await createBoundProfileFixture();
  const database = AuthorityDatabase.open(
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  profiles.push(profile);
  seedSyntheticRuntimeConfig(database);
  databases.push(database);
  return database;
}

function plannedEntry(eid: string) {
  return {
    itemId: deriveItemId("person-lookup", `eid:${eid}`),
    title: `EID ${eid}`,
    matchKey: `eid:${eid}`,
    rawInput: { emplId: eid },
    parsedInput: {
      protectedBindings: [],
      schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
      value: { emplId: eid, keepNonHdh: false, includeCrmDates: false },
    },
  };
}

function baseEnvelope(database: AuthorityDatabase, sessionId: string, stepOmissions?: StepOmissions) {
  const active = database.authority.runtimeConfig.get();
  assert.ok(active);
  return {
    commandId: sessionId, actorId: "local-operator",
    workflow: personLookupDescriptor.id,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    resolvedInstance: { ucpath: "prod" as const, crm: "prod" as const },
    configFingerprint: active.configFingerprint,
    configSnapshotId: active.configSnapshotId,
    shape: "single" as const,
    priority: "bulk" as const,
    dryRun: false,
    ...(stepOmissions === undefined ? {} : { stepOmissions }),
    ingressSchemaHash: deriveSchemaHash(PersonLookupInput, "input"),
    appVersion: "0.1.0",
    session: {
      sessionId,
      origin: { kind: "start-plan" as const, startPlanId: StartPlanIdSchema.parse(UUID_4), actorId: ActorIdSchema.parse("local-operator") },
    },
  };
}

describe("fanOutQueuedRuns", () => {
  it("rolls back earlier replacements and the new session when a later supersede is refused", async () => {
    const profile = await createBoundProfileFixture();
    const database = await openDatabase(profile);
    const clock = manualClock(new Date(NOW));
    const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("a"), publishQueued: () => {} });
    const descriptor = { ...personLookupDescriptor, enqueue: "supersede-active" as const };
    const seed = (sessionId: string, eid: string) => database.withAuthorityTransaction(repositories => fanOutQueuedRuns(
      repositories, lifecycle, message => { throw new Error(message); }, descriptor,
      baseEnvelope(database, sessionId), [plannedEntry(eid)], NOW, "fixture fan-out",
    )).runs[0];
    const owned = seed("bbbbbbbb-0003-4000-8000-000300000000", "20202020");
    assert.ok(owned);
    const worker = testWorkerPorts(database, clock, { path: profile.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    const [slot] = database.authority.workerSlots.active(descriptor.id);
    assert.ok(slot);
    const claim = worker.claimNext({ commandId: "bbbbbbbb-0004-4000-8000-000400000000", workflow: descriptor.id, workerId: slot.workerId });
    assert.equal(claim.state, "applied");
    assert.ok("run" in claim);
    assert.equal(claim.run.envelope.runId, owned.envelope.runId);
    const replaceable = seed("bbbbbbbb-0005-4000-8000-000500000000", "10101010");
    assert.ok(replaceable);
    const before = database.authority.runs.listByWorkflow(descriptor.id);
    const generation = database.getMeta().authorityGeneration;
    const sessionId = "bbbbbbbb-0006-4000-8000-000600000000";

    try {
      assert.throws(() => database.withAuthorityTransaction(repositories => fanOutQueuedRuns(
        repositories, lifecycle, message => { throw new Error(message); }, descriptor,
        baseEnvelope(database, sessionId), [plannedEntry("10101010"), plannedEntry("20202020")], NOW, "fixture fan-out",
      )), new RegExp(`^Error: superseding run ${owned.envelope.runId} unexpectedly reported refused inside an exclusive authority transaction$`, "u"));

      assert.deepEqual(database.authority.runs.listByWorkflow(descriptor.id), before);
      assert.equal(database.authority.runSessions.get(sessionId), undefined);
      assert.equal(database.getMeta().authorityGeneration, generation);
    } finally {
      const owner = database.authority.runs.get(owned.envelope.runId);
      assert.ok(owner);
      const cancelling = requireLifecycleApplied(lifecycle.transition({ commandId: randomUUID(), runId: owned.envelope.runId,
        expectedVersion: owner.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
      requireLifecycleApplied(lifecycle.terminalize({ kind: "cancelled", commandId: randomUUID(), runId: owned.envelope.runId,
        expectedVersion: cancelling.version, claim: { workerId: slot.workerId, claimGeneration: claim.run.claimGeneration }, endedAt: NOW },
      personLookupDescriptor));
    }
  });

  it("refuses to adopt an existing session id and enqueues nothing for it", async () => {
    const database = await openDatabase();
    const lifecycle = new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} });
    const sessionId = "bbbbbbbb-0007-4000-8000-000700000000";
    const fanOut = (commandId: string, eid: string) => database.withAuthorityTransaction(repositories => fanOutQueuedRuns(
      repositories, lifecycle, message => { throw new Error(message); }, personLookupDescriptor,
      { ...baseEnvelope(database, sessionId), commandId }, [plannedEntry(eid)], NOW, "fixture fan-out",
    ));
    fanOut(sessionId, "10101010");
    const before = database.authority.runs.listByWorkflow(personLookupDescriptor.id);
    const session = database.authority.runSessions.get(sessionId);
    assert.ok(session);

    assert.throws(() => fanOut("bbbbbbbb-0008-4000-8000-000800000000", "20202020"),
      /^Error: fixture fan-out proposed session id bbbbbbbb-0007-4000-8000-000700000000, which already exists; refusing to adopt it$/u);

    assert.deepEqual(database.authority.runs.listByWorkflow(personLookupDescriptor.id), before);
    assert.deepEqual(database.authority.runSessions.get(sessionId), session);
  });

  it("refuses a later active item and leaves none of the fan-out enqueued", async () => {
    const database = await openDatabase();
    const lifecycle = new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} });
    const fanOut = (sessionId: string, eids: readonly string[]) => database.withAuthorityTransaction(repositories => fanOutQueuedRuns(
      repositories, lifecycle, message => { throw new Error(message); }, personLookupDescriptor,
      baseEnvelope(database, sessionId), eids.map(plannedEntry), NOW, "fixture fan-out",
    ));
    const [active] = fanOut("bbbbbbbb-0009-4000-8000-000900000000", ["20202020"]).runs;
    assert.ok(active);
    const before = database.authority.runs.listByWorkflow(personLookupDescriptor.id);
    const generation = database.getMeta().authorityGeneration;
    const sessionId = "bbbbbbbb-0010-4000-8000-001000000000";

    assert.throws(() => fanOut(sessionId, ["10101010", "20202020"]), new RegExp(
      `^Error: person-lookup item ${active.envelope.itemId} \\(eid:20202020\\) already has an active run `
      + `\\(${active.envelope.traceId}\\); nothing from fixture fan-out was started$`, "u"));

    assert.deepEqual(database.authority.runs.listByWorkflow(personLookupDescriptor.id), before);
    assert.equal(database.authority.runSessions.get(sessionId), undefined);
    assert.equal(database.getMeta().authorityGeneration, generation);
  });

  it("refuses a retired archive relaunch before opening a session", async () => {
    const database = await openDatabase();
    const lifecycle = new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} });
    const sessionId = "bbbbbbbb-0011-4000-8000-001100000000";
    const refusals: unknown[] = [];

    assert.throws(() => database.withAuthorityTransaction(repositories => fanOutQueuedRuns(
      repositories, lifecycle, (message, refusal) => { refusals.push(refusal); throw new Error(message); }, personLookupDescriptor,
      { ...baseEnvelope(database, sessionId), relaunch: { archivedRunId: UUID_4, archiveFingerprint: "f".repeat(64) } },
      [plannedEntry("10101010")], NOW, "fixture fan-out",
    )), /^Error: archive relaunch is retired$/u);

    assert.deepEqual(refusals, [{ reason: "invalid-state" }]);
    assert.deepEqual(database.authority.runs.listByWorkflow(personLookupDescriptor.id), []);
    assert.equal(database.authority.runSessions.get(sessionId), undefined);
  });

  it("fails loud without an active runtime config and opens no session", async () => {
    const envelope = baseEnvelope(await openDatabase(), "bbbbbbbb-0012-4000-8000-001200000000");
    const profile = await createBoundProfileFixture();
    profiles.push(profile);
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      manualClock(new Date(NOW)),
    );
    databases.push(database);
    assert.equal(database.authority.runtimeConfig.get(), undefined);
    const lifecycle = new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} });

    assert.throws(() => database.withAuthorityTransaction(repositories => fanOutQueuedRuns(
      repositories, lifecycle, message => { throw new Error(message); }, personLookupDescriptor,
      envelope, [plannedEntry("10101010")], NOW, "fixture fan-out",
    )), /^Error: fan-out has no active runtime config$/u);

    assert.deepEqual(database.authority.runs.listByWorkflow(personLookupDescriptor.id), []);
    assert.equal(database.authority.runSessions.get(envelope.session.sessionId), undefined);
  });

  it("carries stepOmissions onto every fanned-out run's envelope byte for byte", async () => {
    const database = await openDatabase();
    const stepOmissions = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/19/2026" } }];
    database.withAuthorityTransaction((repositories) => fanOutQueuedRuns(
      repositories,
      new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} }),
      (message) => { throw new Error(message); },
      personLookupDescriptor,
      baseEnvelope(database, "bbbbbbbb-0001-4000-8000-000100000000", stepOmissions),
      [plannedEntry("10873698")],
      NOW,
      "fixture fan-out",
    ));
    const run = database.authority.runs.listByWorkflow("person-lookup")[0];
    assert.ok(run !== undefined);
    assert.deepEqual(run.envelope.stepOmissions, stepOmissions);
  });

  it("omits stepOmissions entirely from the envelope when the fan-out carries none", async () => {
    const database = await openDatabase();
    database.withAuthorityTransaction((repositories) => fanOutQueuedRuns(
      repositories,
      new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} }),
      (message) => { throw new Error(message); },
      personLookupDescriptor,
      baseEnvelope(database, "bbbbbbbb-0002-4000-8000-000200000000"),
      [plannedEntry("10101010")],
      NOW,
      "fixture fan-out",
    ));
    const run = database.authority.runs.listByWorkflow("person-lookup")[0];
    assert.ok(run !== undefined);
    assert.equal(Object.hasOwn(run.envelope, "stepOmissions"), false);
  });
});
