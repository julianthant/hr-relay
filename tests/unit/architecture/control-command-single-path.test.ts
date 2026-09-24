import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../../fixtures/operator-command-fixtures.js";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { createRuntimeVersionChanges } from "../../../src/core/archive-runtime-version-changes.js";
/**
 * `control-command-single-path` — ref guards-and-tests §3.9, activated by D113.
 *
 * Control surfaces mutate authority only through ref dashboard-surfaces's D67/D95 command
 * protocol, and there is exactly ONE code path that executes it. Three halves
 * make that mechanical in Phase 1f:
 *
 * 1. **One dispatcher, statically.** The command journal, the command audit,
 *    and start-plan consumption are mutable from exactly two modules: the
 *    kernel that executes commands and the infra database that stores them.
 *    Settings boot may read one exact command/audit pair to authenticate its
 *    persisted file generation; it cannot insert or consume authority. A
 *    route, projector, or recovery mutator would be a second handler — the
 *    exact drift D113 forbids.
 * 2. **Exhaustive across family AND action, behaviorally.** Every D95
 *    family/action fixture dispatches to a TYPED `CommandResult`. Phase-1f
 *    active arms execute (their authority validation runs before any process
 *    seam), and every later arm returns `rejected:capability-unavailable`
 *    with zero authority-generation advance and no journal row. An
 *    unhandled/throwing "not implemented" arm fails this sweep.
 * 3. **The protocol's sharp edges.** CAS rejects only the real race families;
 *    hide is a reversible presentation tombstone, never a delete; typed gate
 *    results parse the descriptor's exact schema before anything is stored;
 *    notification stays read/unread/snooze; and an injected active-run lookup
 *    error enqueues zero runs.
 */
import assert from "node:assert/strict";
import { PositiveIntSchema } from "../../../src/domain/ids.js";
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
} from "../../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../fixtures/archive-fixtures.js";

