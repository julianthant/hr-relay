import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { createWorkerLoopHarness as workerHarness } from "../../support/helpers/backend/worker-loop-world.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { runWorkerLoop,WorkerLoopReportSchema } from "../../../src/backend/runtime/workers/worker-loop.js";
import {
WorkerSessionManager,
type BrowserSessionCloseProof,
type WorkerBrowserSessionFactory,
} from "../../../src/backend/runtime/workers/worker-sessions.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import {
BrowserSessionIdSchema,
FingerprintSchema,
WorkerIdSchema,
WorkflowIdSchema,
} from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../support/helpers/duo-ceremony-fixtures.js";
import {
FIXTURE_SESSION_ACQUIRE_MS,
healthyCrmDriver,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
sessionFactoryHarness,
type AuthorityHarness
} from "../../support/helpers/phase1f-executor-harness.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const ACTIVE_STATES = new Set(["claimed", "validating", "running"]);
const CLAIM_STALE_AFTER_MS = 60_000;

/** The measured soak shape, restated in ref execution-and-sessions's as-built paragraph. */
const SOAK_WORKERS = 3;
const SOAK_RUNS = 30;

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function sharedAuthority(): Promise<AuthorityHarness> {
  const authority = await openAuthorityHarness();
  assert.equal(authority.database.authority.runtimeConfig.get()?.configFingerprint, CONFIG_SNAPSHOT.fingerprint);
  disposers.push(authority.dispose);
  return authority;
}

function queuedRun(index: number): Record<string, unknown> {
  const tail = String(index).padStart(4, "0");
  const run = personLookupQueuedRun({
    runId: `0000000${index % 10}-${tail}-4000-8000-${tail}${"0".repeat(8)}`,
    itemId: `1111111${index % 10}-${tail}-4000-8000-${tail}${"0".repeat(8)}`,
  });
  const envelope = run["envelope"];
  assert.ok(envelope !== null && typeof envelope === "object");
  return {
    ...run,
    envelope: { ...envelope, traceId: `pl-170000-${index.toString(16).padStart(4, "0")}` },
  };
}

function runIdOf(record: RunRecord): string {
  return record.envelope.runId;
}

function activeClaimsByWorker(database: AuthorityDatabase): ReadonlyMap<string, readonly string[]> {
  const held = new Map<string, string[]>();
  for (const row of database.authority.runs.listActiveOwners(WORKFLOW_ID)) {
    held.set(row.workerId, [...(held.get(row.workerId) ?? []), row.runId]);
  }
  return held;
}

describe("graceful teardown with a run in flight", () => {
  it("abandons rather than terminalizing, and the claim sweep — not the loop — releases the row", async () => {
    const authority = await sharedAuthority();
    const { database, clock } = authority;
    database.authority.runs.enqueue(queuedRun(1));

    let markStarted = (): void => undefined;
    const driverStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          markStarted();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const dying = await workerHarness(authority, "1", "a", { sessions, exitWhenIdle: false });
    const looping = runWorkerLoop(dying.deps);
    await driverStarted;

    const runId = activeClaimsByWorker(database).get("person-lookup-worker-1")?.[0];
    assert.ok(runId !== undefined);

    dying.stop.abort(new Error("operator pressed Ctrl-C"));
    const report = WorkerLoopReportSchema.parse(await looping);
    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["abandoned"]);


    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);

    // Keep the dead worker claim until recovery decides the uncertain write outcome.
    const stranded = database.authority.runs.get(runId);
    assert.ok(stranded !== undefined);
    assert.ok(ACTIVE_STATES.has(stranded.lifecycle.state), `expected an active row, got ${stranded.lifecycle.state}`);
    assert.equal("workerId" in stranded.lifecycle ? stranded.lifecycle.workerId : undefined, "person-lookup-worker-1");

    // Recovery is the ONLY release path, and it works: the heartbeat went
    // stale with the process, the sweep requeues, and a fresh worker drains it.
    clock.advanceWall(90_000);
    const swept = database.authority.runs.sweepExpiredClaims({
      workflow: WORKFLOW_ID,
      staleBefore: new Date(clock.nowMs() - CLAIM_STALE_AFTER_MS).toISOString(),
      now: clock.now().toISOString(),
    });
    assert.deepEqual(swept.map(({ state }) => state), ["requeued"]);

    const successor = await workerHarness(authority, "2", "b");
    const recovered = await runWorkerLoop(successor.deps);
    assert.deepEqual(recovered.outcomes.map(({ state }) => state), ["done"]);
    assert.deepEqual([...activeClaimsByWorker(database).keys()], []);
    const settled = database.authority.runs.get(runId);
    assert.ok(settled !== undefined && settled.lifecycle.state === "terminal");
    assert.equal("outcome" in settled.lifecycle ? settled.lifecycle.outcome : undefined, "done");
    assert.equal(settled.envelope.attempt, 1);
    assert.deepEqual(settled.envelope, stranded.envelope);
    assert.equal(settled.claimGeneration, stranded.claimGeneration + 1);
  });
});



