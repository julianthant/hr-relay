import { historicalArchiveAuthority } from "../../../../../support/helpers/integration/historical-archive-authority.js";
import { VersionChangeStorageSchema } from "../../../../../../src/models/archive/change-record.js";
import { createRunLifecycleStorage } from "../../../../../../src/backend/storage/sqlite/run-lifecycle-storage.js";
import { projectArchiveReport, queryArchiveReports } from "../../../../../../src/backend/runs/queries/archive-reports.js";
import { ArchiveReportSchema } from "../../../../../../src/models/archive/report.js";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteCheckpoint } from "../../../../../support/helpers/timeline-write-fixture.js";
import { sqliteRunReader } from "../../../../../support/helpers/canonical-run-reader.js";
import { archivedRunReferenceFingerprint } from "../../../../../../src/models/archive/model.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { createCommandKernel, type CommandKernel } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { CommandResultSchema, type CommandResult } from "../../../../../../src/rules/commands/commands.js";
import { QueueSurfaceWireSchema } from "../../../../../../src/models/dashboard/projection.js";
import { EidSchema } from "../../../../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../../src/models/workflow/presentation.js";
import { FixtureReadReceipt } from "../../../../../support/fixtures/descriptor-fixtures.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { buildArchiveIndex, buildArchivedRunDetail } from "../../../../../../src/backend/runs/queries/archive.js";
import {
  archivedRunContentDigest,
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
  CURRENT_ARCHIVE_SCHEMA_GENERATION,
  VersionBumpApplicationSchema,
  VersionBumpPlanSchema,
} from "../../../../../../src/models/archive/model.js";
import { RunEvidenceReceiptSchema } from "../../../../../../src/models/trust/evidence.js";
import { createTransactionHistory } from "../../../../../../src/backend/storage/sqlite/transaction-history.js";

import { UcpathCreateTermination } from "../../../../../../src/models/systems/ucpath/create-termination.js";
import { deriveSchemaHash } from "../../../../../../src/models/validation/schema-bound-value.js";
import type { ArchiveRunSnapshot } from "../../../../../../src/backend/runs/archive/archive-service.js";
import { planStart } from "../../../../../../src/backend/runs/start/plan.js";
import { HASH_A, HASH_B, NOW, UUID_4 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../../../../../support/fixtures/operator-command-fixtures.js";
import { WriteFixtureCommit, WriteFixturePrepare } from "../../../../../support/fixtures/write-sequencer-fixtures.js";
import {
  ARCHIVED_RUN,
  ARCHIVED_RUN_WITH_SECTIONS,
  VERSION_BUMP_APPLICATION,
  VERSION_BUMP_PLAN,
  VERSION_PLAN_ROW,
} from "../../../../../support/fixtures/archive-fixtures.js";
import { ledgerCommitFixture } from "../../../../../support/fixtures/ledger-projection-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../../../support/fixtures/intake-kernel-seams.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* ── one workflow, at two versions ───────────────────────────────────────── */

const ArchiveInput = z.strictObject({ eid: EidSchema });
const ArchiveCanonicalInput = defineCanonicalInput(
  ArchiveInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }, { eid: "10800001" }],
);


function descriptorAt(version: number, fingerprint: string): AnyWorkflowDescriptor {
  return defineWorkflowDescriptor({
    id: "archive-fixture",
    version,
    contractFingerprint: fingerprint,
    code: "af",
    label: "Archive Fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: ArchiveCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "allow-parallel",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.eid}` },
    presentation: { title: (input) => `EID ${input.eid}` },
    scenarios: ["fixture-graph/happy"],
    flow: flow(ArchiveInput)
      .step("probe", FixtureReadReceipt, {
        dependsOn: [],
        replay: "checkpoint",
        bind: ({ input }) => ({ eid: input.eid }),
      })
      // A read-only graph cannot rehearse; archive fixtures need a transaction-supported preview envelope.
      .transaction("previewable-write", {
        dependsOn: ["probe"],
        prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
        commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
        dryRun: "stop-after-prepare",
        probePolicy: "always",
        probeToFenceMaxMs: 30_000,
      })
      .build({
        schema: z.strictObject({ eid: EidSchema }),
        dependsOn: ["probe", "previewable-write"],
        derive: ({ outputs }) => ({ eid: outputs.probe.eid }),
      }),
  });
}

const V1 = descriptorAt(1, HASH_A);
const V2 = descriptorAt(2, HASH_B);

interface World {
  readonly database: AuthorityDatabase;
  readonly stateRoot: string;
  kernel: CommandKernel;
  /** Flipped by `bumpRegistry` — the kernel resolves through this box. */
  registry: AnyWorkflowDescriptor;
  readonly ids: { uuid: () => string };
  // Mutable resolved-instance facts let the index copy be tested against the frozen row.
  resolvedInstances: readonly { system: string; instance: "prod" | "test" }[];
  // Mutable warning facts let the index copy be tested against the frozen row.
  warnings:
    | { state: "present"; count: number; first: string }
    | { state: "absent"; reason: string };
}


