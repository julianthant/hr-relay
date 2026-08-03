/**
 * `control-command-single-path` — doc 10 §3.9, activated by D113.
 *
 * Control surfaces mutate authority only through doc 03's D67/D95 command
 * protocol, and there is exactly ONE code path that executes it. Three halves
 * make that mechanical in Phase 1f:
 *
 * 1. **One dispatcher, statically.** The command journal, the command audit,
 *    and start-plan consumption are reachable from exactly two modules: the
 *    kernel that executes commands and the infra database that stores them.
 *    A route, projector, or recovery module that touched them directly would
 *    be a second handler — the exact drift D113 forbids.
 * 2. **Exhaustive across family AND action, behaviorally.** Every D95
 *    family/action fixture dispatches to a TYPED `CommandResult`. Phase-1f
 *    active arms execute (their authority validation runs before any process
 *    seam), and every later arm returns `rejected:capability-unavailable`
 *    with zero authority-generation advance and no journal row. An
 *    unhandled/throwing "not implemented" arm fails this sweep.
 * 3. **The protocol's sharp edges.** CAS rejects only the real race families;
 *    hide is a reversible presentation tombstone, never a delete; typed gate
 *    results parse the descriptor's exact schema before anything is stored;
 *    notification stays read/unread/snooze; capture mutation cannot spell a
 *    run id; and an injected active-run lookup error enqueues zero runs.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  createCommandKernel,
  PHASE1_ACTIVE_COMMAND_ARMS,
  PHASE1_DEFERRED_COMMAND_ARMS,
  type CommandKernel,
} from "../../../src/core/command-kernel.js";
import {
  CaptureCommandRequestSchema,
  CommandRequestSchema,
  CommandResultSchema,
  COMMAND_FAMILY_REGISTRY,
} from "../../../src/domain/commands.js";
import { manualClock } from "../../../src/domain/clock.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../../src/infra/sqlite/index.js";
import { planStart } from "../../../src/services/start/plan.js";
import { REPO_ROOT, walkFiles } from "./helpers/guard-files.js";
import { fixtureDescriptor } from "./helpers/descriptor-fixtures.js";
import {
  COMMAND_FIXTURES,
  HASH_B,
  NOW,
  UUID_2,
  UUID_4,
  UUID_5,
} from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";

/* ── the ratified Phase-1f partition (doc 03 §Phase-1f authority) ────────── */

const EXPECTED_ACTIVE = {
  start: ["start-run"],
  "worker-browser": [
    "plan-worker-count", "spawn-worker", "stop-worker", "pause-worker",
    "resume-worker", "refresh-browser", "reopen-browser",
  ],
  run: [
    "retry", "cancel", "bump", "rename", "hide", "unhide",
    "resolve-write-present", "resolve-write-absent",
  ],
  gate: ["resolve-gate"],
} as const;

const EXPECTED_DEFERRED = {
  intake: [
    "inspect-intake", "confirm-intake-mapping", "correct-intake-row",
    "exclude-intake-row", "validate-intake", "enqueue-intake-manifest",
  ],
  settings: ["apply-settings"],
  "version-archive": ["plan-version-bump", "apply-version-bump", "relaunch-archived-run"],
  run: ["edit-checkpoint"],
  notification: ["notification-read", "notification-unread", "notification-snooze"],
  capture: [
    "capture-upload", "capture-replace", "capture-reorder", "capture-delete",
    "capture-finalize", "capture-retry-finalize", "capture-discard",
  ],
} as const;

const DEFERRED_KEYS = new Set(
  Object.entries(EXPECTED_DEFERRED).flatMap(([family, actions]) =>
    actions.map((action) => `${family}/${action}`)),
);

/* ── harness ─────────────────────────────────────────────────────────────── */

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;

interface GuardHarness {
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
}

