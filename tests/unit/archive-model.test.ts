import { archivedRunReferenceFingerprint } from "../../src/domain/archive/model.js";
import { RunRecordService } from "../../src/core/run-record-service.js";
/**
 * The D80 archive model, clause by clause (2i-G, D179).
 *
 * Phase 2's exit criterion reads: *"a version bump moves prior-version runs
 * into a read-only Archive, an archived run renders with zero old-version code
 * paths, the ledger is untouched, relaunch starts a fresh current-version run,
 * and a bump REFUSES while any prior-version run is non-terminal."* Each `it`
 * below pins exactly one of those five clauses against the REAL authority
 * database and the REAL command kernel — no repository fake, no stubbed
 * projection, and every assertion is on a durable row or on bytes on disk
 * rather than on a log line.
 *
 * The descriptor "bump" is simulated the way it really happens: the registry
 * the kernel resolves against is swapped for one whose version and
 * `contractFingerprint` have moved, which is precisely what a source edit plus
 * `npm run build:manifest` produces. Nothing here rewrites a stored run.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import { createCommandKernel, type CommandKernel } from "../../src/core/command-kernel.js";
import { manualClock } from "../../src/domain/clock.js";
import { CommandResultSchema, type CommandResult } from "../../src/domain/commands.js";
import { QueueSurfaceWireSchema } from "../../src/domain/dashboard/projection.js";
import { EidSchema } from "../../src/domain/ids.js";
import { directIdentifierDigestReference } from "../../src/domain/redaction.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { FixtureReadReceipt } from "./architecture/helpers/descriptor-fixtures.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { buildArchiveIndex, buildArchivedRunDetail } from "../../src/server/dashboard/queries/archive.js";
import {
  archivedRunContentDigest,
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
  CURRENT_ARCHIVE_SCHEMA_GENERATION,
  VersionBumpApplicationSchema,
  VersionBumpPlanSchema,
} from "../../src/domain/archive/model.js";
import { RunEvidenceReceiptSchema } from "../../src/domain/trust/evidence.js";
import { createLedgerReadThrough } from "../../src/infra/ledger/ledger-read-through.js";
import { createLedgerProjector } from "../../src/infra/ledger/index.js";
import { UcpathCreateTermination } from "../../src/domain/contracts/ucpath/create-termination.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import type { ArchiveRunSnapshot } from "../../src/services/archive/archive-service.js";
import { planStart } from "../../src/services/start/plan.js";
import { HASH_A, HASH_B, NOW, UUID_4 } from "./fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "./fixtures/operator-command-fixtures.js";
import { WriteFixtureCommit, WriteFixturePrepare } from "./fixtures/write-sequencer-fixtures.js";
import {
  ARCHIVED_RUN,
  ARCHIVED_RUN_WITH_SECTIONS,
  VERSION_BUMP_APPLICATION,
  VERSION_BUMP_PLAN,
  VERSION_PLAN_ROW,
} from "./fixtures/archive-fixtures.js";
import { ledgerCommitFixture } from "./fixtures/ledger-projection-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";

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

/**
 * ONE workflow at two versions. A real bump is a source edit plus
 * `npm run build:manifest`, which is exactly what changing `version` and
 * `contractFingerprint` together produces — and nothing about a bump ever
 * rewrites a stored run, which is why the fixture swaps the REGISTRY the
 * kernel resolves through rather than touching authority.
 */
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
      // The archive fixture must be capable of producing a REAL rehearsal
      // envelope. Dry-run support is derived from transaction nodes (D209), so
      // a read-only graph would correctly refuse the start before this suite
      // could prove that Archive preserves `dryRun:true`.
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
  /**
   * What the frozen row will claim this run resolved. Mutable so one test can
   * archive a run that touched a TEST instance and read the fact back off the
   * INDEX entry, which is the only place it was previously unavailable.
   */
  resolvedInstances: readonly { system: string; instance: "prod" | "test" }[];
  /**
   * What the frozen row will claim this run WARNED about. Mutable for the same
   * reason `resolvedInstances` is: the index entry copies the row's own field,
   * and the only way to prove a copy is to move the thing being copied.
   */
  warnings:
    | { state: "present"; count: number; first: string }
    | { state: "absent"; reason: string };
}

