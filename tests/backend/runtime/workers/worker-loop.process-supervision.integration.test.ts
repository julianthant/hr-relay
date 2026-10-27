import { createWorkerSupervisionTestWorld, FakeWorkerChild, type Harness } from "../../../support/helpers/backend/worker-supervision-world.js";
import { describe, expect, it } from "vitest";
import { type WorkerPoolMember } from "../../../../src/backend/runtime/workers/worker-loop.js";

import { randomUUID } from "node:crypto";
import { admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { openAuthorityHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import assert from "node:assert/strict";
import { createWorkerPoolRuntimeExecutor, WORKER_GRACEFUL_STOP_TIMEOUT_MS, WORKER_SIGTERM_TIMEOUT_MS } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WORKER_EXIT_OBSERVATION_TIMEOUT_MS } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { BrowserSessionIdSchema } from "../../../../src/rules/identity/ids.js";

{
const { NOW, member, openHarness, stopRequest, planRequest } = createWorkerSupervisionTestWorld();


/* ── spawn: exact argv and birth proof ───────────────────────────────────── */

describe("spawn-worker", () => {
  it("launches the exact worker CLI argv and acknowledges only after the durable lease proves the child pid", async () => {
    const harness = openHarness();
    const target = member(1);

    const acknowledgement = await harness.supervisor.execute({
      command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003",
      member: target,
    });

    expect(harness.spawnRequests).toHaveLength(1);
    const request = harness.spawnRequests[0];
    expect(request?.command).toBe("/usr/local/bin/node-worker-cli");
    expect(request?.args).toEqual([
      "--import", "tsx", "src/cli.ts",
      "worker", "person-lookup", "--pool-index", "1",
      "--worker-id", "person-lookup-worker-1", "--ordinal", "1", "--membership-revision", "1", "--launch-command-id", "00000000-0000-4000-8000-000000000003",
    ]);
    expect(request?.cwd).toBe("/repo/worktree");
    expect(acknowledgement).toEqual({
      command: "spawn-worker",
      state: "acknowledged",
      member: target,
      ownership: "supervised",
      stage: "started",
    });
    const evidence = harness.supervisor.memberEvidence(target);
    expect(evidence).toMatchObject({
      state: "running",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
    });
  });

  it("refuses a relative launch command at construction — PATH lookup is an ambiguity", () => {
    expect(() => openHarness({ launchCommand: "npm" })).toThrow(/not an absolute path/);
  });

  it("refuses to spawn over a live lease it did not create — no adoption of external workers", async () => {
    const harness = openHarness();
    const target = member(1);
    harness.leases.set(target.workerId, { processId: 999, startedAt: NOW });

    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/externally started worker is never adopted/);
    expect(harness.spawnRequests).toHaveLength(0);
  });

  it("refuses a second spawn while it already owns a live child for the member", async () => {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
    harness.leases.delete(target.workerId);

    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/already owns a running child/);
    expect(harness.spawnRequests).toHaveLength(1);
  });

  it("rejects with exit evidence when the child dies before proving birth", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/exited with code 1 signal null before proving its lease birth/);
    harness.children[0]?.emitExit(1, null);
    await expectation;

    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: NOW,
      reportedBy: "os",
    });
  });

  it("rejects on a process error before birth", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn ENOENT/);
    harness.children[0]?.emitError(new Error("spawn ENOENT"));
    await expectation;
  });

  it("records crash evidence, kills the child, and frees the slot on a pre-birth process error", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn EACCES/);
    harness.children[0]?.emitError(new Error("spawn EACCES"));
    await expectation;

    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);

    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: null,
      signal: null,
      at: NOW,
      reportedBy: "supervisor",
      observedStop: [],
    });
    // The slot is NOT bricked: an explicit new spawn-worker replaces the record.
    harness.nextSpawn = (request): FakeWorkerChild => {
      const replacement = new FakeWorkerChild(4002);
      harness.leases.set(request.member.workerId, { processId: 4002, startedAt: NOW });
      return replacement;
    };
    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .resolves.toMatchObject({ command: "spawn-worker", state: "acknowledged" });
    expect(harness.spawnRequests).toHaveLength(2);
  });

  it("records crash evidence without attempting a kill when the errored child never got a pid", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    harness.nextSpawn = (): FakeWorkerChild => new FakeWorkerChild(undefined);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn ENOENT/);
    harness.children[0]?.emitError(new Error("spawn ENOENT"));
    await expectation;

    expect(harness.children[0]?.signalsSent).toEqual([]);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      outcome: "crashed",
      exitCode: null,
      signal: null,
      at: NOW,
      reportedBy: "supervisor",
      observedStop: [],
    });
    expect(harness.faults).toHaveLength(0);
  });

  it("never fabricates exit evidence when the pre-birth abort SIGKILL was NOT delivered — the possibly-live child blocks the slot", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const child = new FakeWorkerChild(4321);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn EPERM; the unproved child was NOT killed/);
    child.emitError(new Error("spawn EPERM"));
    await expectation;

    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(/spawn-abort SIGKILL was not delivered/);
    // NOT recorded "exited": the child may still be alive, and synthesizing an
    // exit would free the slot for a replacement beside the live orphan.
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "kill-undelivered",
      pid: 4321,
      at: NOW,
      cause: "spawn EPERM",
    });
    // Respawn is BLOCKED until the child's real exit is observed.
    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/a replacement cannot run beside a possibly-live orphan/);
    expect(harness.spawnRequests).toHaveLength(1);
    // So are stop, pause and plan coverage — each refuses by name.
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/stop-worker refused: .*spawn-abort SIGKILL was not delivered/);
    await expect(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(/pause-worker refused: .*spawn-abort SIGKILL was not delivered/);
    await expect(harness.supervisor.execute(planRequest(1, [target], [])))
      .rejects.toThrow(/plan-worker-count refused: .*spawn-abort SIGKILL was not delivered/);
    expect(harness.gracefulRequests).toHaveLength(0);

    child.emitExit(null, "SIGKILL");
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      signal: "SIGKILL",
      reportedBy: "os",
    });
    harness.nextSpawn = (request): FakeWorkerChild => {
      const replacement = new FakeWorkerChild(4322);
      harness.leases.set(request.member.workerId, { processId: 4322, startedAt: NOW });
      return replacement;
    };
    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .resolves.toMatchObject({ command: "spawn-worker", state: "acknowledged" });
  });

  it("forwards a post-birth process error to the fault sink instead of letting it vanish", async () => {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });

    harness.children[0]?.emitError(new Error("kill EPERM"));

    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(
      new RegExp(`worker ${target.workerId} \\(pid ${String(harness.children[0]?.pid)}\\) process errored after`),
    );
    expect(harness.faults[0]?.message).toMatch(/kill EPERM/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "running" });
  });

  it("routes an undelivered spawn-abort SIGKILL to the fault sink and words the rejection honestly", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const child = new FakeWorkerChild(4321);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/proved no lease birth within 10000ms; the unproved child was NOT killed \(SIGKILL was not delivered\)/);

    harness.clock.advanceMonotonic(10_000);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    await expectation;

    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(/spawn-abort SIGKILL was not delivered/);
  });

  it("propagates a synchronous spawner failure and leaves no phantom record", async () => {
    const harness = openHarness();
    const target = member(1);
    harness.nextSpawn = () => {
      throw new Error("EAGAIN: process table full");
    };

    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/EAGAIN/);
    expect(harness.supervisor.memberEvidence(target)).toBeUndefined();
  });

  it("kills the child and rejects when no lease birth is proved within the bound", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/proved no lease birth within 10000ms; the unproved child was killed/);

    harness.clock.advanceMonotonic(10_000);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    await expectation;
    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
  });

  it("rejects rather than claiming a child that exited in the same tick it proved birth", async () => {
    const harness = openHarness();
    const target = member(1);
    const pending = harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });

    harness.children[0]?.emitExit(1, null);

    await expect(pending).rejects.toThrow(/exited .*after proving its lease birth/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      exitCode: 1,
    });
  });

  it("kills the child and rejects when the lease is owned by a different pid", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/lease is owned by pid 777, not the spawned child/);

    harness.leases.set(target.workerId, { processId: 777, startedAt: NOW });
    harness.clock.advanceMonotonic(250);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    await expectation;
    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
  });
});