const TEARDOWN_WORKER = WorkerIdSchema.parse("teardown-fixture-worker");
const TEARDOWN_WORKFLOW = WorkflowIdSchema.parse("person-lookup");
const TEARDOWN_FINGERPRINT = FingerprintSchema.parse("3".repeat(64));
const NEVER_ABORTS = new AbortController().signal;
const UCPATH_REUSE = { system: "ucpath" as const, access: "read" as const, session: "reuse-worker" as const };
const CRM_REUSE = { system: "crm" as const, access: "read" as const, session: "reuse-worker" as const };

interface TeardownFactory {
  readonly factory: WorkerBrowserSessionFactory;
  readonly closes: () => readonly string[];
}

/** Sessions whose close can be made to fail per system, by name. */
function teardownFactory(closeFailsFor: readonly string[] = []): TeardownFactory {
  let opens = 0;
  const closes: string[] = [];
  return {
    closes: () => Object.freeze([...closes]),
    factory: {
      async open(input) {
        opens += 1;
        const sessionId = BrowserSessionIdSchema.parse(
          `00000000-0000-4000-8000-${String(opens).padStart(12, "0")}`,
        );
        return {
          sessionId,
          profileRevision: 7,
          signInFingerprint: input.configFingerprint,
          system: input.system,
          ...(input.instance === undefined ? {} : { instance: input.instance }),
          configFingerprint: input.configFingerprint,
          acceptDownloads: input.acceptDownloads,
          exclusive: input.exclusive,
          driver: { system: input.system },
          authentication: {
            authenticate: async (): Promise<"logged-in"> => "logged-in",
          },
          async reset(): Promise<void> {
            // the neutral reset always succeeds in this fixture
          },
          async close(): Promise<BrowserSessionCloseProof> {
            if (closeFailsFor.includes(input.system)) {
              throw new Error(`injected ${input.system} close failure`);
            }
            closes.push(input.system);
            return { sessionId, system: input.system, pagesClosed: true, contextClosed: true };
          },
        };
      },
    },
  };
}

async function teardownManager(factory: TeardownFactory): Promise<WorkerSessionManager> {
  const clock = manualClock(new Date("2026-08-09T09:00:00.000Z"));
  const sessions = new WorkerSessionManager({
    workerId: TEARDOWN_WORKER,
    workflowId: TEARDOWN_WORKFLOW,
    stores: taskStoreRegistry,
    factory: factory.factory,
    clock,
    scheduler: new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: await fixtureDuoCeremonyGates(clock),
  });

  sessions.bindRunConfigFingerprint(TEARDOWN_FINGERPRINT);
  return sessions;
}