/**
 * A snapshot source that returns a MINIMAL but schema-valid frozen pair. The
 * production one is `createArchiveSnapshotSource` over the run/queue
 * projection; this suite is about the archive's durable semantics, and wiring
 * a whole JSONL projection here would test the projection instead.
 */
function snapshotSource(world: {
  database: AuthorityDatabase;
  resolvedInstances?: readonly { system: string; instance: "prod" | "test" }[];
  warnings?:
    | { state: "present"; count: number; first: string }
    | { state: "absent"; reason: string };
}) {
  return {
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
          // D230: the archived row freezes the ordinal the live row carried;
          // a run enqueued before schema v15 froze an absence, and resolving
          // one now would be back-filling on the archive's read path.
          runNumber: run.runNumber === undefined
            ? { state: "absent", reason: "enqueued before runs carried a workflow ordinal (D230)" }
            : { state: "present", value: run.runNumber },
          // D269: the same read-forward shape for the session the live row carried.
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
        /*
         * D223's frozen sections. The production seam builds these from the
         * span fold and the note stream; this suite is about the archive's
         * durable semantics, so the payloads are minimal and REAL — a note
         * line that comes back verbatim is what proves the freeze rather than
         * a re-derivation.
         */
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
              editing: { state: "locked", reason: "an archived run is read-only" },
              entries: [{
                label: "eid",
                valueRedacted: "108*****",
                edit: { state: "locked", reason: "an archived run is read-only" },
              }],
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

function createWorld(): World {
  const root = mkdtempSync(join(tmpdir(), "hrauto-archive-"));
  roots.push(root);
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot, { recursive: true });
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
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
      // Charter §25's change record, authored at plan time and carried into
      // the application verbatim. Without it a sweep can say who and when, and
      // nothing about why.
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
  const stored = world.database.authority.versionPlans.get(
    target?.family === "version-archive" ? target.versionPlanId : "",
  );
  assert.notEqual(stored, undefined);
  return {
    versionPlanId: String(stored?.versionPlanId),
    expectedVersion: Number(stored?.version),
    planFingerprint: String(stored?.planFingerprint),
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

/**
 * The archive read deps with an EMPTY descriptor list — ref frontend-backend-integration §8 guard #11
 * the only way it proves anything. Nothing on the read path can resolve the
 * version this run executed, or any version at all. The ledger read-through is
 * over the SAME state root the world writes to, so a pointer this test
 * archived resolves the way production would.
 */
function emptyRegistryDeps(world: World): Parameters<typeof buildArchivedRunDetail>[0] {
  return {
    clock: manualClock(new Date(NOW)),
    appVersion: "0.1.0",
    authority: { withAuthorityTransaction: (work: never) => world.database.withAuthorityTransaction(work) },
    descriptors: { list: () => [] },
    ledger: createLedgerReadThrough(world.stateRoot),
  } as unknown as Parameters<typeof buildArchivedRunDetail>[0];
}

/** Every byte under a ledger root, so "untouched" can be asserted literally. */
function ledgerBytes(stateRoot: string): readonly [string, string][] {
  const ledgerRoot = join(stateRoot, "ledger");
  return readdirSync(ledgerRoot)
    .sort()
    .map((name) => [name, readFileSync(join(ledgerRoot, name), "utf8")] as const);
}

describe("the D80 archive model", () => {
  it("moves prior-version runs into the archive and out of every live read", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    const current = (() => {
      world.registry = V2;
      return startRun(world, "10456712", true);
    })();

    assert.equal(world.database.authority.archivedRuns.isArchived(archived), false);
    const result = apply(world, plan(world));
    assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "apply refused");

    // The prior-version run is archived; the current-version one is not.
    assert.equal(world.database.authority.archivedRuns.isArchived(archived), true);
    assert.equal(world.database.authority.archivedRuns.isArchived(current), false);

    // Both run rows still exist: archiving is a DISPLAY lifecycle, not a delete.
    assert.notEqual(world.database.authority.runs.get(archived), undefined);

    const record = world.database.authority.archivedRuns.get(archived);
    assert.equal(record?.archivedIdentity.descriptorVersion, 1);
    assert.equal(record?.archivedIdentity.contractFingerprint, HASH_A);
    assert.deepEqual([...(record?.drift ?? [])], ["descriptor-version", "contract-fingerprint"]);
    // Charter §25: the app build a run was ENQUEUED under is stamped and kept.
    assert.deepEqual(record?.appVersion, { state: "present", value: "0.1.0" });
  });

  it("renders an archived run with the workflow registry EMPTY — zero old-version code paths", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const detail = buildArchivedRunDetail(emptyRegistryDeps(world), archived);
    assert.equal(detail.runId, archived);
    assert.equal(detail.row.title.length > 0, true);
    assert.equal(detail.detail.header.runId, archived);
    assert.equal(detail.archivedIdentity.descriptorVersion, 1);
    // The one thing the empty registry legitimately costs: a relaunch has no
    // current version to start, and the wire says so instead of offering one.
    assert.equal(detail.relaunch.state, "unavailable");

    // And the index reads too, with no registered workflow to describe.
    const index = buildArchiveIndex(emptyRegistryDeps(world));
    assert.equal(index.entries.length, 1);
    assert.equal(index.versionState.length, 0);
  });

  it("serves all five tabs' frozen payloads with the workflow registry EMPTY", () => {
    /*
     * D223's acceptance bar, and the reason the sections are FROZEN rather
     * than fetched: the descriptor list is empty, there is no live run to ask,
     * and every tab still has its bytes. A section that resolved anything at
     * read time would fail here — which is exactly what `archive-invariants`
     * proves structurally, one level up.
     */
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const detail = buildArchivedRunDetail(emptyRegistryDeps(world), archived);
    assert.equal(detail.sections.state, "present");
    if (detail.sections.state !== "present") return;
    const { logs, data, people, attempts, captures } = detail.sections.value;

    assert.equal(logs.state, "present");
    assert.equal(logs.state === "present" ? logs.value.notes[0]?.message : "", "frozen log line");
    assert.equal(data.state, "present");
    assert.equal(data.state === "present" ? data.value.entries[0]?.label : "", "eid");
    assert.equal(attempts.state, "present");
    assert.equal(attempts.state === "present" ? attempts.value[0]?.attempt : 0, 1);
    // Both absences carry their own sentence: this run fanned out no members
    // and captured no artifact, which are facts about the RUN — a record that
    // predates the frozen block says something else entirely (below).
    assert.equal(people.state, "absent");
    assert.equal(captures.state, "absent");
    assert.match(captures.state === "absent" ? captures.reason : "", /captured no diagnostic artifact/u);
  });

  it.each([5, 6])("withholds protected generation-%s receipt, failure, queue, and log diagnostics without rewriting the archive", (generation) => {
    const world = createWorld();
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
        session: { state: "absent", reason: "archived before session grouping" },
        liveMessage: { state: "present", value: raw },
        warnings: { state: "present", count: 1, first: raw },
      },
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
    assert.deepEqual(projected.row.warnings, { state: "absent", reason: expectedWarningReason });
    assert.equal(JSON.stringify(projected).includes(raw), false);
    assert.equal(projected.receipt.state, "absent");
    assert.equal(projected.failure.state, "absent");
    assert.equal(projected.row.liveMessage.state, "absent");
    assert.equal(projected.sections.state, "absent");
    assert.equal(JSON.stringify(world.database.authority.archivedRuns.get(historical.runId)).includes(raw), true);
  });

  it("reads a PRE-D223 record forward and fabricates no tab for it", () => {
    /*
     * D133's rule on the archive's own schema. A generation-1 record is stored
     * exactly as it was written; the reader admits it, and the wire says the
     * payloads were never captured rather than serving empty panels that would
     * read as "this run did nothing".
     */
    const world = createWorld();
    world.database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert(ARCHIVED_RUN);
      return undefined;
    });

    const stored = world.database.authority.archivedRuns.get(ARCHIVED_RUN.runId);
    assert.equal(stored?.archiveSchemaGeneration, 1);
    assert.equal(stored?.sections, undefined);
    // The stored digest is BYTE-IDENTICAL to the one the record was written
    // with: canonical JSON omits an absent key, so a generation-1 row's
    // identity did not move when generation 2 was added.
    assert.equal(stored?.contentDigest, ARCHIVED_RUN.contentDigest);

    const detail = buildArchivedRunDetail(emptyRegistryDeps(world), ARCHIVED_RUN.runId);
    assert.equal(detail.archiveSchemaGeneration, 1);
    assert.equal(detail.sections.state, "absent");
    assert.match(
      detail.sections.state === "absent" ? detail.sections.reason : "",
      /schema generation 1, which predates D223/u,
    );

    // The SAME rule for D242's frozen short code, one generation later. The
    // record holds no code, the wire says so and names its generation, and
    // nothing derives one from the trace id's `pl-` prefix — which would look
    // right and be wrong for a run planned under a code since changed.
    assert.equal(stored?.workflowCode, undefined);
    assert.equal(detail.workflowCode.state, "absent");
    assert.match(
      detail.workflowCode.state === "absent" ? detail.workflowCode.reason : "",
      /schema generation 1, which predates D242's frozen workflow short code/u,
    );
  });

  it("reads a pre-D269 archived row forward without changing its stored digest", () => {
    const world = createWorld();
    const { session: _session, ...preD269Row } = ARCHIVED_RUN.row;
    const historicalDigest = "d".repeat(64);
    const preD269Record = { ...ARCHIVED_RUN, row: preD269Row, contentDigest: historicalDigest };

    assert.equal(QueueSurfaceWireSchema.safeParse(preD269Row).success, false, "the live queue wire still requires session");
    world.database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
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
      reason: "no session recorded (archived before D269)",
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

  /**
   * The generation-3 writer rules (D242), asserted at the schema rather than
   * through a sweep: a WRITER may not adopt the read-forward shape, and the
   * label and the code come from ONE registry lookup so they cannot disagree
   * about whether the descriptor resolved.
   */
  it("refuses an archived record whose frozen code and generation disagree, in both directions", () => {
    const generation3 = {
      ...ARCHIVED_RUN,
      archiveSchemaGeneration: 3,
      sections: ARCHIVED_RUN_WITH_SECTIONS.sections,
      workflowCode: { state: "present" as const, value: "pl" },
    };
    assert.equal(ArchivedRunRecordSchema.safeParse(generation3).success, true);

    // A generation-3 record that names no code would be indistinguishable from
    // one written before codes were frozen.
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
      /predates D242's frozen short code/u,
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
    /*
     * The end-to-end shape `docs/rebuild/findings/archive.md` was missing: a REAL
     * fenced-and-committed write intent, a REAL projected ledger line on disk,
     * and an archived record that names it by `(system, date, sequence)` and
     * copies nothing. Everything below is durable state or bytes on disk.
     */
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    const run = world.database.authority.runs.get(archived);
    assert.notEqual(run, undefined);
    if (run === undefined) return;

    const fixture = ledgerCommitFixture(0, {
      runId: archived,
      workflowId: "archive-fixture",
      itemId: run.envelope.itemId,
      traceId: run.envelope.traceId,
      confirmedAt: NOW,
      // The UCPath termination's OWN proof, so the archived line resolves
      // through `LEDGER_PRESENTATION_DECLARATIONS` rather than through the
      // undeclared fallback — the declaration and the archive meet here.
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
    world.database.commitWriteAttempt(fixture.commit);
    const projected = createLedgerProjector(
      world.database,
      manualClock(new Date(NOW)),
      { stateRoot: world.stateRoot, projectorId: "archive-model-test", leaseMs: 30_000 },
    ).projectAll();
    assert.equal(projected.length, 1);
    assert.equal(projected[0]?.state, "projected");

    const before = ledgerBytes(world.stateRoot);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    // The archived record NAMES the line and copies none of it, and the bump
    // left the partition byte-identical — the ledger is an audit lifecycle.
    const stored = world.database.authority.archivedRuns.get(archived);
    assert.deepEqual(
      stored?.evidence.ledgerPartitions.map((pointer) => ({ ...pointer })),
      [{ system: "ucpath", date: NOW.slice(0, 10), sequence: 0 }],
    );
    assert.deepEqual(ledgerBytes(world.stateRoot), before);

    // And the archived detail resolves it — with the registry EMPTY, because a
    // ledger line is interpreted by its commit contract, never by a descriptor.
    const detail = buildArchivedRunDetail(emptyRegistryDeps(world), archived);
    assert.equal(detail.ledger.length, 1);
    const [line] = detail.ledger;
    assert.equal(line.state, "resolved");
    if (line.state !== "resolved") return;
    assert.equal(line.system, "ucpath");
    assert.equal(line.instance, "prod");
    assert.deepEqual({ ...line.action }, {
      state: "present",
      value: `Termination for ${directIdentifierDigestReference("10873698")} effective 06/11/2026 (Pending)`,
    });
    assert.deepEqual({ ...line.confirmation }, { state: "present", value: "T002209631" });
  });

  it("carries the frozen row's resolved instances onto the INDEX entry", () => {
    const world = createWorld();
    world.resolvedInstances = [
      { system: "ucpath", instance: "prod" },
      { system: "kuali", instance: "test" },
    ];
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const deps = {
      clock: manualClock(new Date(NOW)),
      appVersion: "0.1.0",
      authority: { withAuthorityTransaction: (work: never) => world.database.withAuthorityTransaction(work) },
      descriptors: { list: () => [] },
      // The read-through over the SAME state root the world writes to, so a
      // pointer this test archived resolves the way production would.
      ledger: createLedgerReadThrough(world.stateRoot),
    } as unknown as Parameters<typeof buildArchiveIndex>[0];

    const entry = buildArchiveIndex(deps).entries[0];
    // The index and the detail must name the SAME instances — the entry is a
    // copy of the frozen row's own field, not a second derivation of it.
    assert.deepEqual([...entry.resolvedInstances], [
      { system: "ucpath", instance: "prod" },
      { system: "kuali", instance: "test" },
    ]);
    assert.deepEqual(
      [...buildArchivedRunDetail(deps, archived).row.resolvedInstances],
      [...entry.resolvedInstances],
    );
  });

  it("carries the frozen row's dry-run flag and warning count onto the INDEX entry", () => {
    const world = createWorld();
    world.warnings = { state: "present", count: 3, first: "CRM returned a stale session on attempt 1" };
    // A REHEARSAL. Until the index carried the flag, the only way to tell this
    // row apart from a real filing was to open it — which is the hazard, not
    // the inconvenience: a dry run and a submitted transaction rendered
    // identically in the one list an operator scans before acting.
    const archived = startRun(world, "10873698", true, true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const deps = {
      clock: manualClock(new Date(NOW)),
      appVersion: "0.1.0",
      authority: { withAuthorityTransaction: (work: never) => world.database.withAuthorityTransaction(work) },
      descriptors: { list: () => [] },
      ledger: createLedgerReadThrough(world.stateRoot),
    } as unknown as Parameters<typeof buildArchiveIndex>[0];

    const entry = buildArchiveIndex(deps).entries[0];
    assert.equal(entry.dryRun, true);
    assert.deepEqual({ ...entry.warnings }, {
      state: "present",
      count: 3,
      first: "CRM returned a stale session on attempt 1",
    });

    // Both are COPIES of the frozen row, not second derivations — so the list
    // and the run's own page can never disagree about whether it wrote.
    const detail = buildArchivedRunDetail(deps, archived);
    assert.equal(entry.dryRun, detail.row.dryRun);
    assert.deepEqual({ ...entry.warnings }, { ...detail.row.warnings });
  });

  it("keeps the two absences apart: a real filing that recorded no warning", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const deps = {
      clock: manualClock(new Date(NOW)),
      appVersion: "0.1.0",
      authority: { withAuthorityTransaction: (work: never) => world.database.withAuthorityTransaction(work) },
      descriptors: { list: () => [] },
      ledger: createLedgerReadThrough(world.stateRoot),
    } as unknown as Parameters<typeof buildArchiveIndex>[0];

    const entry = buildArchiveIndex(deps).entries.find((candidate) => candidate.runId === archived);
    assert.equal(entry?.dryRun, false);
    // NOT a silent zero: the absent arm states WHY there is no count, which is
    // what separates "this run recorded no warning" from "nothing has derived
    // this run's warnings yet". A chip drawn from a zero could not tell them
    // apart, and the surface draws no chip for either.
    assert.equal(entry?.warnings.state, "absent");
    if (entry?.warnings.state !== "absent") return;
    assert.match(entry.warnings.reason, /no warning/);
  });

  it("serves an EMPTY instance list for a run that resolved no system", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const deps = {
      clock: manualClock(new Date(NOW)),
      appVersion: "0.1.0",
      authority: { withAuthorityTransaction: (work: never) => world.database.withAuthorityTransaction(work) },
      descriptors: { list: () => [] },
      // The read-through over the SAME state root the world writes to, so a
      // pointer this test archived resolves the way production would.
      ledger: createLedgerReadThrough(world.stateRoot),
    } as unknown as Parameters<typeof buildArchiveIndex>[0];

    const entry = buildArchiveIndex(deps).entries.find((candidate) => candidate.runId === archived);
    // An empty list is the honest value, and the surface reads it as
    // production: "touched a test instance" is a claim nothing here supports.
    assert.deepEqual([...(entry?.resolvedInstances ?? [{ system: "x", instance: "test" }])], []);
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
    assert.equal(world.database.authority.archivedRuns.isArchived(archived), true);

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
    const stored = world.database.authority.versionPlans.get(reviewed.versionPlanId);
    assert.equal(stored?.plan.blockers.length, 1);
    assert.equal(stored?.plan.blockers[0]?.runId, blocking);
    assert.equal(stored?.plan.candidates.length, 1);

    const result = apply(world, reviewed);
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") return;
    assert.equal(result.code, "active-version-blockers");
    const blockingRun = world.database.authority.runs.get(blocking);
    assert.equal(result.message.includes(String(blockingRun?.envelope.traceId)), true, result.message);
    assert.equal(result.message.includes("queued"), true, result.message);

    // Fail-closed: NOTHING was archived, not even the run that was eligible.
    assert.equal(world.database.authority.archivedRuns.isArchived(terminal), false);
    assert.equal(world.database.authority.archivedRuns.list().length, 0);
    assert.equal(world.database.authority.versionBumpApplications.list().length, 0);
    // The plan is left `planned`, so the SAME reviewed plan applies once the
    // blocker settles — a refused apply is not a spent one.
    assert.equal(world.database.authority.versionPlans.get(reviewed.versionPlanId)?.state, "planned");
  });

  it("relaunches an archived run as a FRESH run on the CURRENT version", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const record = world.database.authority.archivedRuns.get(archived);
    assert.notEqual(record, undefined);

    const result = CommandResultSchema.parse(world.kernel.execute({
      ...envelope(),
      family: "version-archive",
      type: "relaunch-archived-run",
      target: { archivedRunId: archived, archiveFingerprint: archivedRunReferenceFingerprint(ArchivedRunRecordSchema.parse(record)) },
    }));
    assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "relaunch refused");
    if (result.state !== "applied") return;

    const fresh = result.affectedTargets.find((target) => target.family === "run");
    assert.notEqual(fresh, undefined);
    if (fresh?.family !== "run") return;
    assert.notEqual(fresh.runId, archived, "a relaunch is a new run, never the archived one");

    const run = world.database.authority.runs.get(fresh.runId);
    // The FRESH run carries the CURRENT identity, not the archived one.
    assert.equal(run?.envelope.descriptorVersion, 2);
    assert.equal(run?.envelope.contractFingerprint, HASH_B);
    assert.equal(run?.lifecycle.state, "queued");
    assert.equal(run?.envelope.retryOf, undefined, "a relaunch is not a retry");

    // The archived run is untouched and STILL archived.
    assert.equal(world.database.authority.archivedRuns.isArchived(archived), true);
    assert.deepEqual(world.database.authority.archivedRuns.get(archived), record);

    // The link is its own insert-only fact.
    const relaunches = world.database.authority.archiveRelaunches.listByArchivedRun(archived);
    assert.equal(relaunches.length, 1);
    assert.equal(relaunches[0]?.runId, fresh.runId);
    assert.equal(relaunches[0]?.relaunchedIdentity.descriptorVersion, 2);

    // A relaunch citing a digest the record does not hold is refused.
    const stale = CommandResultSchema.parse(world.kernel.execute({
      ...envelope(),
      family: "version-archive",
      type: "relaunch-archived-run",
      target: { archivedRunId: archived, archiveFingerprint: HASH_A },
    }));
    assert.equal(stale.state, "rejected");
    if (stale.state === "rejected") assert.equal(stale.code, "schema-mismatch");
  });

  /**
   * D308 — the Archive's DELETE door, from the digest the surface reads to the
   * rows that leave. The dashboard half (the confirm, the envelope, the
   * navigation) is pressed in `tests/unit/dashboard/archive-delete-door.test.ts`;
   * this is the half only real authority can answer.
   */
  it("deletes an archived run against the digest its detail served, and refuses any other", () => {
    const world = createWorld();
    const archived = startRun(world, "10873698", true);
    world.registry = V2;
    assert.equal(apply(world, plan(world)).state, "applied");

    const record = world.database.authority.archivedRuns.get(archived);
    assert.notEqual(record, undefined);

    /*
      What the ARCHIVED DETAIL serves is what the delete cites back. The
      surface reads no other digest, so this equality is the whole reason
      `schema-mismatch` can mean "you are looking at a different record".
    */
    const detail = buildArchivedRunDetail(emptyRegistryDeps(world), archived);
    assert.equal(detail.archiveFingerprint, archivedRunReferenceFingerprint(ArchivedRunRecordSchema.parse(record)));

    // A delete citing a digest the record does not hold removes NOTHING.
    const stale = CommandResultSchema.parse(world.kernel.execute({
      ...envelope(),
      family: "version-archive",
      type: "delete-archived-run",
      target: { archivedRunId: archived, archiveFingerprint: HASH_A },
    }));
    assert.equal(stale.state, "rejected");
    if (stale.state === "rejected") assert.equal(stale.code, "schema-mismatch");
    assert.equal(world.database.authority.archivedRuns.isArchived(archived), true);
    assert.notEqual(world.database.authority.runs.get(archived), undefined);
    assert.equal(world.database.authority.deletedRuns.get(archived), undefined);

    // The served digest opens it.
    const result = CommandResultSchema.parse(world.kernel.execute({
      ...envelope(),
      family: "version-archive",
      type: "delete-archived-run",
      target: { archivedRunId: archived, archiveFingerprint: detail.archiveFingerprint },
    }));
    assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "delete refused");

    // The archived record, the retained run, and the ledger row are gone —
    // behind the one tombstone that records the origin they left through.
    assert.equal(world.database.authority.archivedRuns.get(archived), undefined);
    assert.equal(world.database.authority.archivedRuns.isArchived(archived), false);
    assert.equal(world.database.authority.runs.get(archived), undefined);
    assert.equal(world.database.authority.deletedRuns.get(archived)?.origin, "archive");

    // The ledger the surface returns to no longer lists it, and its detail
    // route refuses by name rather than serving a hollow record.
    assert.equal(
      buildArchiveIndex(emptyRegistryDeps(world)).entries.some((entry) => entry.runId === archived),
      false,
    );
    assert.throws(() => buildArchivedRunDetail(emptyRegistryDeps(world), archived));
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

/**
 * D274 (ref dashboard-surfaces §9.5.1): "A MINOR bump archives nothing and
 * cannot be blocked: it records the new version without moving prior-version
 * runs … A MINOR bump archives nothing, so non-terminal runs do not block it."
 * A MAJOR bump keeps the D80 semantics the suite above pins: it archives the
 * affected set and refuses while any prior-version run is non-terminal.
 */
describe("D274 — bump kind semantics", () => {
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
    const applications = world.database.authority.versionBumpApplications.list();
    assert.equal(applications.length, 1);
    assert.deepEqual([...(applications[0]?.archivedRunIds ?? ["unread"])], []);
    assert.equal(applications[0]?.changeRecord?.kind, "minor");

    // And the archive read path serves that sweep as what it is: a version
    // record that took no run with it.
    const index = buildArchiveIndex(emptyRegistryDeps(world));
    assert.equal(index.entries.length, 0);
    assert.equal(index.sweeps.length, 1);
    assert.equal(index.sweeps[0]?.archivedCount, 0);
    assert.deepEqual([...(index.sweeps[0]?.fromVersions ?? ["unread"])], []);
  });

  it("a minor plan's review copy states what apply will do: no candidates, no blockers", () => {
    const world = createWorld();
    // Both an archivable-looking run and a would-be blocker exist…
    startRun(world, "10873698", true);
    startRun(world, "10456712", false);
    world.registry = V2;

    const reviewed = plan(world, "minor");
    const stored = world.database.authority.versionPlans.get(reviewed.versionPlanId);
    // …and the MINOR plan lists neither: its candidates are "what apply will
    // archive" and its blockers are "what apply will refuse on", and for a
    // minor bump both are empty by definition (D274). Listing them would be a
    // review copy that lies about the sweep it reviews.
    assert.deepEqual([...(stored?.plan.candidates ?? ["unread"])], []);
    assert.deepEqual([...(stored?.plan.blockers ?? ["unread"])], []);
    assert.equal(stored?.plan.changeRecord?.kind, "minor");

    // The same registry facts under a MAJOR plan list both — the kind, not
    // the facts, is what changed.
    const major = plan(world);
    const majorStored = world.database.authority.versionPlans.get(major.versionPlanId);
    assert.equal(majorStored?.plan.candidates.length, 1);
    assert.equal(majorStored?.plan.blockers.length, 1);
  });

  it("refuses to apply a generation-1 plan that declares no bump kind, rather than guessing one", () => {
    const world = createWorld();
    // A stored generation-1 plan predates charter §25's change record: those
    // bytes are on disk and nothing may back-fill them, so it names NO kind.
    // Guessing major would archive runs nobody reviewed for archival; guessing
    // minor would silently downgrade a sweep to a no-op.
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
    // A minor plan carrying a candidate — or a blocker — is a stored claim
    // that a minor bump will archive or can be refused, which D274 forbids.
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

    // The application row names exactly the two prior-version runs.
    const applications = world.database.authority.versionBumpApplications.list();
    assert.equal(applications.length, 1);
    assert.deepEqual([...(applications[0]?.archivedRunIds ?? [])].sort(), [priorA, priorB].sort());
    assert.equal(applications[0]?.changeRecord?.kind, "major");

    // And the archive holds exactly those two — the current-version run stays.
    assert.deepEqual(
      world.database.authority.archivedRuns.list().map(({ runId }) => runId).sort(),
      [priorA, priorB].sort(),
    );
    assert.equal(world.database.authority.archivedRuns.isArchived(current), false);
  });
});