describe("a crashed child", () => {
  async function crashedHarness(): Promise<{ harness: Harness; target: WorkerPoolMember }> {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
    harness.clock.advanceWall(60_000);
    harness.children[0]?.emitExit(1, null);
    harness.leases.delete(target.workerId);
    return { harness, target };
  }

  it("records exit code, signal and instant as crash evidence", async () => {
    const { harness, target } = await crashedHarness();

    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: "2026-08-26T09:01:00.000Z",
      reportedBy: "os",
      observedStop: [],
    });
  });

  it("is never restarted automatically — no new process until an explicit spawn command", async () => {
    const { harness } = await crashedHarness();

    expect(harness.spawnRequests).toHaveLength(1);
    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(harness.faults).toHaveLength(0);
  });

  it("is replaced only by an explicit new spawn-worker command", async () => {
    const { harness, target } = await crashedHarness();

    const acknowledgement = await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });

    expect(acknowledgement).toMatchObject({ command: "spawn-worker", state: "acknowledged" });
    expect(harness.spawnRequests).toHaveLength(2);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "running",
      pid: harness.children[1]?.pid,
    });
  });
});



}

{
const { WORKFLOW, NOW, member, DIRECTIVE_WRITE_VERSIONS, openHarness, stopDirective, stopRequest } = createWorkerSupervisionTestWorld();


async function runningHarness(): Promise<{ harness: Harness; target: WorkerPoolMember }> {
  const harness = openHarness();
  const target = member(1);
  await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
  return { harness, target };
}



describe("through createWorkerPoolRuntimeExecutor", () => {
  function workerBrowserCommand(request: Readonly<Record<string, unknown>>) {
    const parsed = CommandRequestSchema.parse({
      commandId: randomUUID(),
      requestedBy: "local-operator",
      requestedAt: NOW,
      source: "dashboard",
      family: "worker-browser",
      ...request,
    });
    if (parsed.family !== "worker-browser") throw new Error("fixture must be a worker-browser command");
    return parsed;
  }

  it("admits native slots for spawn and stop but refuses plan completion without native retirement proof", async () => {
    const harness = openHarness();
    const authority = await openAuthorityHarness();
    try {
    const initial = workerBrowserCommand({ type: "plan-worker-count", target: { workflowId: WORKFLOW, expectedVersion: 0 }, payload: { desiredWorkers: 2 } });
    if (initial.type !== "plan-worker-count") throw new Error("fixture plan required");
    authority.database.withAuthorityTransaction(repositories => { repositories.commands.insert(initial); admitWorkerPoolRoster(repositories, initial, NOW); });
    const executor = createWorkerPoolRuntimeExecutor(harness.supervisor, authority.database.authority.workerSlots);

    for (const poolIndex of [1, 2]) {
      await expect(executor.spawnPoolWorker({
        command: workerBrowserCommand({
          type: "spawn-worker",
          target: { workflowId: WORKFLOW, expectedVersion: 1 },
          payload: { workerId: member(poolIndex).workerId },
        }),
        now: NOW,
      })).resolves.toEqual({ state: "accepted" });
    }

    await expect(executor.stopPoolWorker({
      command: workerBrowserCommand({
        type: "stop-worker",
        target: { workerId: member(2).workerId, expectedVersion: 1 },
      }),
      now: NOW,
    })).resolves.toEqual({ state: "accepted", directiveLeaseVersions: DIRECTIVE_WRITE_VERSIONS });


    const plan = workerBrowserCommand({ type: "plan-worker-count", target: { workflowId: WORKFLOW, expectedVersion: authority.database.authority.workerPools.get(WORKFLOW)!.version }, payload: { desiredWorkers: 1 } });
    if (plan.type !== "plan-worker-count") throw new Error("fixture plan required");
    const roster = authority.database.withAuthorityTransaction(repositories => { repositories.commands.insert(plan); return admitWorkerPoolRoster(repositories, plan, NOW); });
    const pending = executor.planPoolWorkerCount({ command: plan, now: NOW, roster });
    const refused = expect(pending).rejects.toThrow(/fixture native profile retirement not available/);
    await Promise.resolve(); await Promise.resolve();
    harness.children[1]?.emitExit(0, null);
    harness.leases.delete(member(2).workerId);
    await refused;
    expect(harness.gracefulRequests).toHaveLength(1);
    } finally { await authority.dispose(); }
  });
});



describe("drainOwnedChildren", () => {
  it("requests the durable graceful stop and resolves only after the owned child's real exit", async () => {
    const { harness, target } = await runningHarness();
    let drained = false;
    const pending = harness.supervisor.drainOwnedChildren(stopDirective(NOW)).then(() => { drained = true; });

    await Promise.resolve();
    expect(harness.gracefulRequests).toEqual([target]);
    expect(drained).toBe(false);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "stopping" });

    harness.children[0]?.emitExit(0, null);
    await pending;

    expect(drained).toBe(true);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "stopped",
      reportedBy: "os",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it("keeps escalation active until a real exit follows SIGKILL", async () => {
    const { harness, target } = await runningHarness();
    let drained = false;
    const pending = harness.supervisor.drainOwnedChildren(stopDirective(NOW)).then(() => { drained = true; });
    await Promise.resolve();
    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    expect(harness.children[0]?.signalsSent).toEqual(["SIGTERM"]);
    harness.clock.advanceMonotonic(WORKER_SIGTERM_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_SIGTERM_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    expect(harness.children[0]?.signalsSent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(drained).toBe(false);

    harness.children[0]?.emitExit(null, "SIGKILL");
    await pending;
    expect(drained).toBe(true);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "exited", reportedBy: "os" });
  });

  it("fails visibly when SIGKILL was delivered but no OS exit arrives within the observation bound", async () => {
    const { harness, target } = await runningHarness();
    const pending = harness.supervisor.drainOwnedChildren(stopDirective(NOW));
    await Promise.resolve();
    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    harness.clock.advanceMonotonic(WORKER_SIGTERM_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    const failed = expect(pending).rejects.toThrow(/could not observe every owned worker exit/);

    harness.clock.advanceMonotonic(WORKER_EXIT_OBSERVATION_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    await failed;

    expect(harness.faults.some(({ message }) => /no OS exit was observed/.test(message))).toBe(true);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "stopping", pid: harness.children[0]?.pid });
    harness.supervisor.close();
  });
});

describe("close", () => {
  it("cancels every armed escalation timer and returns the still-live children's evidence", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(2) });
    await harness.supervisor.execute(stopRequest(harness, member(1)));
    expect(harness.scheduler.pending()).toHaveLength(1);

    const live = harness.supervisor.close();

    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(live).toEqual([
      {
        state: "stopping",
        pid: harness.children[0]?.pid,
        bornAt: NOW,
        observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
      },
      {
        state: "running",
        pid: harness.children[1]?.pid,
        bornAt: NOW,
        leaseStartedAt: NOW,
      },
    ]);
    // Idempotent: a second close has nothing left to cancel and reports the
    // same still-live children.
    expect(harness.supervisor.close()).toEqual(live);
  });

  it("returns no evidence when every child already exited", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(1) });
    harness.children[0]?.emitExit(0, null);

    expect(harness.supervisor.close()).toEqual([]);
  });

  it("includes a kill-undelivered child's evidence in close() — a possibly-live child is never hidden from teardown", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const child = new FakeWorkerChild(4321);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth/);
    child.emitError(new Error("spawn EPERM"));
    await expectation;
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "kill-undelivered" });

    const live = harness.supervisor.close();

    expect(live).toEqual([{
      state: "kill-undelivered",
      pid: 4321,
      at: NOW,
      cause: "spawn EPERM",
    }]);
  });

  it("refuses every command after close — a closed supervisor acknowledges nothing", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(1) });
    harness.supervisor.close();

    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(2) }))
      .rejects.toThrow(/supervisor is closed/);
    await expect(harness.supervisor.execute(stopRequest(harness, member(1))))
      .rejects.toThrow(/supervisor is closed/);
    expect(harness.spawnRequests).toHaveLength(1);
    expect(harness.gracefulRequests).toHaveLength(0);
    // Evidence stays readable after close: the record is history, not a command.
    expect(harness.supervisor.memberEvidence(member(1))).toMatchObject({ state: "running" });
  });
});