function snapshotSource(world: {
  database: AuthorityDatabase;
  resolvedInstances?: readonly { system: string; instance: "prod" | "test" }[];
  warnings?:
    | { state: "present"; count: number; first: string }
    | { state: "absent"; reason: string };
}) {
  return {
    snapshotBatch(runIds: readonly string[]): ReadonlyMap<string, ArchiveRunSnapshot> {
      return new Map(runIds.map((runId) => [runId, this.snapshot(runId)]));
    },
    snapshot(runId: string): ArchiveRunSnapshot {
      const run = world.database.authority.runs.get(runId);
      if (run === undefined) throw new Error(`no run ${runId} to snapshot`);
      const status = "cancelled" as const;
      return {
        row: {
          runId: run.envelope.runId,
          itemId: run.envelope.itemId,
          workflowId: run.envelope.workflow,
          traceId: run.envelope.traceId,
          attempt: 1,
          lineage: { state: "root" },
          actorId: "local-operator",
          appVersion: run.appVersion === undefined
            ? { state: "absent", reason: "enqueued before runs stamped their app build (D179)" }
            : { state: "present", value: run.appVersion },
          descriptorVersion: run.envelope.descriptorVersion,
          descriptorHash: run.envelope.contractFingerprint,
          configFingerprint: run.envelope.configFingerprint,
          resolvedInstances: world.resolvedInstances ?? [],
          dryRun: run.envelope.dryRun,
          priority: run.envelope.priority,

          runNumber: run.runNumber === undefined
            ? { state: "absent", reason: "enqueued before runs carried a workflow ordinal (D230)" }
            : { state: "present", value: run.runNumber },

          session: run.sessionId === undefined
            ? { state: "absent", reason: "this run predates D269 session grouping, or retries a run that does" }
            : { state: "present", sessionId: run.sessionId },
          containment: "root",
          linkedRuns: [],
          facts: { state: "absent", reason: "this run's evidence receipt records no output fact" },
          startedAt: NOW,
          updatedAt: NOW,
          endedAt: { state: "present", value: NOW },
          gateOpenedAt: { state: "absent", reason: "an archived run is not waiting on a gate" },
          displayName: { state: "absent", reason: "the operator has not renamed this run" },
          title: `EID ${run.envelope.itemId.slice(0, 8)}`,
          subtitle: { state: "absent", reason: "the start plan proposed no subtitle" },
          status,
          liveMessage: { state: "absent", reason: "an archived run has no live message" },
          warnings: world.warnings
            ?? { state: "absent", reason: "this run's evidence receipt records no warning" },
          pipeline: [],
          panelKind: "run",
          availableSections: ["logs"],
          // An archived row is frozen: no command can target it.
          actions: [],
          rowRevision: run.version,
          surfaceKind: "single",
        },
        detail: {
          runId: run.envelope.runId,
          rowRevision: run.version,
          panelKind: "run",
          header: {
            runId: run.envelope.runId,
            traceId: run.envelope.traceId,
            workflowId: run.envelope.workflow,
            actorId: "local-operator",
            title: `EID ${run.envelope.itemId.slice(0, 8)}`,
            status,
            attempt: 1,
          },
          timeline: { events: [] },
          gate: { state: "absent", reason: "this workflow declares no gate" },
          outcome: { state: "terminal", result: "cancelled", completedAt: NOW },
          context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
          availableSections: ["logs"],
        },
        failure: { state: "absent", reason: "the run did not settle with a structured failure" },

        sections: {
          logs: {
            state: "present",
            value: {
              runId: run.envelope.runId,
              rows: [{
                kind: "note",
                logId: "dddddddd-0001-4000-8000-dddddddd0001",
                sequence: 0,
                note: {
                  noteId: "dddddddd-0001-4000-8000-dddddddd0001",
                  runId: run.envelope.runId,
                  sequence: 0,
                  at: NOW,
                  level: "info",
                  message: "frozen log line",
                },
              }],
              notes: [{
                noteId: "dddddddd-0001-4000-8000-dddddddd0001",
                runId: run.envelope.runId,
                sequence: 0,
                at: NOW,
                level: "info",
                message: "frozen log line",
              }],
              nextCursor: { state: "absent", reason: "end-of-page" },
            },
          },
          data: {
            state: "present",
            value: {
              runId: run.envelope.runId,
              state: "unavailable",
              reason: "descriptor-mismatch",
              entries: [],
            },
          },
          people: { state: "absent", reason: "this run fanned out no member runs" },
          attempts: {
            state: "present",
            value: [{
              attempt: 1,
              steps: 1,
              startedAt: { state: "present", value: NOW },
              endedAt: { state: "present", value: NOW },
              outcomes: [{ outcome: "done", count: 1 }],
              unfinished: 0,
            }],
          },
        },
      } as unknown as ArchiveRunSnapshot;
    },
  };
}

function createWorld(historical = false): World {
  const root = mkdtempSync(join(tmpdir(), "hrauto-archive-"));
  roots.push(root);
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot, { recursive: true });
  const clock = manualClock(new Date(NOW));
  const database = historical ? historicalArchiveAuthority(join(root, "authority.sqlite"),clock) : AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "archive-test" },
    clock,
  );
  databases.push(database);
  seedSyntheticRuntimeConfig(database);
  const ids = sequentialIdFactory("a");
  const world: World = {
    database,
    stateRoot,
    registry: V1,
    ids,
    resolvedInstances: [],
    warnings: { state: "absent", reason: "this run's evidence receipt records no warning" },
    kernel: undefined as unknown as CommandKernel,
  };
  world.kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids,
    appVersion: "0.1.0",
    descriptors: { resolve: (workflowId) => (workflowId === "archive-fixture" ? world.registry : undefined) },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: {
      planWorkerCount: () => ({ state: "accepted", workerIds: [] }),
      spawnWorker: () => ({ state: "accepted" }),
      refreshBrowser: () => ({ state: "accepted" }),
      reopenBrowser: () => ({ state: "accepted" }),
    },
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    configIdentity: { configFingerprint: HASH_B, configSnapshotId: UUID_4 },
    archiveSnapshots: snapshotSource(world),
  });
  return world;
}

let commandSequence = 0;
function envelope(): { commandId: string; requestedAt: string; requestedBy: string; source: string } {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return {
    commandId: `cccccccc-${tail}-4000-8000-${tail}00000000`,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "archive",
  };
}

/** Enqueues one run against the registry's CURRENT descriptor and settles it. */
function startRun(world: World, eid: string, terminal: boolean, dryRun = false): string {
  const plan = planStart(
    { authority: world.database, clock: manualClock(new Date(NOW)), ids: world.ids, planTtlMs: 600_000 },
    {
      descriptor: world.registry,
      submissions: [{ eid }],
      dryRun,
      priority: "bulk",
      shape: "single",
      configFingerprint: HASH_B,
      configSnapshotId: UUID_4,
      plannedBy: "local-operator",
    },
  );
  assert.equal(world.database.authority.startPlans.create(plan).state, "inserted");
  const result = CommandResultSchema.parse(world.kernel.execute({
    ...envelope(),
    family: "start",
    type: "start-run",
    target: { workflowId: "archive-fixture", startPlanId: plan.startPlanId, expectedVersion: plan.version },
    payload: {
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
    },
  }));
  assert.equal(result.state, "applied");
  const runId = singleAppliedRunId(result);
  if (terminal) {
    const run = world.database.authority.runs.get(runId);
    assert.notEqual(run, undefined);
    const outcome = world.database.authority.runs.transition({
      runId,
      expectedVersion: run?.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      now: NOW,
    });
    assert.equal(outcome.state, "applied");
  }
  return runId;
}

