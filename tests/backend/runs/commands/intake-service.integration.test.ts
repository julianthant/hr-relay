import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import Excel from "exceljs";
import { composeIntake } from "../../../../src/backend/app/composition/dashboard/intake.js";
import { readArtifactBytes } from "../../../../src/backend/processing/spreadsheet/spreadsheet-grid.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { createWorkbookIntakeBridge } from "../../../../src/backend/runs/commands/workbook-intake-service.js";
import { createIntakeCommandResultQuery } from "../../../../src/backend/runs/queries/intake-command-result.js";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import JSZip from "jszip";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { ActorIdSchema as PublicationActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";

import assert from "node:assert/strict";
import { readFileSync,rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createIntakeParser } from "../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import {
INTAKE_UPLOAD_MAX_BYTES,
createIntakeService,
type IntakeService,
type IntakeServiceDependencies,
} from "../../../../src/backend/runs/commands/intake-service.js";
import { createRunQueueProjection } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import {
INTAKE_FIXTURE_WORKFLOW_ID,
intakeFixtureDescriptor,
intakeFixtureProjection,
} from "../../../support/fixtures/intake-workflow-fixture.js";
import { CONFIG_SNAPSHOT,NOW,UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const ROSTER_CSV = [
  "Work-study roster,,",
  "Employee ID#,Effective Date,Dept",
  "10456712,07/01/2026,Housing Dining Hospitality",
  "10-4567,07/01/2026,Housing Dining Hospitality",
  "10998801,07/01/2026,Student Affairs",
  "",
].join("\n");

const profiles: ReturnType<typeof createBoundProfileFixture>[] = [];
const openDatabases: AuthorityDatabase[] = [];
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) profile.close();
});