describe("worker-stop waits behind in-flight callbacks", () => {
  it("closes nothing under an active lease, refuses a second concurrent closeAll, then completes", async () => {
    const factory = teardownFactory();
    const sessions = await teardownManager(factory);

    // A settled crm lease leaves a warm resource; ucpath then goes in-flight.
    await sessions.withDriver(CRM_REUSE, "prod", NEVER_ABORTS, async () => "crm-read");
    let releaseOperation = (): void => undefined;
    const mayFinish = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const inFlight = sessions.withDriver(UCPATH_REUSE, "prod", NEVER_ABORTS, async () => {
      markStarted();
      await mayFinish;
      return "ucpath-read";
    });
    await started;

    const closing = sessions.closeAll("worker-stop");
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(!factory.closes().includes("ucpath"), "worker-stop closed a session that was still in use");

    // A second concurrent teardown is a CALLER bug, not a retry: two closers
    // would each observe half the sessions and each report success.
    await assert.rejects(
      sessions.closeAll("worker-stop"),
      /browser sessions are already closing for worker-stop/,
    );
    // And no new lease may start once teardown began.
    await assert.rejects(
      sessions.withDriver(CRM_REUSE, "prod", NEVER_ABORTS, async () => "must not run"),
      /cannot start while worker sessions are closing for worker-stop/,
    );

    releaseOperation();
    assert.equal(await inFlight, "ucpath-read");
    await closing;
    assert.deepEqual([...factory.closes()].sort(), ["crm", "ucpath"]);
    assert.deepEqual(sessions.activeSystems(), []);
  });
});

describe("poison-close paths survive teardown", () => {
  it("names the task failure AND the failed close, retains the resource, and aggregates every system at stop", async () => {
    const factory = teardownFactory(["ucpath", "crm"]);
    const sessions = await teardownManager(factory);

    // Preserve task and close errors separately; an unproven close blocks session reuse.
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", NEVER_ABORTS, () =>
        Promise.reject(new Error("injected task failure"))),
      (error: unknown) => error instanceof AggregateError
        && /ucpath operation and poison-close both failed/.test(error.message)
        && error.errors.some((failure: unknown) =>
          failure instanceof Error && /injected task failure/.test(failure.message))
        && error.errors.some((failure: unknown) =>
          failure instanceof Error && /injected ucpath close failure/.test(failure.message)),
    );
    // Retained and poisoned — never erased from ownership.
    assert.deepEqual(sessions.activeSystems(), ["ucpath"]);
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", NEVER_ABORTS, async () => "must not run"),
      /ucpath browser session has an unresolved failed-close proof/,
    );

    // A second system is opened and also cannot prove closure. Worker-stop must
    // report BOTH, not the first one it tripped over.
    const crmFactory = teardownFactory(["crm"]);
    const crmSessions = await teardownManager(crmFactory);
    await assert.rejects(
      crmSessions.withDriver(CRM_REUSE, "prod", NEVER_ABORTS, () =>
        Promise.reject(new Error("injected crm task failure"))),
      /crm operation and poison-close both failed/,
    );

    await assert.rejects(
      sessions.closeAll("worker-stop"),
      (error: unknown) => error instanceof AggregateError
        && /failed to close every browser session/.test(error.message)
        && error.errors.length === 1
        && error.errors.every((failure: unknown) =>
          failure instanceof Error && /injected ucpath close failure/.test(failure.message)),
    );
    // Still retained after a failed worker-stop: an unprovable close is a
    // standing fact about this machine, not an event that expires.
    assert.deepEqual(sessions.activeSystems(), ["ucpath"]);
    assert.deepEqual(factory.closes(), []);
  });
});