/* ── browser arms: no cross-process channel exists yet ───────────────────── */

describe("browser session arms", () => {
  it("refuses refresh-browser and reopen-browser by name — no effect is acknowledged that cannot happen", async () => {
    const { harness, target } = await runningHarness();
    const browserSessionId = BrowserSessionIdSchema.parse("11111111-2222-4333-8444-555555555555");

    await expect(harness.supervisor.execute({ command: "refresh-browser", member: target, browserSessionId }))
      .rejects.toThrow(/worker-browser-channel-unavailable/);
    await expect(harness.supervisor.execute({ command: "reopen-browser", member: target, browserSessionId }))
      .rejects.toThrow(/worker-browser-channel-unavailable/);
  });
});

it("observes an early drain rejection on the original promise and still refuses shutdown", async () => {
  const { harness } = await runningHarness();
  const failure = new Error("durable stop unavailable");
  harness.nextGracefulStop = () => { throw failure; };
  await assert.rejects(harness.supervisor.drainOwnedChildren(stopDirective(NOW)), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, "dashboard could not observe every owned worker exit");
    assert.ok(error.errors.some((cause: unknown) => cause instanceof Error && cause.message.includes("durable stop unavailable")));
    return true;
  });
  expect(harness.children[0]?.signalsSent).toEqual([]);
  harness.children[0]?.emitExit(0, null); harness.supervisor.close();
});
}