let commandSequence = 0;
function commandId(): string {
  commandSequence += 1;
  return `${String(commandSequence).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

interface Surface {
  readonly root: string;
  readonly freshIntake: (missingManifest?: boolean) => IntakeService;
  readonly intake: IntakeService;
  readonly database: AuthorityDatabase;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly clock: TestClock;
  readonly send: (
    intakeSessionId: string,
    expectedVersion: number,
    type: string,
    payload?: Record<string, unknown>,
  ) => Promise<{ readonly state: string }>;
}

function surface(): Surface {
  const profile = createBoundProfileFixture(); profiles.push(profile);
  const root = profile.stateRoot;
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "intake-surface-test" },
    clock,
  );
  openDatabases.push(database);
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);


  const artifacts = createContentAddressedArtifactWriter({
    admission: profile.admission,
  });
  const parser = createIntakeParser({ artifacts });
  const projections = {
    resolve: (workflowId: string) =>
      (workflowId === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined),
  };
  const descriptors = {
    resolve: (workflowId: string) =>
      (workflowId === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined),
  };

  const intakeDependencies: IntakeServiceDependencies = {
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: {
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
      findIntakeManifestsBySource: (sourceSha256) =>
        database.authority.intakeManifests.findBySource(sourceSha256),
    },
    artifacts,
    parser,
    projections,
    descriptors,
    clock,
    ids: sequentialIdFactory("c"),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  };
  const intake = createIntakeService(intakeDependencies);

  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("command-created run lacks queue presentation");
      spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
    } }),
    appVersion: "0.1.0",
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("d"),
    configIdentity: { configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: UUID_1 },
    descriptors,
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: { pool: {
      planPoolWorkerCount: async () => { throw new Error("unused worker plan"); },
      spawnPoolWorker: async () => { throw new Error("unused worker spawn"); },
      refreshPoolBrowser: async () => { throw new Error("unused browser refresh"); },
      reopenPoolBrowser: async () => { throw new Error("unused browser reopen"); },
      stopPoolWorker: async () => { throw new Error("unused worker stop"); },
      pausePoolWorker: async () => { throw new Error("unused worker pause"); },
      resumePoolWorker: async () => { throw new Error("unused worker resume"); },
    } },
    intakeParser: parser,
    intakeProjections: projections,
  });


  const stateRoot = root;
  const projection = createRunQueueProjection({
    timeline: database.authority.timelineEvents,
    reader: sqliteRunReader(database, clock),
    stateRoot,
    clock,
    appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([intakeFixtureDescriptor.contractFingerprint]),
    ledger: createTransactionHistory(database.authority),
    authority: {
      listNotifications: () => [],
      listNotificationCheckpoints: () => [],
      listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
      listGateResults: runId => database.authority.gateResults.listByRun(runId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId: string) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      listRunBatches: () => database.authority.runSessions.list(),
      getRunBatch: (id) => database.authority.runSessions.get(id),
      getFailure: (failureId: string) => database.authority.failures.get(failureId),
      getReceipt: (runId: string) => database.authority.evidenceReceipts.findByRun(runId),
      canonicalPerson: (runId: string) => database.canonicalPerson(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
  });
  const spans = createTimelineEmitter({
    repository: database.authority.timelineEvents,
    clock,
    pid: 4242,

  });
  const commands = createDashboardCommandService({ kernel, projection });

  return {
    root,
    freshIntake: (missingManifest = false) => createIntakeService({ ...intakeDependencies,
      parser: createIntakeParser({ artifacts }), authorityRead: { ...intakeDependencies.authorityRead,
        getIntakeManifest: (id) => missingManifest ? undefined : intakeDependencies.authorityRead.getIntakeManifest(id),
      } }),
    intake,
    artifacts,
    database,
    projection,
    clock,
    send: async (intakeSessionId, expectedVersion, type, payload) => {
      const command = {
        commandId: commandId(),
        requestedAt: NOW,
        requestedBy: "local-operator",
        source: "dashboard",
        family: "intake",
        type,
        target: { intakeSessionId, expectedVersion },
        ...(payload === undefined ? {} : { payload }),
      };
      // Exactly what the `/api/v1/commands` route does before dispatching.
      await intake.prepare(command);
      return commands.execute(command);
    },
  };
}

async function uploadRoster(intake: IntakeService) {
  const outcome = await intake.upload({
    workflow: INTAKE_FIXTURE_WORKFLOW_ID,
    mediaType: "text/csv; charset=utf-8",
    fileName: "cohort-a.csv",
    bytes: new TextEncoder().encode(ROSTER_CSV),
  });
  if (outcome.state === "refused") throw new Error(`the fixture roster was refused: ${outcome.message}`);
  return outcome;
}

describe("intake upload route", () => {
  it("creates a mapping session with discovery already run over the real file", async () => {
    const { intake, database } = surface();
    const created = await uploadRoster(intake);
    assert.equal(created.state, "created");

    const wire = created.session;
    assert.equal(wire.wireVersion, 1);
    assert.equal(wire.state, "mapping");
    assert.equal(wire.expectedVersion, 1);
    assert.deepEqual([...wire.sheets], ["default"]);
    assert.equal(wire.headerRowIndex, 1, "the heading row outranks the title row above it");
    assert.deepEqual(wire.columns.map((column) => column.header), ["Employee ID#", "Effective Date", "Dept"]);
    assert.deepEqual([...wire.columns[0].samples], ["10456712", "10-4567", "10998801"]);
    assert.equal(wire.rowCount, 3);
    assert.equal(wire.validation.state, "none");
    assert.notEqual(wire.headerFingerprint, null);

    const stored = database.authority.intakeSessions.get(wire.intakeSessionId);
    assert.notEqual(stored, undefined);
    // The durable row retains DECISIONS and the source identity only.
    assert.deepEqual(JSON.parse(JSON.stringify(stored?.bindings)), []);
    assert.equal(stored?.artifact.sha256, wire.artifact.sha256);
  });

  it("proposes bindings as hints and applies none of them", async () => {
    const { intake } = surface();
    const wire = (await uploadRoster(intake)).session;
    assert.deepEqual(wire.bindings, []);
    const eidSuggestions = wire.suggestions.filter((entry) => String(entry.targetFieldId) === "emplId");
    assert.ok(eidSuggestions.length > 0, "the scorer must reach the wire");
    assert.equal(
      String(eidSuggestions[0].sourceColumnId),
      String(wire.columns[0].sourceColumnId),
      "the EID column is the proposal",
    );
    assert.deepEqual(wire.targets.map((target) => String(target.targetFieldId)).sort(), [
      "department", "effectiveDate", "emplId",
    ]);
  });

  it("joins the open session when the same bytes are uploaded again", async () => {
    const { intake } = surface();
    const first = await uploadRoster(intake);
    const second = await uploadRoster(intake);
    assert.equal(second.state, "joined");
    assert.equal(second.session.intakeSessionId, first.session.intakeSessionId);
  });

  it("refuses a file the grid edge cannot read, and mints no session", async () => {
    const { intake, database } = surface();
    const blank = "\n\n\n";
    const outcome = await intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "text/csv",
      fileName: "blank.csv",
      bytes: new TextEncoder().encode(blank),
    });
    assert.equal(outcome.state, "refused");
    assert.equal(outcome.state === "refused" ? outcome.code : "", "empty-sheet");
    // The bytes are published (content-addressed and harmless); the SESSION is
    // what must not exist over a file nobody can read.
    assert.equal(database.authority.intakeSessions.findActiveBySource(sha256Hex(blank)).length, 0);
  });

  it("refuses a media type the grid edge does not read, an empty body, and an oversize one", async () => {
    const { intake } = surface();
    await assert.rejects(() => intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "application/pdf",
      fileName: "roster.pdf",
      bytes: new TextEncoder().encode(ROSTER_CSV),
    }));
    await assert.rejects(() => intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "text/csv",
      fileName: "empty.csv",
      bytes: new Uint8Array(0),
    }));
    await assert.rejects(() => intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "text/csv",
      fileName: "huge.csv",
      bytes: new Uint8Array(INTAKE_UPLOAD_MAX_BYTES + 1),
    }));
  });

  it("refuses a workflow that declares no intake projection", async () => {
    const { intake } = surface();
    await assert.rejects(
      () => intake.upload({
        workflow: "person-lookup",
        mediaType: "text/csv",
        fileName: "roster.csv",
        bytes: new TextEncoder().encode(ROSTER_CSV),
      }),
      /is not registered for spreadsheet intake/,
    );
  });
});

describe("intake session wire", () => {
  it("serves the re-derived validation dispositions against the retained readAt", async () => {
    const { intake, send } = surface();
    const created = await uploadRoster(intake);
    const sessionId = created.session.intakeSessionId;
    const headerFingerprint = created.session.headerFingerprint;
    assert.notEqual(headerFingerprint, null);

    const bind = async (targetFieldId: string, columnIndex: number, expectedVersion: number) => {
      const wire = await intake.read(sessionId);
      const result = await send(sessionId, expectedVersion, "confirm-intake-mapping", {
        targetFieldId,
        sourceColumnId: wire.columns[columnIndex].sourceColumnId,
        headerFingerprint,
      });
      assert.equal(result.state, "applied");
    };
    await bind("emplId", 0, 1);
    await bind("effectiveDate", 1, 2);

    assert.equal((await send(sessionId, 3, "validate-intake")).state, "applied");

    const validated = await intake.read(sessionId);
    assert.equal(validated.state, "validated");
    assert.equal(validated.validation.state, "validated");
    if (validated.validation.state !== "validated") throw new Error("unreachable");
    assert.equal(validated.validation.readAt, NOW);
    assert.equal(validated.validation.validRows, 2, "row 2's `10-4567` is not a UCPath EID");
    assert.deepEqual(
      validated.validation.rejected.map((reject) => [reject.sourceRow, reject.code]),
      [[2, "cell-coercion"]],
    );
    assert.deepEqual([...validated.validation.excluded], []);
  });

  it("re-derives an excluded row out of the valid set without storing a single row", async () => {
    const { intake, send, database } = surface();
    const created = await uploadRoster(intake);
    const sessionId = created.session.intakeSessionId;
    const headerFingerprint = created.session.headerFingerprint;

    const wire = await intake.read(sessionId);
    assert.equal(
      (await send(sessionId, 1, "confirm-intake-mapping", {
        targetFieldId: "emplId",
        sourceColumnId: wire.columns[0].sourceColumnId,
        headerFingerprint,
      })).state,
      "applied",
    );
    assert.equal(
      (await send(sessionId, 2, "confirm-intake-mapping", {
        targetFieldId: "effectiveDate",
        sourceColumnId: wire.columns[1].sourceColumnId,
        headerFingerprint,
      })).state,
      "applied",
    );
    assert.equal(
      (await send(sessionId, 3, "exclude-intake-row", { sourceRow: 2, reason: "Bad EID, out of scope" })).state,
      "applied",
    );
    assert.equal((await send(sessionId, 4, "validate-intake")).state, "applied");

    const validated = await intake.read(sessionId);
    if (validated.validation.state !== "validated") throw new Error("unreachable");
    assert.equal(validated.validation.validRows, 2);
    assert.deepEqual([...validated.validation.excluded], [2]);
    assert.deepEqual(validated.validation.rejected, []);

    const stored = JSON.stringify(database.authority.intakeSessions.get(sessionId));
    assert.ok(!stored.includes("10456712"), "no cell value is ever stored on the session row");
    assert.ok(!stored.includes("Employee ID#"), "no detected column is ever stored on the session row");
  });

  it("fails loud on a session that does not exist", async () => {
    const { intake } = surface();
    await assert.rejects(
      () => intake.read("11111111-1111-4111-8111-111111111111"),
      /does not exist/,
    );
  });
});

describe("rerun diff recognizes these exact previously submitted bytes", () => {
  /** Map, validate and enqueue the roster; returns the enqueued session id. */
  async function runTheRoster(
    harness: Surface,
    existingUpload?: Awaited<ReturnType<typeof uploadRoster>>,
  ): Promise<string> {
    const created = existingUpload === undefined ? await uploadRoster(harness.intake) : existingUpload;
    const sessionId = created.session.intakeSessionId;
    const headerFingerprint = created.session.headerFingerprint;
    const wire = await harness.intake.read(sessionId);
    for (const [index, targetFieldId] of [[0, "emplId"], [1, "effectiveDate"]] as const) {
      const current = await harness.intake.read(sessionId);
      assert.equal(
        (await harness.send(sessionId, current.expectedVersion, "confirm-intake-mapping", {
          targetFieldId,
          sourceColumnId: wire.columns[index].sourceColumnId,
          headerFingerprint,
        })).state,
        "applied",
      );
    }
    const beforeExclude = await harness.intake.read(sessionId);
    assert.equal(
      (await harness.send(sessionId, beforeExclude.expectedVersion, "exclude-intake-row", {
        sourceRow: 2,
        reason: "Bad EID, out of scope",
      })).state,
      "applied",
    );
    const beforeValidate = await harness.intake.read(sessionId);
    assert.equal((await harness.send(sessionId, beforeValidate.expectedVersion, "validate-intake")).state, "applied");
    const beforeEnqueue = await harness.intake.read(sessionId);
    assert.equal(
      (await harness.send(sessionId, beforeEnqueue.expectedVersion, "enqueue-intake-manifest", { dryRun: false, reviewBinding: beforeEnqueue.reviewBinding })).state,
      "applied",
    );
    return sessionId;
  }

  it("reserves one manifest identity at upload and consumes it unchanged at enqueue", async () => {
    const harness = surface();
    const created = await uploadRoster(harness.intake);
    const reservedManifestId = created.session.reservedManifestId;
    assert.notEqual(reservedManifestId, undefined, "the durable upload session reserves its manifest identity");
    assert.equal(created.session.manifest, undefined, "a reservation is not a manifest before enqueue");
    assert.equal(
      harness.database.authority.intakeSessions.get(created.session.intakeSessionId)?.reservedManifestId,
      reservedManifestId,
      "the identity served to the caller is the identity stored in authority",
    );

    const sessionId = await runTheRoster(harness, created);
    const enqueued = await harness.intake.read(sessionId);
    assert.equal(enqueued.intakeManifestId, reservedManifestId, "enqueue consumes the reserved identity");
    if (reservedManifestId === undefined) throw new Error("the upload did not reserve a manifest identity");
    const durable = harness.database.authority.intakeManifests.get(reservedManifestId);
    if (durable === undefined) throw new Error("the immutable manifest is missing from authority");
    assert.deepEqual(
      enqueued.manifest,
      {
        manifestId: durable.manifestId,
        mappingFingerprint: durable.mappingFingerprint,
        mappingSnapshotHash: durable.mappingSnapshotHash,
        intakeProjectionFingerprint: durable.intakeProjectionFingerprint,
        workflowContractFingerprint: durable.workflowContractFingerprint,
        canonicalInputSchemaHash: durable.canonicalInputSchemaHash,
        createdAt: durable.createdAt,
        totals: durable.totals,
        sourceRowDispositions: durable.sourceRowDispositions,
        validRows: durable.validRows,
      },
      "the terminal wire projects every reviewed field from the committed authority manifest",
    );
  });

  it("serves no rerun view for a file that has never been enqueued", async () => {
    const { intake } = surface();
    const created = await uploadRoster(intake);
    assert.equal(created.session.rerun, undefined);
    assert.equal(Object.hasOwn(created.session, "comparisonManifestId"), false);
    assert.equal(created.session.intakeManifestId, undefined);
    assert.equal(created.session.sourceName, "cohort-a.csv");
  });

  it("puts every enqueued row on the queue surface under the workflow's own title", async () => {
    const harness = surface();
    const sessionId = await runTheRoster(harness);
    const manifestId = (await harness.intake.read(sessionId)).intakeManifestId;
    if (manifestId === undefined) throw new Error("the enqueued session names no manifest");
    const manifest = harness.database.authority.intakeManifests.get(manifestId);
    if (manifest === undefined) throw new Error("the manifest is missing from authority");

    const day = harness.projection.buildDashboardDayWire(NOW.slice(0, 10));
    assert.equal(day.queueSurfaces.length, manifest.validRows.length, "one queue row per valid source row");
    assert.deepEqual(
      day.queueSurfaces.map((row) => row.title).sort(),
      ["Intake 10456712", "Intake 10998801"],
      "the title is the workflow's OWN presentation over the manifest's stored input",
    );
    for (const row of day.queueSurfaces) {
      assert.equal(String(row.workflowId), INTAKE_FIXTURE_WORKFLOW_ID);
      assert.equal(row.status, "queued");
      assert.equal(row.configFingerprint, CONFIG_SNAPSHOT.fingerprint);
    }
    assert.deepEqual(
      day.statusCounts.map((entry) => [entry.status, entry.count]),
      [["queued", 2]],
    );
  });

  it("serves the manifest and a same-plan diff on the session that enqueued it", async () => {
    const harness = surface();
    const sessionId = await runTheRoster(harness);
    const wire = await harness.intake.read(sessionId);
    assert.equal(wire.state, "enqueued");
    assert.notEqual(wire.intakeManifestId, undefined);
    assert.equal(wire.rerun?.intakeManifestId, wire.intakeManifestId);
    assert.equal(wire.rerun?.totals.valid, 2);
    assert.equal(wire.rerun?.totals.excluded, 1);
    assert.equal(wire.rerun?.diff.kind, "same-plan", "nothing has moved since it ran");
  });

  it("binds each terminal reread to that session's exact manifest after a newer same-source run", async () => {
    const harness = surface();
    const sessionA = await runTheRoster(harness);
    const manifestA = (await harness.intake.read(sessionA)).intakeManifestId;
    if (manifestA === undefined) throw new Error("session A did not name its manifest");

    const sessionB = await runTheRoster(harness);
    const manifestB = (await harness.intake.read(sessionB)).intakeManifestId;
    if (manifestB === undefined) throw new Error("session B did not name its manifest");
    assert.notEqual(manifestB, manifestA);

    const rereadA = await harness.intake.read(sessionA);
    assert.equal(rereadA.manifest?.manifestId, manifestA);
    assert.equal(rereadA.rerun?.intakeManifestId, manifestA);

    const rereadB = await harness.intake.read(sessionB);
    assert.equal(rereadB.manifest?.manifestId, manifestB);
    assert.equal(rereadB.rerun?.intakeManifestId, manifestB);
  });

  it("serves the explicit comparison decision even when the implicit rerun was already the same manifest", async () => {
    const harness = surface();
    const completed = await runTheRoster(harness);
    const manifestId = (await harness.intake.read(completed)).intakeManifestId;
    assert.ok(manifestId);
    harness.clock.advanceWall(1_000);
    const uploaded = await uploadRoster(harness.intake);
    const before = await harness.intake.read(uploaded.session.intakeSessionId);
    assert.equal(before.rerun?.intakeManifestId, manifestId);
    assert.equal(Object.hasOwn(before, "comparisonManifestId"), false);
    assert.equal((await harness.send(before.intakeSessionId, before.expectedVersion, "inspect-intake", { comparisonManifestId: manifestId })).state, "applied");
    const selected = await harness.intake.read(before.intakeSessionId);
    assert.equal(selected.comparisonManifestId, manifestId);
    assert.equal(selected.expectedVersion, before.expectedVersion + 1);
    assert.equal(selected.rerun?.intakeManifestId, before.rerun?.intakeManifestId);
    assert.equal((await harness.send(selected.intakeSessionId, selected.expectedVersion, "inspect-intake", { comparisonManifestId: manifestId })).state, "applied");
    assert.equal((await harness.intake.read(selected.intakeSessionId)).expectedVersion, selected.expectedVersion);
  });

  it("selects its sole eligible manifest while excluding its reservation and a future manifest", async () => {
    const harness = surface();
    const sessionA = await runTheRoster(harness);
    const manifestAId = (await harness.intake.read(sessionA)).intakeManifestId;
    if (manifestAId === undefined) throw new Error("session A did not name its manifest");
    const manifestA = harness.database.authority.intakeManifests.get(manifestAId);
    if (manifestA === undefined) throw new Error("session A's manifest is missing");

    harness.clock.advanceWall(1_000);
    const openB = await uploadRoster(harness.intake);
    const reservedB = openB.session.reservedManifestId;
    if (reservedB === undefined) throw new Error("session B did not reserve a manifest identity");
    harness.database.withAuthorityTransaction((repositories) => repositories.intakeManifests.insert({
      ...manifestA,
      manifestId: reservedB,
      createdAt: openB.session.createdAt,
    }));

    harness.clock.advanceWall(1_000);
    harness.database.withAuthorityTransaction((repositories) => repositories.intakeManifests.insert({
      ...manifestA,
      manifestId: "eeeeeeee-0001-4000-8000-000100000000",
      createdAt: harness.clock.now().toISOString(),
    }));

    const rereadB = await harness.intake.read(openB.session.intakeSessionId);
    assert.equal(rereadB.rerun?.intakeManifestId, manifestAId);
  });

  it("selects the uniquely latest eligible manifest for an open session", async () => {
    const harness = surface();
    const sessionA = await runTheRoster(harness);
    const manifestAId = (await harness.intake.read(sessionA)).intakeManifestId;
    if (manifestAId === undefined) throw new Error("session A did not name its manifest");
    const manifestA = harness.database.authority.intakeManifests.get(manifestAId);
    if (manifestA === undefined) throw new Error("session A's manifest is missing");

    harness.clock.advanceWall(1_000);
    const openB = await uploadRoster(harness.intake);
    const latestManifestId = "dddddddd-0001-4000-8000-000100000000";
    harness.database.withAuthorityTransaction((repositories) => repositories.intakeManifests.insert({
      ...manifestA,
      manifestId: latestManifestId,
      createdAt: openB.session.createdAt,
    }));

    const rereadB = await harness.intake.read(openB.session.intakeSessionId);
    assert.equal(rereadB.rerun?.intakeManifestId, latestManifestId);
  });

  it("refuses an open session whose latest eligible manifests have the same creation time", async () => {
    const harness = surface();
    const sessionA = await runTheRoster(harness);
    const manifestAId = (await harness.intake.read(sessionA)).intakeManifestId;
    if (manifestAId === undefined) throw new Error("session A did not name its manifest");
    const manifestA = harness.database.authority.intakeManifests.get(manifestAId);
    if (manifestA === undefined) throw new Error("session A's manifest is missing");

    harness.clock.advanceWall(1_000);
    const openB = await uploadRoster(harness.intake);
    const candidateIds = [
      "dddddddd-0001-4000-8000-000100000000",
      "eeeeeeee-0001-4000-8000-000100000000",
    ];
    harness.database.withAuthorityTransaction((repositories) => {
      for (const manifestId of candidateIds) {
        repositories.intakeManifests.insert({
          ...manifestA,
          manifestId,
          createdAt: openB.session.createdAt,
        });
      }
    });

    await assert.rejects(
      () => harness.intake.read(openB.session.intakeSessionId),
      new RegExp(
        `intake session ${openB.session.intakeSessionId} cannot select a unique prior manifest at `
        + `${openB.session.createdAt}: candidates ${candidateIds.join(", ")}`,
      ),
    );
  });

  it("shows the mapping axis moving when the same bytes are mapped differently", async () => {
    const harness = surface();
    const first = await runTheRoster(harness);
    assert.equal((await harness.intake.read(first)).state, "enqueued");

    // The enqueued session is closed, so the same file uploads into a NEW one.
    const second = await uploadRoster(harness.intake);
    assert.equal(second.state, "created");
    const fresh = second.session;
    const firstManifestId = (await harness.intake.read(first)).intakeManifestId;
    assert.equal(fresh.rerun?.intakeManifestId, firstManifestId);
    if (firstManifestId === undefined) throw new Error("the first session did not name its manifest");
    const firstManifest = harness.database.authority.intakeManifests.get(firstManifestId);
    if (firstManifest === undefined) throw new Error("the first manifest is missing from authority");
    assert.equal(fresh.rerun?.diff.kind, "changed", "an unmapped session is not last week's plan");
    assert.deepEqual(
      fresh.rerun?.diff.kind === "changed" ? fresh.rerun.diff.changes.map((change) => change.what) : [],
      ["mapping"],
      "only the mapping axis moved — same bytes, same projection, same contract",
    );
    assert.deepEqual(
      fresh.rerun?.diff.removed.map((row) => row.itemId),
      firstManifest.validRows.map((row) => row.itemId),
      "the rerun identifies every previously valid item the current plan no longer contains",
    );
    assert.deepEqual(fresh.rerun?.diff.added, [], "an unmapped current plan adds no runnable item");
  });


describe("2.6.1-2 retained intake evidence", () => {
  it("cold rereads preserve exact source bytes, manifest and database generation", async () => {
    const h = surface(); const sessionId = await runTheRoster(h);
    const before = await h.intake.read(sessionId);
    const file = join(h.root, "artifacts", `${before.artifact.sha256}.artifact`);
    const bytes = readFileSync(file); const generation = h.database.getMeta().authorityGeneration;
    const session = h.database.authority.intakeSessions.get(sessionId);
    const fresh = await h.freshIntake().read(sessionId);
    assert.deepEqual(fresh, before);
    assert.deepEqual(readFileSync(file), bytes);
    assert.deepEqual(h.database.authority.intakeSessions.get(sessionId), session);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
  it("refuses missing exact manifest linkage instead of finding a newer manifest", async () => {
    const h = surface(); const sessionId = await runTheRoster(h);
    const before = await h.intake.read(sessionId); const generation = h.database.getMeta().authorityGeneration;
    assert.ok(before.intakeManifestId);
    await assert.rejects(() => h.freshIntake(true).read(sessionId), /names missing manifest/u);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(await h.intake.read(sessionId), before);
  });
  it("a cold read refuses removed artifact bytes without an empty or cached replacement", async () => {
    const h = surface(); const sessionId = await runTheRoster(h);
    const before = await h.intake.read(sessionId); const generation = h.database.getMeta().authorityGeneration;
    rmSync(join(h.root, "artifacts", `${before.artifact.sha256}.artifact`));
    await assert.rejects(() => h.freshIntake().read(sessionId), /ENOENT/u);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.equal(h.database.authority.intakeSessions.get(sessionId)?.artifact.sha256, before.artifact.sha256);
  });
});

});

describe("saved workbook intake bridge", () => {
  it("retains immutable workbook provenance, all sheets and data, joins only exact sources, and refuses stale versions", async () => {
    const h = surface();
    const library = createWorkbookLibraryService({ repository: h.database.authority.workbooks, clock: h.clock });
    const first = library.create({ name: "Roster.xlsx", themes: [], hasFormulas: false, sheets: [
      { id: "roster", name: "Roster", width: 2, hidden: [], headerRow: 1, sourceHeaderRow: 7,
        columnBindings: [{ id: "eid", sourceColumn: 4, sourceHeader: "Original EID", fieldId: "eid", basis: "manual" }, { id: "date", sourceColumn: null, sourceHeader: "Added date", fieldId: "roster.notes", basis: "manual" }],
        rows: [{ id: "head", cells: [{ value: "Employee ID#" }, { value: "Effective Date" }] }, { id: "data", cells: [{ value: "10456712", hyperlink: "https://example.com/employee", tooltip: "Employee" }, { value: new Date("2026-07-01T00:00:00.000Z"), numFmt: "mm/dd/yyyy" }] }] },
      { id: "other", name: "Other", width: 1, hidden: [], rows: [{ id: "other-head", cells: [{ value: "Name" }] }, { id: "other-data", cells: [{ value: "Example Person", richText: [{ text: "Example ", font: { bold: true } }, { text: "Person" }] }] }] },
    ] });
    const bridge = createWorkbookIntakeBridge(library, h.intake);
    const request = { expectedVersion: 1, workflowId: INTAKE_FIXTURE_WORKFLOW_ID };
    const result = await bridge(first.libraryId, request);
    if (result.state === "refused") throw new Error(result.message);
    assert.equal(result.state, "created");
    assert.deepEqual(result.session.workbookSource, { libraryId: first.libraryId, version: 1 });
    assert.deepEqual(result.session.sheets, ["Roster", "Other"]); assert.equal(result.session.rowCount, 1);
    assert.equal(result.session.headerRowIndex, 0); assert.deepEqual(result.session.bindings, []);
    assert.deepEqual(result.session.columns.map(column => column.samples), [["10456712"], ["2026-07-01"]]);
    const bytes = await readArtifactBytes(() => h.artifacts.open(result.session.artifact));
    const preserved = new Excel.Workbook();
    await preserved.xlsx.load(Uint8Array.from(bytes).buffer);
    assert.deepEqual(preserved.worksheets[0].getCell('A2').value, { text: '10456712', hyperlink: 'https://example.com/employee' });
    assert.equal(preserved.worksheets[0].getCell('B2').numFmt, 'mm/dd/yyyy');
    assert.deepEqual(preserved.worksheets[1].getCell('A2').value, { richText: [{ text: 'Example ', font: { bold: true } }, { text: 'Person' }] });
    const zip = await JSZip.loadAsync(bytes);
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
    assert.match(sheetXml ?? '', /<hyperlink[^>]+tooltip="Employee"/u);
    for (const entry of Object.values(zip.files)) assert.equal(entry.date.toISOString(), first.savedAt);
    const generation = h.database.getMeta().authorityGeneration;
    const joined = await bridge(first.libraryId, request); assert.equal(joined.state, "joined");
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.deepEqual((await h.freshIntake().read(result.session.intakeSessionId)).workbookSource, result.session.workbookSource);
    await h.send(result.session.intakeSessionId, result.session.expectedVersion, "inspect-intake", { sheet: "Roster", headerRowIndex: 0 });
    assert.deepEqual((await h.intake.read(result.session.intakeSessionId)).workbookSource, result.session.workbookSource);
    await assert.rejects(h.intake.upload({ workflow: INTAKE_FIXTURE_WORKFLOW_ID, fileName: "Raw.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes }), { code: "WORKBOOK_INTAKE_SOURCE_CONFLICT" });
    const ordinary = surface();
    const raw = await ordinary.intake.upload({ workflow: INTAKE_FIXTURE_WORKFLOW_ID, fileName: "Raw.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes });
    if (raw.state === "refused") throw new Error(raw.message);
    const ordinaryLibrary = createWorkbookLibraryService({ repository: ordinary.database.authority.workbooks, clock: ordinary.clock });
    const other = ordinaryLibrary.create({ ...first.workbook, libraryId: undefined });
    const ordinaryGeneration = ordinary.database.getMeta().authorityGeneration;
    await assert.rejects(createWorkbookIntakeBridge(ordinaryLibrary, ordinary.intake)(other.libraryId, request), { code: "WORKBOOK_INTAKE_SOURCE_CONFLICT" });
    assert.equal(ordinary.database.getMeta().authorityGeneration, ordinaryGeneration);
    assert.equal(ordinary.database.authority.intakeSessions.findActiveBySource(raw.session.artifact.sha256).length, 1);
    h.database.close();
    const reopened = AuthorityDatabase.open({ path: join(h.root, "state.db"), busyTimeoutMs: 250, migrationOwner: "bridge-restart" }, h.clock);
    try {
      const restartedLibrary = createWorkbookLibraryService({ repository: reopened.authority.workbooks, clock: h.clock });
      const restartedIntake = composeIntake({ database: reopened, artifacts: h.artifacts, parser: createIntakeParser({ artifacts: h.artifacts }),
        projections: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined },
        descriptors: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined }, clock: h.clock, ids: sequentialIdFactory("f") });
      const restartedBridge = createWorkbookIntakeBridge(restartedLibrary, restartedIntake);
      const beforeJoin = reopened.getMeta().authorityGeneration;
      const rejoined = await restartedBridge(first.libraryId, request);
      if (rejoined.state === "refused") throw new Error(rejoined.message);
      assert.equal(rejoined.state, "joined");
      assert.equal(rejoined.session.intakeSessionId, result.session.intakeSessionId);
      assert.equal(rejoined.session.artifact.sha256, result.session.artifact.sha256);
      assert.equal(reopened.getMeta().authorityGeneration, beforeJoin);
      assert.deepEqual(rejoined.session.workbookSource, result.session.workbookSource);
      const second = restartedLibrary.save(first.libraryId, 1, first.workbook);
      const beforeConflict = reopened.getMeta().authorityGeneration;
      await assert.rejects(restartedBridge(first.libraryId, request), { code: "WORKBOOK_VERSION_CONFLICT" });
      await assert.rejects(restartedBridge(first.libraryId, { ...request, expectedVersion: second.version }), { code: "WORKBOOK_INTAKE_SOURCE_CONFLICT" });
      assert.equal(reopened.getMeta().authorityGeneration, beforeConflict);
      assert.equal(reopened.authority.intakeSessions.findActiveBySource(result.session.artifact.sha256).length, 1);
      assert.deepEqual(restartedLibrary.history(first.libraryId)[0].workbook, first.workbook);
    }
    finally { reopened.close(); }
  });
  it("reads only the actual recorded intake request and result for its exact session without effects", async () => {
    const h = surface(), id = (await uploadRoster(h.intake)).session.intakeSessionId;
    const outcome = CommandResultSchema.parse(await h.send(id, 1, "inspect-intake", { sheet: "default", headerRowIndex: 1 }));
    const query = createIntakeCommandResultQuery(h.database);
    const generation = h.database.getMeta().authorityGeneration;
    const readback = query(id, outcome.commandId); assert.equal(readback.state, "recorded");
    if (readback.state !== "recorded") throw new Error("missing recorded command");
    assert.deepEqual(readback.result, outcome);
    assert.deepEqual(readback.request, h.database.authority.commands.get(outcome.commandId));
    assert.deepEqual(query(commandId(), outcome.commandId), { state: "unavailable" });
    assert.deepEqual(query(id, commandId()), { state: "unavailable" });
    assert.deepEqual(query(id, UUID_1), { state: "unavailable" });
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
});