describe("bounded multi-worker soak over one authority database", () => {
  it(`drains ${String(SOAK_RUNS)} runs across ${String(SOAK_WORKERS)} workers and leaves authority provably intact`, async () => {
    const authority = await sharedAuthority();
    const { database } = authority;
    const enqueued: string[] = [];
    for (let index = 1; index <= SOAK_RUNS; index += 1) {
      enqueued.push(runIdOf(database.authority.runs.enqueue(queuedRun(index)).record));
    }

    let maxWorkersHoldingWork = 0;
    let samples = 0;
    const sample = (): void => {
      samples += 1;
      const held = activeClaimsByWorker(database);
      for (const [worker, runs] of held) {
        assert.equal(runs.length, 1, `worker ${worker} held ${String(runs.length)} runs: ${runs.join(", ")}`);
      }
      maxWorkersHoldingWork = Math.max(maxWorkersHoldingWork, held.size);
    };

    const prefixes = ["a", "b", "c"] as const;
    const harnesses = await Promise.all(prefixes.map((prefix, index) =>
      workerHarness(authority, String(index + 1), prefix, { onSpan: sample })));

    const startedAtMs = performance.now();
    const reports = await Promise.all(harnesses.map(({ deps }) => runWorkerLoop(deps)));
    const elapsedMs = performance.now() - startedAtMs;

    // Every run executed exactly once, by exactly one worker, to `done`.
    const executed = reports.flatMap((report) => report.outcomes.map(({ runId }) => runId));
    assert.equal(new Set(executed).size, executed.length, "a run was executed twice under the soak");
    assert.deepEqual([...executed].sort(), [...enqueued].sort());
    for (const report of reports) {
      assert.equal(report.stopped, "idle");
      for (const outcome of report.outcomes) assert.equal(outcome.state, "done");
      assert.ok(report.outcomes.length > 0, `${report.workerId} never claimed anything`);
    }

    // Ref execution-and-sessions's first two rows, measured rather than asserted in the abstract:
    // never two rows per worker, and never fewer than the whole fleet at work.
    assert.ok(samples > 100, `only ${String(samples)} claim samples were taken`);
    assert.equal(maxWorkersHoldingWork, SOAK_WORKERS);

    // No orphaned claims, no requeues, no second claim generation.
    assert.deepEqual([...activeClaimsByWorker(database).keys()], []);
    const records = database.authority.runs.listByWorkflow(WORKFLOW_ID);
    assert.equal(records.length, SOAK_RUNS);
    for (const record of records) {
      assert.equal(record.lifecycle.state, "terminal", runIdOf(record));
      assert.equal("outcome" in record.lifecycle ? record.lifecycle.outcome : undefined, "done");
      assert.equal(record.claimGeneration, 1, `${runIdOf(record)} was claimed twice`);
      assert.equal(record.envelope.attempt, 1, `${runIdOf(record)} was requeued`);
    }


    const inspection = AuthorityDatabase.inspectExistingReadOnly(authority.path);
    assert.equal(inspection.invariants.state, "valid");
    assert.deepEqual(inspection.invariants.violations, []);
    assert.equal(inspection.quickCheck, "ok");
    assert.equal(inspection.foreignKeyViolations, 0);
    // A read-only workflow fences nothing and journals nothing to the ledger,
    // and every `done` run retains exactly one immutable same-row completion.
    assert.equal(inspection.counts.unresolvedWriteIntents, 0);
    assert.equal("durableOutbox" in inspection.counts, false);
    assert.equal(inspection.counts.pendingCommands, 0);
    assert.equal("runTerminalOutbox" in inspection.counts, false);
    assert.equal(database.authority.runs.listByWorkflow(TEARDOWN_WORKFLOW).filter((run) => run.completion?.kind === "done").length, SOAK_RUNS);

    // The real database query proves read-only execution created no transactions.
    assert.deepEqual(createTransactionHistory(database.authority).query({ from: "0001-01-01", to: "9999-12-31" }).rows, []);

    // Recorded in ref execution-and-sessions's as-built paragraph; printed so a regression in
    // the soak's cost is visible in the run rather than only in the wall clock.
    assert.ok(
      elapsedMs > 0 && Number.isFinite(elapsedMs),
      `soak: ${String(SOAK_WORKERS)} workers x ${String(SOAK_RUNS)} runs in ${elapsedMs.toFixed(0)}ms`,
    );
  });
});