function plan(
  world: World,
  kind: "major" | "minor" = "major",
): { versionPlanId: string; expectedVersion: number; planFingerprint: string } {
  const result = CommandResultSchema.parse(world.kernel.execute({
    ...envelope(),
    family: "version-archive",
    type: "plan-version-bump",
    target: { scope: { kind: "workflows", workflowIds: ["archive-fixture"] } },
    payload: {
      targetVersion: "0.2.0",
      changeFingerprint: HASH_B,

      changeRecord: {
        kind,
        what: kind === "major"
          ? "the fixture workflow's probe step changed shape"
          : "the fixture workflow's presentation moved inside the same shape",
        why: "the archive suite bumps the descriptor to make prior-version runs exist",
        commit: { state: "present", value: "0123456abcdef" },
      },
    },
  }));
  assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "plan refused");
  const target = result.state === "applied" ? result.affectedTargets[0] : undefined;
  assert.equal(target?.family, "version-archive");
  const stored = world.database.readVersionChange(
    target?.family === "version-archive" ? target.versionPlanId : "",
  );
  assert.notEqual(stored, undefined);
  return {
    versionPlanId: String(stored?.changeId),
    expectedVersion: 1,
    planFingerprint: String(stored?.reviewFingerprint),
  };
}

function apply(world: World, reviewed: ReturnType<typeof plan>): CommandResult {
  return CommandResultSchema.parse(world.kernel.execute({
    ...envelope(),
    family: "version-archive",
    type: "apply-version-bump",
    target: { versionPlanId: reviewed.versionPlanId, expectedVersion: reviewed.expectedVersion },
    payload: { planFingerprint: reviewed.planFingerprint },
  }));
}

// Read archives with an empty registry so current definitions cannot repair missing frozen facts.
function reportOf(world: World, runId: string) {
  const report = createRunLifecycleStorage(world.database).readReport(runId); assert.ok(report); return report;
}
function displayValue(world: World, runId: string, label: string) { return displayValueFrom(reportOf(world, runId), label); }
function displayValueFrom(report: ReturnType<typeof reportOf>, label: string) {
  const section = projectArchiveReport(report); assert.equal(section.state, "available");
  if (section.state !== "available") throw new Error("report unavailable");
  const display = section.sections.find(value => value.title === "Displayed run");
  assert.ok(display?.kind === "values");
  return display.values.find(value => value.label === label)?.value;
}

function emptyRegistryDeps(world: World): Parameters<typeof buildArchivedRunDetail>[0] {
  return {
    clock: manualClock(new Date(NOW)),
    appVersion: "0.1.0",
    authority: { withAuthorityTransaction: (work: never) => world.database.withAuthorityTransaction(work) },
    reader: sqliteRunReader(world.database, manualClock(new Date(NOW))),
    descriptors: { list: () => [] },
    ledger: createTransactionHistory(world.database.authority),
  } as unknown as Parameters<typeof buildArchivedRunDetail>[0];
}

/** Every byte under a ledger root, so "untouched" can be asserted literally. */
function ledgerBytes(stateRoot: string): readonly [string, string][] {
  const ledgerRoot = join(stateRoot, "ledger");
  return (existsSync(ledgerRoot) ? readdirSync(ledgerRoot) : [])
    .sort()
    .map((name) => [name, readFileSync(join(ledgerRoot, name), "utf8")] as const);
}