const CURRENT_COMMAND_FIXTURES: readonly unknown[] = Object.freeze([
  ...COMMAND_FIXTURES,
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

/* ── the ratified Phase-1f partition (ref dashboard-surfaces §Phase-1f authority) ────────── */

const EXPECTED_ACTIVE = {
  "failure-resolution": ["annotate-failure"],
  start: ["start-run"],
  "workflow-batch": ["set-batch-grouping"],
  "worker-browser": [
    "plan-worker-count", "spawn-worker", "stop-worker", "pause-worker",
    "resume-worker", "refresh-browser", "reopen-browser",
  ],
  run: [
    "retry",
    // D314: Restart from start — the second ordinary recovery choice.
    "restart",
    "cancel", "bump", "rename",
    // D308: delete means delete — the terminal queue run's own door.
    "delete",
    "resolve-write-present", "resolve-write-absent",
    // D166: the Edit-Data save activated with its CAS-against-resume-fence arm.
  ],
  gate: ["resolve-gate"],
  // 2i-B: the inbox lifecycle activated over D134/D138's durable rows.
  notification: ["notification-read", "notification-unread", "notification-snooze"],
  // D170: the five non-enqueue intake arms activated over the durable session.
  // D171 activated the sixth — the manifest mint plus the run fan-out — so the
  // intake family is now wholly active.
  intake: [
    "inspect-intake", "confirm-intake-mapping", "correct-intake-row",
    "exclude-intake-row", "validate-intake", "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],
  // D179 (2i-G): the D80 archive model activated — plan, apply, relaunch.
  // D308: the Archive's delete door.
  "version-archive": ["plan-version-bump", "apply-version-bump", "plan-runtime-version", "apply-runtime-version", "delete-archived-run"],
  explorer: ["apply-explorer-edit"],
} as const;

const EXPECTED_DEFERRED = {
  intake: [],
  settings: [],
  "version-archive": [],
  run: [],
  notification: [],
} as const;

const DEFERRED_KEYS = new Set(
  Object.entries(EXPECTED_DEFERRED as Readonly<Record<string, readonly string[]>>).flatMap(([family, actions]) =>
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

  seedSyntheticRuntimeConfig(database);
  openDatabases.push(database);
  const seamFailure = (seam: string) => () => {
    throw new Error(`${seam} process seam was reached before authority validation`);
  };
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    runtimeVersionChanges: createRuntimeVersionChanges({ database, clock, ids: sequentialIdFactory("r"), archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS }),
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
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
    settings: {
      prepare: (command) => command.type === "apply-protected-settings" ? { state: "conflict", currentRevision: PositiveIntSchema.parse(1), message: "guard fixture has no mutable credential target" } : undefined,
      reconcileReplay: () => {
        throw new Error("guard fixture has no persisted settings replay target");
      },
      apply: () => ({
        state: "conflict",
        currentRevision: 1,
        message: "guard fixture has no mutable settings target",
      }),
    },
    explorerEdits: {
      apply: () => ({
        result: {
          state: "refused",
          category: "fixture-refusal",
          message: "Explorer guard fixture refuses before persistence",
        },
      }),
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
    const settingsAuditReaders = new Map([
      ["src/server/settings-runtime.ts", 1],
      ["src/infra/compat/d331-protected-journal.ts", 1],
      ["src/infra/sqlite/backup-service.ts", 0],
    ]);
    const violations: string[] = [];
    let kernelDefinitions = 0;
    for (const file of walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })) {
      const path = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const content = readFileSync(file, "utf8");
      if (content.includes("export function createCommandKernel")) kernelDefinitions += 1;
      if (allowed.has(path)) continue;
      for (const token of tokens) {
        const expectedSettingsAuditReads = settingsAuditReaders.get(path);
        if (expectedSettingsAuditReads !== undefined && token === "commandAudits") {
          const auditUses = content.match(/\bcommandAudits\.[A-Za-z]+/gu) ?? [];
          if (auditUses.length !== expectedSettingsAuditReads
            || auditUses.some((use) => use !== (path === "src/server/settings-runtime.ts" ? "commandAudits.findSettingsHistory" : "commandAudits.findByCommand"))) {
            violations.push(
              `${path} may only authenticate settings through exactly ${String(expectedSettingsAuditReads)} `
              + "commandAudits.findByCommand reads",
            );
          }
          continue;
        }
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
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      const request = CommandRequestSchema.parse(fixture);
      const target: Record<string, unknown> = request.target;
      const carries = "expectedVersion" in target || "expectedRevision" in target
        || "archiveFingerprint" in target || "reviewFingerprint" in target || "scope" in target;
      if (!carries) versionless.push(`${request.family}/${request.type}`);
    }
    assert.deepEqual(versionless, []);
  });

  it("dispatches every D95 family/action to a typed result — active arms execute, later arms are capability-unavailable with zero side effects", () => {
    const harness = createHarness();
    const seen: string[] = [];
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      const request = CommandRequestSchema.parse(fixture);
      const key = `${request.family}/${request.type}`;
      seen.push(key);
      const generationBefore = harness.database.getMeta().authorityGeneration;
      const result = CommandResultSchema.parse(harness.kernel.execute(structuredClone(fixture)));
      if (request.type === "relaunch-archived-run") {
        assert.equal(result.state, "rejected", key);
        assert.equal(harness.database.getMeta().authorityGeneration, generationBefore, key);
        assert.equal(harness.database.authority.commands.get(request.commandId), undefined, key);
      } else if (DEFERRED_KEYS.has(key)) {
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
    assert.deepEqual([...new Set(seen)].sort(), [...registry, "version-archive/relaunch-archived-run"].sort(), "the fixture corpus must cover every active and historical family/action");
  });

  /*
   * D233 INVERTED THIS CASE. It used to read *"cancel conflicts on drift,
   * rename/hide do not"* and asserted `applied` for a rename and a hide sent at
   * version 999 — the CAS hole, pinned as a feature under the heading "scopes
   * CAS to the real race families".
   *
   * There is no such scoping. Presentation is exempt from a STATE precondition
   * (a name is legal on a run in any lifecycle) and that is a different
   * exemption from being exempt from the version check: a rename carries a
   * value the operator authored, so a stale one silently discards somebody's
   * edit and reports "Recorded." Every run verb now CASes the caller's value,
   * which is the rule with no exceptions a reviewer can actually check.
   *
   * The verbs the case walks moved twice since. D234 retired `hide`/`unhide`,
   * and `bump` — the one arm D233's own record left open, because it CASed its
   * OWN re-read rather than the caller's — joined the rule here on D233's
   * reasoning, which is why the case now walks the whole live run vocabulary
   * instead of a sample of it.
   */
  it("CASes every run verb against the caller's version — presentation included", () => {
    const harness = createHarness();
    assert.equal(harness.database.authority.runs.enqueue(QUEUED_RUN).state, "inserted");
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
    assert.equal(staleBump.state, "conflict", "bump CASes the caller's value too (D233's rule)");
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
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
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
    const runId = singleAppliedRunId(harness.kernel.execute(startCommandFor(plan)));
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

  it("notification stays read/unread/snooze", () => {
    const notification = COMMAND_FAMILY_REGISTRY.find(({ family }) => family === "notification");
    assert.deepEqual(notification?.actions, ["notification-read", "notification-unread", "notification-snooze"]);
  });
});