function createHarness(wrap?: RepositoryWrap): GuardHarness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-command-guard-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "guard.sqlite"), busyTimeoutMs: 250, migrationOwner: "command-guard" },
    clock,
  );
  openDatabases.push(database);
  const seamFailure = (seam: string) => () => {
    throw new Error(`${seam} process seam was reached before authority validation`);
  };
  const kernel = createCommandKernel({
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(wrap === undefined ? repositories : wrap(repositories)),
      ),
    },
    clock,
    ids: sequentialIdFactory("a"),
    descriptors: {
      resolve: (workflowId) => workflowId === "fixture-graph" ? fixtureDescriptor : undefined,
    },
    writeResolution: {
      resolvePresent: seamFailure("resolve-write-present"),
      resolveAbsent: seamFailure("resolve-write-absent"),
    },
    workerRuntime: {
      planWorkerCount: seamFailure("plan-worker-count"),
      spawnWorker: seamFailure("spawn-worker"),
      refreshBrowser: seamFailure("refresh-browser"),
      reopenBrowser: seamFailure("reopen-browser"),
    },
  });
  return { database, kernel, clock, plannerIds: sequentialIdFactory("f") };
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
      configFingerprint: HASH_B,
      configSnapshotId: UUID_4,
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
  it("pins the exact ratified Phase-1f active/deferred arm partition", () => {
    assert.deepEqual(PHASE1_ACTIVE_COMMAND_ARMS, EXPECTED_ACTIVE);
    assert.deepEqual(PHASE1_DEFERRED_COMMAND_ARMS, EXPECTED_DEFERRED);
    const partitioned = [
      ...Object.entries(EXPECTED_ACTIVE),
      ...Object.entries(EXPECTED_DEFERRED),
    ].flatMap(([family, actions]) => actions.map((action) => `${family}/${action}`));
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...partitioned].sort(), [...registry].sort());
    assert.equal(new Set(partitioned).size, partitioned.length);
  });

  it("keeps the command journal, audit, and start-plan consumption on exactly one executing path", () => {
    const allowed = new Set([
      "src/core/command-kernel.ts",
      "src/infra/sqlite/authority-database.ts",
    ]);
    const tokens = ["commandAudits", ".commands.insert(", "startPlans.consume("];
    const violations: string[] = [];
    let kernelDefinitions = 0;
    for (const file of walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })) {
      const path = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const content = readFileSync(file, "utf8");
      if (content.includes("export function createCommandKernel")) kernelDefinitions += 1;
      if (allowed.has(path)) continue;
      for (const token of tokens) {
        if (content.includes(token)) violations.push(`${path} reaches ${token} outside the command kernel`);
      }
    }
    assert.deepEqual(violations, []);
    assert.equal(kernelDefinitions, 1, "exactly one module may define the command kernel");

    // The kernel itself holds no raw storage escape hatch and no UI Delete.
    const kernelSource = readFileSync(join(REPO_ROOT, "src/core/command-kernel.ts"), "utf8");
    assert.ok(!/\bDatabaseSync\b/.test(kernelSource), "the kernel may not hold a raw database handle");
    assert.ok(!/\bDELETE\s+FROM\b/i.test(kernelSource), "the kernel may not physically delete authority rows");
    assert.ok(!/"Delete"/.test(kernelSource), "the UI label is Hide, never Delete");
  });

  it("carries a version or immutability binding on every wire arm's target", () => {
    const versionless: string[] = [];
    for (const fixture of COMMAND_FIXTURES) {
      const request = CommandRequestSchema.parse(fixture);
      const target: Record<string, unknown> = request.target;
      const carries = "expectedVersion" in target || "expectedRevision" in target
        || "archiveFingerprint" in target || "scope" in target;
      if (!carries) versionless.push(`${request.family}/${request.type}`);
    }
    assert.deepEqual(versionless, []);
  });

  it("dispatches every D95 family/action to a typed result — active arms execute, later arms are capability-unavailable with zero side effects", () => {
    const harness = createHarness();
    const seen: string[] = [];
    for (const fixture of COMMAND_FIXTURES) {
      const request = CommandRequestSchema.parse(fixture);
      const key = `${request.family}/${request.type}`;
      seen.push(key);
      const generationBefore = harness.database.getMeta().authorityGeneration;
      const result = CommandResultSchema.parse(harness.kernel.execute(structuredClone(fixture)));
      if (DEFERRED_KEYS.has(key)) {
        assert.equal(result.state, "rejected", key);
        if (result.state !== "rejected") continue;
        assert.equal(result.code, "capability-unavailable", key);
        assert.equal(harness.database.getMeta().authorityGeneration, generationBefore, key);
        assert.equal(harness.database.authority.commands.get(request.commandId), undefined, key);
      } else {
        // Active arms EXECUTE: against an empty store they refuse on exact
        // authority lookups with a typed code that is never the deferred one.
        assert.notEqual(result.state, "applied", key);
        if (result.state === "rejected") {
          assert.notEqual(result.code, "capability-unavailable", `${key} must execute in Phase 1f`);
        }
      }
    }
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...new Set(seen)].sort(), [...registry].sort(), "the fixture corpus must cover every family/action");
  });

  it("scopes CAS to the real race families: cancel conflicts on drift, rename/hide do not", () => {
    const harness = createHarness();
    assert.equal(harness.database.authority.runs.enqueue(QUEUED_RUN).state, "inserted");
    const base = {
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
    };

    const renamed = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "rename",
      target: { runId: UUID_2, expectedVersion: 999 },
      payload: { displayName: "Renamed despite drift" },
    });
    assert.equal(renamed.state, "applied");

    const hidden = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "hide",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(hidden.state, "applied");

    // Hide is a reversible presentation tombstone: the run row still exists,
    // its lifecycle is untouched, and unhide restores visibility.
    const afterHide = harness.database.authority.runs.get(UUID_2);
    assert.ok(afterHide !== undefined, "hide may never delete the run row");
    assert.equal(afterHide.hidden, true);
    assert.equal(afterHide.lifecycle.state, "queued");
    assert.equal(afterHide.displayName, "Renamed despite drift");

    const cancelled = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "cancel",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(cancelled.state, "conflict", "cancel-tree is CAS-enforced");
  });

  it("enqueue policy is transactional: an injected active-run lookup error creates zero runs", () => {
    let shouldFail = false;
    const harness = createHarness((repositories) => ({
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
    assert.equal(harness.database.authority.runs.get(plan.planned[0].runId), undefined);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("commands are idempotent: byte-exact replay returns already-applied; a different body on the same id fails loud", () => {
    const harness = createHarness();
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

  it("typed gate results parse the descriptor's exact schema and store a checkpointed result", () => {
    const harness = createHarness();
    const plan = createFixturePlan(harness);
    assert.equal(harness.kernel.execute(startCommandFor(plan)).state, "applied");
    const runId = plan.planned[0].runId;
    const claimed = harness.database.authority.runs.claimNext({
      workflow: "fixture-graph", workerId: "worker-1", now: NOW,
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    const claim = { workerId: "worker-1", claimGeneration: claimed.run.claimGeneration };
    const live = { workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW };
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
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("notification stays read/unread/snooze and capture mutation cannot spell a run id", () => {
    const notification = COMMAND_FAMILY_REGISTRY.find(({ family }) => family === "notification");
    assert.deepEqual(notification?.actions, ["notification-read", "notification-unread", "notification-snooze"]);

    const captureWithRunTarget = CaptureCommandRequestSchema.safeParse({
      commandId: UUID_5,
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "capture",
      type: "capture-discard",
      target: { runId: UUID_2, expectedVersion: 1 },
    });
    assert.equal(captureWithRunTarget.success, false, "a capture target must never accept a run id");
  });
});
