/**
 * Ref execution-and-sessions §5.5: tasks and transactions run under immutable, abortable
 * deadlines — a service or driver call that ignores its abort signal cannot
 * occupy a worker indefinitely.
 *
 * Two halves, both required:
 *
 * 1. STRUCTURAL — the interpreter's dependency surface makes the bound
 *    mandatory: `taskDeadlineMs` has no default, no `??` fallback, and every
 *    task invocation path races `raceAbortable` against the scheduler-armed
 *    deadline controller.
 * 2. BEHAVIORAL — a task that never settles AND ignores its signal is still
 *    bounded: firing the scheduled deadline lands the run terminal `failed`
 *    with a legible deadline failure, and the wedged session is poison-closed
 *    rather than reused.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../src/core/run-executor.js";
import { taskStoreRegistry } from "../../../src/stores/index.js";
import { REPO_ROOT } from "./helpers/guard-files.js";
import {
  healthyCrmDriver,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory, RUN_ID, WORKER_ID, WORKFLOW_ID } from "../fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("bounded task deadline", () => {
  it("keeps the deadline mandatory and racing on every invocation path", () => {
    const source = readFileSync(join(REPO_ROOT, "src/core/run-executor.ts"), "utf8");
    assert.ok(/readonly taskDeadlineMs: number;/.test(source), "taskDeadlineMs must be a required dependency");
    assert.ok(!/taskDeadlineMs\s*\?\?/.test(source), "taskDeadlineMs must have no defaulting fallback");
    assert.ok(
      /z\.number\(\)\.int\(\)\.positive\(\)\.parse\(deps\.taskDeadlineMs\)/.test(source),
      "the executor must validate the bound before any node runs",
    );
    // Both invocation arms (pure/service and browser-leased) go through the
    // abort race against the deadline-armed controller signal.
    const raceCalls = source.match(/await raceAbortable\(/g) ?? [];
    assert.equal(raceCalls.length, 2, "both task invocation arms must race the deadline controller");
    assert.ok(
      /deps\.scheduler\.schedule\(\s*clock\.monotonicMs\(\) \+ deps\.taskDeadlineMs/.test(source),
      "the deadline must be armed on the injected monotonic scheduler",
    );
  });

  it("bounds a task that never settles and ignores its abort signal", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    let wedged: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      wedged = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          wedged?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const scheduler = new ManualScheduler(authority.clock, 0);
    const { database, clock } = authority;
    database.authority.runs.enqueue(personLookupQueuedRun());
    const claimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;

    const executing = executeClaimedRun({
      descriptor: personLookupDescriptor,
      stores: taskStoreRegistry,
      authority: database,
      sessions: sessionManagerFor(sessions, authority.clock),
      emitter: recordingEmitter().emitter,
      clock: authority.clock,
      ids: sequentialIdFactory("e"),
      scheduler,
      taskDeadlineMs: 5_000,
      log: recordingLogger().log,
    }, {
      run: claimed.run,
      claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
      signal: new AbortController().signal,
    });
    await started;
    const deadline = scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === authority.clock.monotonicMs() + 5_000);
    assert.ok(deadline, "the task deadline must be armed while the task runs");
    deadline.fire();
    const outcome = await executing;
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /exceeded its immutable 5000ms task deadline/);
    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);
  });
});