describe("the archive model", () => {
  for (const changed of ["raw", "parsed", "both"] as const) {
    it(`refuses changed protected ${changed} input at archive reads and commands without effects`, () => {
      const world = createWorld(true);
      const fingerprint = archivedRunReferenceFingerprint(ARCHIVED_RUN);
      const corrupt = structuredClone(ARCHIVED_RUN);
      if (changed !== "parsed") corrupt.input.raw = { emplId: "10854321" };
      if (changed !== "raw") corrupt.input.parsed.value = {
        emplId: "10854321", keepNonHdh: false, includeCrmDates: false,
      };
      const { contentDigest, ...content } = corrupt;
      assert.equal(archivedRunContentDigest(content), contentDigest);
      world.database.withAuthorityTransaction((repositories) => {
        repositories.runs.enqueue(QUEUED_RUN);
      repositories.runs.transition({ runId: QUEUED_RUN.envelope.runId, expectedVersion: 1, now: NOW,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
        repositories.versionPlans.insert(VERSION_PLAN_ROW);
        repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
        repositories.archivedRuns.insert(corrupt);
      });
      const generation = world.database.getMeta().authorityGeneration;
      const before = world.database.authority.runs.get(ARCHIVED_RUN.runId);
      assert.throws(() => buildArchiveIndex(emptyRegistryDeps(world)), /archive.*integrity/u);
      assert.throws(() => buildArchivedRunDetail(emptyRegistryDeps(world), ARCHIVED_RUN.runId), /archive.*integrity/u);
      for (const type of ["delete-archived-run", "relaunch-archived-run"]) {
        assert.throws(() => world.kernel.execute({ ...envelope(), family: "version-archive", type,
          target: { archivedRunId: ARCHIVED_RUN.runId, archiveFingerprint: fingerprint } }), /archive.*integrity/u);
      }
      assert.equal(world.database.getMeta().authorityGeneration, generation);
      assert.deepEqual(world.database.authority.runs.get(ARCHIVED_RUN.runId), before);
      assert.equal(world.database.authority.archivedRuns.isArchived(ARCHIVED_RUN.runId), true);
      assert.equal(world.database.authority.deletedRuns.get(ARCHIVED_RUN.runId), undefined);
    });
  }
  it("refuses corrupt retained content at archive reads and commands without effects", () => {
    const world = createWorld(true);
    const fingerprint = archivedRunReferenceFingerprint(ARCHIVED_RUN);
    world.database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.runs.transition({ runId: QUEUED_RUN.envelope.runId, expectedVersion: 1, now: NOW,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert({ ...ARCHIVED_RUN, row: { ...ARCHIVED_RUN.row, status: "failed" } });
    });
    const generation = world.database.getMeta().authorityGeneration;
    const before = world.database.authority.runs.get(ARCHIVED_RUN.runId);
    assert.throws(() => buildArchivedRunDetail(emptyRegistryDeps(world), ARCHIVED_RUN.runId), /archive.*integrity/u);
    assert.throws(() => buildArchiveIndex(emptyRegistryDeps(world)), /archive.*integrity/u);
    for (const type of ["delete-archived-run", "relaunch-archived-run"]) {
      assert.throws(() => world.kernel.execute({ ...envelope(), family: "version-archive", type,
        target: { archivedRunId: ARCHIVED_RUN.runId, archiveFingerprint: fingerprint } }), /archive.*integrity/u);
    }
    assert.equal(world.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(world.database.authority.runs.get(ARCHIVED_RUN.runId), before);
    assert.equal(world.database.authority.archivedRuns.list().length, 1);
    assert.equal(world.database.authority.deletedRuns.get(ARCHIVED_RUN.runId), undefined);
  });
  it("moves prior-version runs into the archive and out of every live read", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    const current = startRun(world, "10456712", true);
    assert.equal(apply(world, plan(world)).state, "applied");
    const report = reportOf(world, archived);
    assert.equal(report.content.descriptorVersion, "1");
    assert.equal(world.database.authority.runs.get(archived), undefined);
    assert.equal(world.database.authority.archivedRuns.get(archived), undefined);
    assert.ok(world.database.authority.runs.get(current));
    assert.equal(createRunLifecycleStorage(world.database).readReport(current), undefined);
    assert.equal(world.database.authority.deletedRuns.get(archived), undefined);
    const original = JSON.parse(report.content.sources[0].json) as { run: { appVersion: string; envelope: { contractFingerprint: string } } };
    assert.equal(original.run.appVersion, "0.1.0");
    assert.equal(original.run.envelope.contractFingerprint, HASH_A);
  });

  it("renders an archived run with the workflow registry EMPTY — zero old-version code paths", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    const report = reportOf(world, archived);
    world.database.close();
    const detail = projectArchiveReport(report);
    assert.equal(detail.state, "available");
    assert.equal(displayValueFrom(report, "detail.header.runId"), archived);
    assert.equal(report.content.descriptorVersion, "1");
    assert.equal("sources" in detail, false);
  });

  it("serves all five tabs' frozen payloads with the workflow registry EMPTY", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    assert.equal(displayValue(world, archived, "sections.logs.state"), "present");
    assert.equal(displayValue(world, archived, "sections.logs.value.notes.0.message"), "frozen log line");
    assert.equal(displayValue(world, archived, "sections.data.value.state"), "unavailable");
    assert.equal(displayValue(world, archived, "sections.data.value.reason"), "descriptor-mismatch");
    assert.equal(displayValue(world, archived, "sections.attempts.value.0.attempt"), 1);
    assert.equal(displayValue(world, archived, "sections.people.state"), "absent");
    assert.equal(reportOf(world, archived).content.files.length, 0);
    assert.equal(reportOf(world, archived).content.sections.find(value => value.title === "diagnostic_files")?.kind, "unavailable");
  });

  it.each([5, 6])("withholds protected generation-%s receipt, failure, queue, and log diagnostics without rewriting the archive", (generation) => {
    const world = createWorld(true);
    const raw = "ucpath:termination|10812345|2026-08-29";
    const sections = ARCHIVED_RUN_WITH_SECTIONS.sections;
    if (sections === undefined || sections.logs.state !== "present") {
      throw new Error("archive fixture must hold frozen logs");
    }
    const receipt = RunEvidenceReceiptSchema.parse({
      composition: 2,
      receiptId: "30000000-0000-4000-8000-000000000001",
      runId: ARCHIVED_RUN.runId,
      traceId: ARCHIVED_RUN.traceId,
      workflowId: ARCHIVED_RUN.workflowId,
      attempt: 1,
      generatedAt: NOW,
      descriptorFingerprint: HASH_A,
      configFingerprint: HASH_B,
      retryOf: { state: "absent" },
      failure: { state: "absent" },
      input: [], observations: [], decisions: [], actions: [], verification: [], output: [], reuse: [],
      warnings: [{
        id: "30000000-0000-4000-8000-000000000002",
        code: "LEGACY_DIAGNOSTIC",
        summary: raw,
        loadBearing: false,
        evidence: [],
      }],
      confidence: "partial",
      result: "done-with-warnings",
    });
    const { contentDigest: _oldDigest, ...base } = ARCHIVED_RUN;
    const content = ArchivedRunContentSchema.parse({
      ...base,
      archiveSchemaGeneration: generation,
      workflowCode: { state: "present", value: "pl" },
      row: {
        ...base.row,
        title: raw,
        subtitle: { state: "present", value: raw },
        facts: { state: "present", value: [{ label: "Unsafe", value: raw }] },
        session: { state: "absent", reason: "archived before session grouping" },
        liveMessage: { state: "present", value: raw },
        warnings: { state: "present", count: 1, first: raw },
      },
      detail: { ...base.detail, header: { ...base.detail.header, title: raw } },
      receipt: generation < 6 ? { state: "present", value: receipt } : { state: "absent", reason: "historical receipt withheld" },
      failure: {
        state: "present",
        value: {
          runId: base.runId,
          failureId: "30000000-0000-4000-8000-000000000003",
          traceId: base.traceId,
          attempt: 1,
          workflowId: base.workflowId,
          fingerprint: "d".repeat(64),
          code: "UNHANDLED",
          summary: raw,
          transient: false,
          writeState: "not-attempted",
          subject: { state: "absent", reason: "no subject" },
          causeChain: [{ code: "UNHANDLED", summary: raw, role: "primary", transient: false }],
          remediation: [{ kind: "operator-action", message: raw }],
          sameFingerprintSeen: 1,
          diagnosticBundle: { state: "absent", reason: "not captured" },
          occurredAt: NOW,
        },
      },
      sections: {
        ...sections,
        logs: {
          state: "present",
          value: (() => {
            const notes = sections.logs.value.notes.map((note) => ({ ...note, runId: base.runId, message: raw }));
            return {
              ...sections.logs.value,
              runId: base.runId,
              notes,
              rows: notes.map((note) => ({
                kind: "note",
                logId: note.noteId,
                sequence: note.sequence,
                note,
              })),
            };
          })(),
        },
      },
    });
    const historical = ArchivedRunRecordSchema.parse({
      ...content,
      contentDigest: archivedRunContentDigest(content),
    });
    world.database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.runs.transition({ runId: QUEUED_RUN.envelope.runId, expectedVersion: 1, now: NOW,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert(historical);
      return undefined;
    });

    const expectedWarningReason = generation < 6
      ? "archive schema generation 5 predates diagnostic safety v1; historical free text is withheld"
      : "protected archived detail withheld; private authority is unchanged";
    const indexEntry = buildArchiveIndex(emptyRegistryDeps(world)).entries.find(({ runId }) => (
      runId === historical.runId
    ));
    const projected = buildArchivedRunDetail(emptyRegistryDeps(world), historical.runId);
    assert.ok(indexEntry !== undefined, "the seeded historical run must appear in the Archive index");
    assert.deepEqual(indexEntry.warnings, { state: "absent", reason: expectedWarningReason });
    assert.equal(JSON.stringify(indexEntry).includes(raw), false);
    assert.deepEqual(projected.row.warnings, { state: "absent", reason: expectedWarningReason });
    assert.equal(JSON.stringify(projected).includes(raw), false);
    assert.equal(projected.receipt.state, "absent");
    assert.equal(projected.failure.state, "absent");
    assert.equal(projected.row.liveMessage.state, "absent");
    assert.equal(projected.sections.state, "absent");
    assert.equal(JSON.stringify(world.database.authority.archivedRuns.get(historical.runId)).includes(raw), true);
  });

  it("reads a generation-1 record forward and fabricates no tab for it", () => {

    const world = createWorld(true);
    world.database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.runs.transition({ runId: QUEUED_RUN.envelope.runId, expectedVersion: 1, now: NOW,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert(ARCHIVED_RUN);
      return undefined;
    });

    const stored = world.database.authority.archivedRuns.get(ARCHIVED_RUN.runId);
    assert.equal(stored?.archiveSchemaGeneration, 1);
    assert.equal(stored?.sections, undefined);

    assert.equal(stored?.contentDigest, ARCHIVED_RUN.contentDigest);

    const detail = buildArchivedRunDetail(emptyRegistryDeps(world), ARCHIVED_RUN.runId);
    assert.equal(detail.archiveSchemaGeneration, 1);
    assert.equal(detail.sections.state, "absent");
    assert.match(
      detail.sections.state === "absent" ? detail.sections.reason : "",
      /schema generation 1, which has no frozen section payloads/u,
    );


    assert.equal(stored?.workflowCode, undefined);
    assert.equal(detail.workflowCode.state, "absent");
    assert.match(
      detail.workflowCode.state === "absent" ? detail.workflowCode.reason : "",
      /schema generation 1, which has no frozen workflow short code/u,
    );
  });

  it("reads an archived row without session grouping forward without changing its digest", () => {
    const world = createWorld(true);
    const { session: _session, ...preD269Row } = ARCHIVED_RUN.row;
    const { contentDigest: _oldDigest, ...historicalContent } = ARCHIVED_RUN;
    const historicalDigest = sha256Hex(`hrauto:archived-run:v1\0${canonicalJsonStringify({ ...historicalContent, row: preD269Row })}`);
    const preD269Record = { ...ARCHIVED_RUN, row: preD269Row, contentDigest: historicalDigest };

    assert.equal(QueueSurfaceWireSchema.safeParse(preD269Row).success, false, "the live queue wire still requires session");
    world.database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.runs.transition({ runId: QUEUED_RUN.envelope.runId, expectedVersion: 1, now: NOW,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert(preD269Record);
      return undefined;
    });

    const stored = world.database.authority.archivedRuns.get(ARCHIVED_RUN.runId);
    assert.equal(stored?.row.session, undefined);
    assert.equal(stored?.contentDigest, historicalDigest);
    assert.deepEqual(buildArchivedRunDetail(emptyRegistryDeps(world), ARCHIVED_RUN.runId).row.session, {
      state: "absent",
      reason: "no session recorded in the archived row",
    });
  });

  it("requires the frozen session arm in archive generation 4", () => {
    const generation4 = {
      ...ARCHIVED_RUN,
      archiveSchemaGeneration: 4,
      sections: ARCHIVED_RUN_WITH_SECTIONS.sections,
      workflowCode: { state: "present" as const, value: "pl" },
      row: {
        ...ARCHIVED_RUN.row,
        session: { state: "absent" as const, reason: "the archived run predates session grouping" },
      },
    };

    assert.equal(CURRENT_ARCHIVE_SCHEMA_GENERATION, 6);
    assert.equal(ArchivedRunRecordSchema.safeParse(generation4).success, true);

    const sections = generation4.sections;
    if (sections === undefined) throw new Error("archive fixture must hold frozen sections");
    const { rows: _rows, ...noteOnlyLog } = sections.logs.state === "present"
      ? sections.logs.value
      : (() => { throw new Error("archive fixture must hold frozen logs"); })();
    assert.equal(
      ArchivedRunRecordSchema.safeParse({
        ...generation4,
        sections: { ...sections, logs: { state: "present", value: noteOnlyLog } },
      }).success,
      true,
      "a pre-L3 archive keeps its note-only log page readable without invented observed rows",
    );

    const { session: _session, ...sessionlessRow } = generation4.row;
    const refusedCurrent = ArchivedRunRecordSchema.safeParse({ ...generation4, row: sessionlessRow });
    assert.equal(refusedCurrent.success, false);
    assert.match(JSON.stringify(refusedCurrent.error?.issues ?? []), /generation 4 or later must carry.*session/u);
  });

  it("requires a combined logs snapshot in generation 5 while reading generation 4 absence forward", () => {
    const sections = ARCHIVED_RUN_WITH_SECTIONS.sections;
    if (sections === undefined) throw new Error("archive fixture must hold frozen sections");
    const absentLogs = {
      ...sections,
      logs: { state: "absent" as const, reason: "logs were not frozen" },
    };

    assert.equal(ArchivedRunRecordSchema.safeParse({
      ...ARCHIVED_RUN,
      archiveSchemaGeneration: 4,
      sections: absentLogs,
      workflowCode: { state: "present" as const, value: "pl" },
      row: {
        ...ARCHIVED_RUN.row,
        session: { state: "absent" as const, reason: "the archived run predates session grouping" },
      },
    }).success, true);

    const refusedCurrent = ArchivedRunRecordSchema.safeParse({
      ...ARCHIVED_RUN,
      archiveSchemaGeneration: 5,
      sections: absentLogs,
      workflowCode: { state: "present" as const, value: "pl" },
      row: {
        ...ARCHIVED_RUN.row,
        session: { state: "absent" as const, reason: "the archived run predates session grouping" },
      },
    });
    assert.equal(refusedCurrent.success, false);
    assert.match(JSON.stringify(refusedCurrent.error?.issues ?? []), /generation 5 or later must freeze the combined logs snapshot/u);
  });

  it("reads a generation-3 archive that already carries the QueueSurface session arm", () => {
    const generation3 = {
      ...ARCHIVED_RUN,
      archiveSchemaGeneration: 3,
      sections: ARCHIVED_RUN_WITH_SECTIONS.sections,
      workflowCode: { state: "present" as const, value: "pl" },
      row: {
        ...ARCHIVED_RUN.row,
        session: { state: "present" as const, sessionId: UUID_4 },
      },
    };

    assert.equal(ArchivedRunRecordSchema.safeParse(generation3).success, true);
  });


  it("refuses an archived record whose frozen code and generation disagree, in both directions", () => {
    const generation3 = {
      ...ARCHIVED_RUN,
      archiveSchemaGeneration: 3,
      sections: ARCHIVED_RUN_WITH_SECTIONS.sections,
      workflowCode: { state: "present" as const, value: "pl" },
    };
    assert.equal(ArchivedRunRecordSchema.safeParse(generation3).success, true);


    const { workflowCode: _dropped, ...codeless } = generation3;
    const refusedCodeless = ArchivedRunRecordSchema.safeParse(codeless);
    assert.equal(refusedCodeless.success, false);
    assert.match(
      JSON.stringify(refusedCodeless.error?.issues ?? []),
      /must carry the workflow's frozen short code/u,
    );

    // And the other direction: a record claiming an older generation cannot
    // carry bytes that generation never had.
    const refusedEarly = ArchivedRunRecordSchema.safeParse({ ...ARCHIVED_RUN, workflowCode: generation3.workflowCode });
    assert.equal(refusedEarly.success, false);
    assert.match(
      JSON.stringify(refusedEarly.error?.issues ?? []),
      /predates the frozen short code/u,
    );

    // Half-resolved: a label present beside an absent code describes a
    // registry lookup that both succeeded and failed.
    const refusedSplit = ArchivedRunRecordSchema.safeParse({
      ...generation3,
      workflowCode: { state: "absent", reason: "person-lookup was already unregistered when this run was archived" },
    });
    assert.equal(refusedSplit.success, false);
    assert.match(JSON.stringify(refusedSplit.error?.issues ?? []), /present or absent together/u);
  });

  it("archives a run that FILED a ledger line, and resolves it back from the archive", () => {

    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    const run = world.database.authority.runs.get(archived);
    assert.notEqual(run, undefined);
    if (run === undefined) return;

    const instance = run.envelope.resolvedInstance.ucpath;
    assert.ok(instance !== undefined, "the filed transaction must retain its UCPath instance");
    const fixture = ledgerCommitFixture(0, {
      runId: archived,
      workflowId: "archive-fixture",
      itemId: run.envelope.itemId,
      traceId: run.envelope.traceId,
      configFingerprint: run.envelope.configFingerprint,
      instance,
      confirmedAt: NOW,

      proof: {
        schemaHash: deriveSchemaHash(UcpathCreateTermination.writeSafety.completion.proofSchema, "output"),
        value: {
          kind: "ucpath-termination",
          emplId: "10873698",
          effectiveDate: "06/11/2026",
          transactionId: "T002209631",
          approvalStatus: "Pending",
          displayedName: "Deterministic Person",
          source: "ss-smart-hr-detail-read",
        },
      },
    });
    assert.equal(
      world.database.authority.writeIntents.fenceAttempt({ intent: fixture.intent, attempt: fixture.attempt }).state,
      "fenced",
    );
    world.database.commitWriteAttempt(fixture.commit, atomicWriteCheckpoint(fixture.commit));
    assert.equal(createTransactionHistory(world.database.authority).query({ from: "2000-01-01", to: "2100-01-01" }).rows.length, 1);

    const before = ledgerBytes(world.stateRoot);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    // The archived record NAMES the line and copies none of it, and the bump
    // left the partition byte-identical — the ledger is an audit lifecycle.
    assert.deepEqual(ledgerBytes(world.stateRoot), before);
    const frozen = JSON.stringify(projectArchiveReport(reportOf(world, archived)));
    assert.ok(frozen.includes("T002209631"));
    assert.ok(frozen.includes("ucpath"));
    assert.ok(frozen.includes("prod"));
    assert.ok(frozen.includes("06/11/2026"));
  });

  it("replays frozen enrichment exactly and refuses divergent or corrupted transaction bytes", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    const original = reportOf(world, archived);
    const storage = createRunLifecycleStorage(world.database);
    const before = world.database.getMeta();
    assert.deepEqual(storage.saveReport(original), original);
    assert.deepEqual(world.database.getMeta(), before);
    assert.throws(() => ArchiveReportSchema.parse({ ...original, content: { ...original.content, capturedAt: "2030-01-01T00:00:00.000Z" } }), /digest-mismatch/u);
    assert.deepEqual(reportOf(world, archived), original);
    const raw = new DatabaseSync(join(world.stateRoot, "..", "archive.sqlite"));
    try { raw.exec("DROP TRIGGER archive_records_immutable"); raw.exec("UPDATE archive_records SET digest='" + "a".repeat(64) + "'"); } finally { raw.close(); }
    assert.throws(() => storage.readReport(archived), /archive/u);
  });

  it("carries the frozen row's resolved instances onto the INDEX entry", () => {
    const world = createWorld();
    world.resolvedInstances = [{ system: "ucpath", instance: "prod" }, { system: "kuali", instance: "test" }];
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    assert.equal(displayValue(world, archived, "row.resolvedInstances.0.system"), "ucpath");
    assert.equal(displayValue(world, archived, "row.resolvedInstances.0.instance"), "prod");
    assert.equal(displayValue(world, archived, "row.resolvedInstances.1.system"), "kuali");
    assert.equal(displayValue(world, archived, "row.resolvedInstances.1.instance"), "test");
    assert.deepEqual(queryArchiveReports(createRunLifecycleStorage(world.database), { limit: 10 }).items, [projectArchiveReport(reportOf(world, archived))]);
  });

  it("carries the frozen row's dry-run flag and warning count onto the INDEX entry", () => {
    const world = createWorld();
    world.warnings = { state: "present", count: 3, first: "CRM returned a stale session on attempt 1" };
    const archived = startRun(world, "10873698", true, true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    assert.equal(displayValue(world, archived, "row.dryRun"), true);
    assert.equal(displayValue(world, archived, "row.warnings.count"), 3);
    assert.equal(displayValue(world, archived, "row.warnings.first"), world.warnings.first);
    assert.deepEqual(queryArchiveReports(createRunLifecycleStorage(world.database), { limit: 10 }).items, [projectArchiveReport(reportOf(world, archived))]);
  });

  it("keeps the two absences apart: a real filing that recorded no warning", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    assert.equal(displayValue(world, archived, "row.dryRun"), false);
    assert.equal(displayValue(world, archived, "row.warnings.state"), "absent");
    const warningReason = displayValue(world, archived, "row.warnings.reason");
    assert.equal(typeof warningReason, "string");
    if (typeof warningReason !== "string") throw new Error("expected saved warning reason");
    assert.match(warningReason, /no warning/u);
  });

  it("serves an EMPTY instance list for a run that resolved no system", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    assert.deepEqual(displayValue(world, archived, "row.resolvedInstances"), []);
  });

  it("leaves the ledger byte-identical across the bump", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;

    // A ledger partition with real content, written before the bump. Nothing
    // in the archive path may read, rewrite, renumber or prune it.
    const ledgerRoot = join(world.stateRoot, "ledger");
    mkdirSync(ledgerRoot, { recursive: true });
    writeFileSync(
      join(ledgerRoot, "ucpath-2026-08-03.jsonl"),
      `{"seq":1,"runId":"${archived}","filed":"real"}\n{"seq":2,"runId":"${archived}","filed":"real"}\n`,
      "utf8",
    );
    const before = ledgerBytes(world.stateRoot);
    assert.equal(before.length, 1);

    assert.equal(apply(world, plan(world)).state, "applied");
    assert.ok(world.database.transferredRun(archived));

    assert.deepEqual(ledgerBytes(world.stateRoot), before);
  });

  it("REFUSES the bump while any prior-version run is non-terminal, and names every one", () => {
    const world = createWorld();
    const terminal = startRun(world, "10873698", true);
    const blocking = startRun(world, "10456712", false);
    world.registry = V2;

    const reviewed = plan(world);
    // The plan is still MINTED — charter §25's flow lists the blockers so the
    // operator can clear them; it is `apply` that refuses.
    const stored = world.database.readVersionChange(reviewed.versionPlanId);
    assert.equal(stored?.blockers.length, 1);
    assert.equal(stored?.blockers[0], blocking);
    assert.equal(stored?.members.length, 1);

    const result = apply(world, reviewed);
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") return;
    assert.equal(result.code, "active-version-blockers");
    const blockingRun = world.database.authority.runs.get(blocking);
    assert.equal(result.message.includes(String(blockingRun?.envelope.traceId)), true, result.message);
    assert.equal(result.message.includes("queued"), true, result.message);


    assert.equal(world.database.authority.archivedRuns.isArchived(terminal), false);
    assert.equal(world.database.authority.archivedRuns.list().length, 0);
    assert.equal(world.database.authority.versionBumpApplications.list().length, 0);
    // The plan is left `planned`, so the SAME reviewed plan applies once the
    // blocker settles — a refused apply is not a spent one.
    assert.equal(world.database.readVersionChange(reviewed.versionPlanId)?.state, "planned");
  });

  it("refuses retired archive relaunch without creating a run or lineage", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    const record = reportOf(world, archived);
    const view = projectArchiveReport(record); assert.ok(view.state === "available");
    for (const fingerprint of [HASH_A, view.archiveFingerprint]) {
      const before = world.database.authority.runs.listByWorkflow("archive-fixture");
      const result = world.kernel.execute({ ...envelope(), family: "version-archive", type: "relaunch-archived-run", target: { archivedRunId: archived, archiveFingerprint: fingerprint } });
      assert.equal(result.state, "rejected");
      if (result.state === "rejected") assert.equal(result.code, "policy-refused");
      assert.deepEqual(world.database.authority.runs.listByWorkflow("archive-fixture"), before);
      assert.deepEqual(reportOf(world, archived), record);
      assert.equal("archiveRelaunches" in world.database.authority, false);
    }
  });


  it("deletes an archived run against the digest its detail served, and refuses any other", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");
    const detail = projectArchiveReport(reportOf(world, archived)); assert.ok(detail.state === "available");
    const request = { ...envelope(), family: "version-archive", type: "delete-archived-run", target: { archivedRunId: archived, archiveFingerprint: detail.archiveFingerprint } };
    const stale = world.kernel.execute({ ...request, commandId: envelope().commandId, target: { ...request.target, archiveFingerprint: HASH_A } });
    assert.equal(stale.state, "rejected");
    if (stale.state === "rejected") assert.equal(stale.code, "schema-mismatch");
    assert.ok(reportOf(world, archived));
    assert.equal(world.database.authority.deletedRuns.get(archived), undefined);
    assert.equal(world.kernel.execute(request).state, "applied");
    assert.equal(world.kernel.execute(request).state, "already-applied");
    assert.equal(createRunLifecycleStorage(world.database).readReport(archived), undefined);
    assert.equal(world.database.authority.runs.get(archived), undefined);
    assert.equal(world.database.authority.deletedRuns.get(archived)?.origin, "archive");
    assert.deepEqual(queryArchiveReports(createRunLifecycleStorage(world.database), { limit: 10 }).items, []);
  });

  it("refuses an apply whose plan was reviewed against a registry that has since moved", () => {
    const world = createWorld();
    startRun(world, "10873698", true);
    world.registry = V2;
    const reviewed = plan(world);

    // A third version lands between review and apply.
    world.registry = descriptorAt(3, "f".repeat(64));
    const result = apply(world, reviewed);
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") return;
    assert.equal(result.code, "policy-refused");
    assert.equal(result.message.includes("re-plan"), true, result.message);
    assert.equal(world.database.authority.archivedRuns.list().length, 0);
  });
});


