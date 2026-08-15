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
import { EidSchema } from "../../src/domain/ids.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { FixtureReadReceipt } from "./architecture/helpers/descriptor-fixtures.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { buildArchiveIndex, buildArchivedRunDetail } from "../../src/server/dashboard/queries/archive.js";
import type { ArchiveRunSnapshot } from "../../src/services/archive/archive-service.js";
import { planStart } from "../../src/services/start/plan.js";
import { HASH_A, HASH_B, NOW, UUID_4 } from "./fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";

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
      .build({
        schema: z.strictObject({ eid: EidSchema }),
        dependsOn: ["probe"],
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
}) {
  return {
    snapshot(runId: string): ArchiveRunSnapshot {
      const run = world.database.authority.runs.get(runId);
      if (run === undefined) throw new Error(`no run ${runId} to snapshot`);
      const status = "done" as const;
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
          startedAt: NOW,
          updatedAt: NOW,
          endedAt: { state: "present", value: NOW },
          gateOpenedAt: { state: "absent", reason: "an archived run is not waiting on a gate" },
          displayName: { state: "absent", reason: "the operator has not renamed this run" },
          title: `EID ${run.envelope.itemId.slice(0, 8)}`,
          subtitle: { state: "absent", reason: "the start plan proposed no subtitle" },
          status,
          liveMessage: { state: "absent", reason: "an archived run has no live message" },
          warnings: { state: "absent", reason: "this run's evidence receipt records no warning" },
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
          outcome: { state: "terminal", result: "verified-done", completedAt: NOW },
          context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
          availableSections: ["logs"],
        },
        failure: { state: "absent", reason: "the run did not settle with a structured failure" },
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
  const ids = sequentialIdFactory("a");
  const world: World = {
    database,
    stateRoot,
    registry: V1,
    ids,
    resolvedInstances: [],
    kernel: undefined as unknown as CommandKernel,
  };
  world.kernel = createCommandKernel({
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
    configIdentity: UNSTORED_CONFIG_IDENTITY,
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
function startRun(world: World, eid: string, terminal: boolean): string {
  const plan = planStart(
    { authority: world.database, clock: manualClock(new Date(NOW)), ids: world.ids, planTtlMs: 600_000 },
    {
      descriptor: world.registry,
      submissions: [{ eid }],
      dryRun: false,
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
  const runId = plan.planned[0].runId;
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

function plan(world: World): { versionPlanId: string; expectedVersion: number; planFingerprint: string } {
  const result = CommandResultSchema.parse(world.kernel.execute({
    ...envelope(),
    family: "version-archive",
    type: "plan-version-bump",
    target: { scope: { kind: "workflows", workflowIds: ["archive-fixture"] } },
    payload: { targetVersion: "0.2.0", changeFingerprint: HASH_B },
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

    /*
      Doc 13 §8 guard #11 the only way it proves anything: the descriptor list
      the query is handed is EMPTY, so nothing on the read path can resolve the
      version this run executed — or any version at all.
      */
    const deps = {
      clock: manualClock(new Date(NOW)),
      appVersion: "0.1.0",
      authority: { withAuthorityTransaction: (work: never) => world.database.withAuthorityTransaction(work) },
      descriptors: { list: () => [] },
    } as unknown as Parameters<typeof buildArchivedRunDetail>[0];

    const detail = buildArchivedRunDetail(deps, archived);
    assert.equal(detail.runId, archived);
    assert.equal(detail.row.title.length > 0, true);
    assert.equal(detail.detail.header.runId, archived);
    assert.equal(detail.archivedIdentity.descriptorVersion, 1);
    // The one thing the empty registry legitimately costs: a relaunch has no
    // current version to start, and the wire says so instead of offering one.
    assert.equal(detail.relaunch.state, "unavailable");

    // And the index reads too, with no registered workflow to describe.
    const index = buildArchiveIndex(deps);
    assert.equal(index.entries.length, 1);
    assert.equal(index.versionState.length, 0);
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
      target: { archivedRunId: archived, archiveFingerprint: String(record?.contentDigest) },
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