describe("bump kind semantics", () => {
  it("a minor bump cannot be blocked — it applies while a prior-version run is in flight", () => {
    const world = createWorld();
    const inFlight = startRun(world, "10873698", false);
    world.registry = V2;

    const result = apply(world, plan(world, "minor"));
    assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "minor apply refused");

    // The in-flight run carries on, untouched and unarchived.
    assert.equal(world.database.authority.archivedRuns.isArchived(inFlight), false);
    assert.equal(world.database.authority.runs.get(inFlight)?.lifecycle.state, "queued");
  });

  it("a minor bump archives NOTHING — prior-version terminal runs stay in every live read", () => {
    const world = createWorld();
    const settled = startRun(world, "10873698", true);
    world.registry = V2;

    const result = apply(world, plan(world, "minor"));
    assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "minor apply refused");

    // The run a MAJOR bump would have swept is still live.
    assert.equal(world.database.authority.archivedRuns.isArchived(settled), false);
    assert.equal(world.database.authority.archivedRuns.list().length, 0);

    // The sweep is still RECORDED — the version moved — with an empty archive
    // set and the reviewed change record carried verbatim.
    const applications = world.database.historicalVersionChanges().filter(row => row.state === "applied").map(row => VersionChangeStorageSchema.parse(row));
    assert.equal(applications.length, 1);
    assert.deepEqual([...(applications[0]?.members.map(member => member.runId) ?? ["unread"])], []);
    assert.equal(applications[0]?.change.kind, "minor");

    // And the archive read path serves that sweep as what it is: a version
    // record that took no run with it.
    assert.deepEqual(queryArchiveReports(createRunLifecycleStorage(world.database), { limit: 10 }).items, []);
    assert.equal(applications[0]?.state, "applied");
  });

  it("a minor plan's review copy states what apply will do: no candidates, no blockers", () => {
    const world = createWorld();
    // Both an archivable-looking run and a would-be blocker exist…
    startRun(world, "10873698", true);
    startRun(world, "10456712", false);
    world.registry = V2;

    const reviewed = plan(world, "minor");
    const stored = world.database.readVersionChange(reviewed.versionPlanId);

    assert.deepEqual([...(stored?.members ?? ["unread"])], []);
    assert.deepEqual([...(stored?.blockers ?? ["unread"])], []);
    assert.equal(stored?.change?.kind, "minor");

    // The same registry facts under a MAJOR plan list both — the kind, not
    // the facts, is what changed.
    const major = plan(world);
    const majorStored = world.database.readVersionChange(major.versionPlanId);
    assert.equal(majorStored?.members.length, 1);
    assert.equal(majorStored?.blockers.length, 1);
  });

  it("refuses to apply a generation-1 plan that declares no bump kind, rather than guessing one", () => {
    const world = createWorld(true);

    const inserted = world.database.authority.versionPlans.insert(VERSION_PLAN_ROW);
    assert.equal(inserted.state, "inserted");

    const result = CommandResultSchema.parse(world.kernel.execute({
      ...envelope(),
      family: "version-archive",
      type: "apply-version-bump",
      target: { versionPlanId: VERSION_PLAN_ROW.versionPlanId, expectedVersion: VERSION_PLAN_ROW.version },
      payload: { planFingerprint: VERSION_PLAN_ROW.planFingerprint },
    }));
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") return;
    assert.equal(result.code, "policy-refused");
    assert.equal(result.message.includes("no bump kind"), true, result.message);
    assert.equal(result.message.includes("re-plan"), true, result.message);

    // Fail-closed: nothing archived, nothing applied, the plan not consumed.
    assert.equal(world.database.authority.archivedRuns.list().length, 0);
    assert.equal(world.database.authority.versionBumpApplications.list().length, 0);
    assert.equal(
      world.database.authority.versionPlans.get(VERSION_PLAN_ROW.versionPlanId)?.state,
      "planned",
    );
  });

  it("the boundary schemas make a minor bump that archives or blocks UNREPRESENTABLE", () => {
    const minorRecord = {
      kind: "minor",
      what: "presentation moved inside the same shape",
      why: "nothing about the run's shape changed",
      commit: { state: "absent", reason: "authored in a test" },
    };
    const minorPlan = {
      ...VERSION_BUMP_PLAN,
      archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
      changeRecord: minorRecord,
    };

    assert.equal(VersionBumpPlanSchema.safeParse(minorPlan).success, false);
    assert.equal(
      VersionBumpPlanSchema.safeParse({
        ...minorPlan,
        candidates: [],
        blockers: VERSION_BUMP_PLAN.candidates.map((candidate) => ({ ...candidate, runState: "queued" })),
      }).success,
      false,
    );
    // The same plan with both lists empty is exactly what a minor bump is.
    assert.equal(
      VersionBumpPlanSchema.safeParse({ ...minorPlan, candidates: [], blockers: [] }).success,
      true,
    );

    const minorApplication = {
      ...VERSION_BUMP_APPLICATION,
      archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
      changeRecord: minorRecord,
    };
    // A minor application that swept runs is a recorded contradiction.
    assert.equal(VersionBumpApplicationSchema.safeParse(minorApplication).success, false);
    assert.equal(
      VersionBumpApplicationSchema.safeParse({ ...minorApplication, archivedRunIds: [] }).success,
      true,
    );
  });

  it("a major bump's archive set is EXACTLY the affected set — every prior-version terminal run, nothing else", () => {
    const world = createWorld();
    const priorA = startRun(world, "10873698", true);
    const priorB = startRun(world, "10456712", true);
    world.registry = V2;
    const current = startRun(world, "10800000", true);

    const result = apply(world, plan(world));
    assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "major apply refused");


    const applications = world.database.historicalVersionChanges().filter(row => row.state === "applied").map(row => VersionChangeStorageSchema.parse(row));
    assert.equal(applications.length, 1);
    assert.deepEqual([...(applications[0]?.members.map(member => member.runId) ?? [])].sort(), [priorA, priorB].sort());
    assert.equal(applications[0]?.change.kind, "major");

    const storage = createRunLifecycleStorage(world.database);
    assert.deepEqual(queryArchiveReports(storage, { limit: 10 }).items.map(item => item.state === "available" ? item.runId : "missing").sort(), [priorA, priorB].sort());
    assert.equal(storage.readReport(current), undefined);
    assert.equal(world.database.historicalArchiveSource().source.archives.length, 0);
    const report = reportOf(world, priorA);
    assert.equal(sha256Hex(report.content.sources[0].json), report.content.sources[0].digest);
    assert.equal(world.database.authority.runs.get(priorA), undefined);
  });
});
