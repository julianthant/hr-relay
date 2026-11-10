import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createDashboardPoolTestWorld } from "../../../../support/helpers/backend/dashboard-pool-world.js";
import { argValue } from "../../../../support/helpers/backend/fake-worker-port.js";

const { WORKFLOW, WORKER_1, openControlHarness, envelope, settleMicrotasks, view, memberTarget, planWorkers, dashboardLaunch, launchCommands, cleanup } = createDashboardPoolTestWorld();

describe("the composed worker pool through the kernel", () => {
  afterEach(cleanup);

  it("plans one worker and spawns the worker CLI bound to this person, sign-in and slot", async () => {
    const h = await openControlHarness();
    const [member] = await planWorkers(h, 1);
    assert.ok(member);
    await settleMicrotasks();
    assert.equal(h.spawnRequests.length, 1);
    const [request] = h.spawnRequests;
    assert.ok(request);
    assert.equal(request.command, "/usr/bin/fake-worker-node");
    assert.deepEqual(request.args.slice(0, 6), ["--import", "tsx", "src/cli.ts", "worker", WORKFLOW, "--pool-index"]);
    assert.equal(argValue(request.args, "--worker-id"), WORKER_1);
    assert.equal(argValue(request.args, "--ordinal"), "1");
    assert.equal(argValue(request.args, "--session-generation"), "1");
    assert.equal(view(h).state, "running");
  });

  it("settles a crashed worker's claimed run as failed by the crash and the next Start spawns a fresh process", async () => {
    const h = await openControlHarness(), commands = launchCommands(h);
    assert.equal((await commands.submit(dashboardLaunch(h).request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 1);
    const claimed = h.database.authority.runs.claimNext({ workflow: WORKFLOW, workerId: WORKER_1, now: h.clock.now().toISOString() });
    assert.equal(claimed.state, "claimed");
    assert.ok(claimed.state === "claimed");
    h.children[0]?.exit(1, null);
    await settleMicrotasks();
    assert.deepEqual(h.settled, [WORKER_1]);
    assert.equal(view(h).state, "exited");
    assert.equal(view(h).exit?.outcome, "crashed");
    const settled = h.database.authority.runs.get(claimed.run.envelope.runId)?.lifecycle;
    assert.ok(settled?.state === "terminal" && settled.outcome === "failed", JSON.stringify(settled));

    assert.equal((await commands.submit(dashboardLaunch(h, "10203373").request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 2, "a start after a crash spawns a replacement and is never refused");
    assert.equal(view(h).state, "running");
    assert.equal(h.faults.length, 0);
  });

  it("keeps two people's pools apart: the same worker id spawns per person and a crash settles only its own person's run", async () => {
    const a = await openControlHarness(), b = await openControlHarness();
    for (const h of [a, b]) {
      assert.equal((await launchCommands(h).submit(dashboardLaunch(h).request)).state, "applied");
      await settleMicrotasks();
    }
    const [aSpawn] = a.spawnRequests, [bSpawn] = b.spawnRequests;
    assert.ok(aSpawn !== undefined && bSpawn !== undefined);
    assert.equal(argValue(aSpawn.args, "--worker-id"), WORKER_1);
    assert.equal(argValue(bSpawn.args, "--worker-id"), WORKER_1);
    assert.equal(argValue(aSpawn.args, "--profile-id"), a.admission.profileBinding.profileId);
    assert.equal(argValue(bSpawn.args, "--profile-id"), b.admission.profileBinding.profileId);
    assert.notEqual(a.profileRoot, b.profileRoot);
    const claims = [a, b].map(h => h.database.authority.runs.claimNext({ workflow: WORKFLOW, workerId: WORKER_1, now: h.clock.now().toISOString() }));
    assert.ok(claims.every(claim => claim.state === "claimed"));
    const [aClaim, bClaim] = claims;
    assert.ok(aClaim?.state === "claimed" && bClaim?.state === "claimed");
    a.children[0]?.exit(1, null);
    await settleMicrotasks();
    assert.deepEqual(a.settled, [WORKER_1]);
    assert.deepEqual(b.settled, []);
    const aRun = a.database.authority.runs.get(aClaim.run.envelope.runId)?.lifecycle;
    assert.ok(aRun?.state === "terminal" && aRun.outcome === "failed");
    assert.deepEqual(b.database.authority.runs.get(bClaim.run.envelope.runId), bClaim.run);
    assert.equal(view(b).state, "running");
    assert.deepEqual([...a.faults, ...b.faults], []);
  });

  it("shares one cold worker between two concurrent starts", async () => {
    const h = await openControlHarness(), commands = launchCommands(h);
    const results = await Promise.all([commands.submit(dashboardLaunch(h).request), commands.submit(dashboardLaunch(h, "10203373").request)]);
    await settleMicrotasks();
    assert.deepEqual(results.map(result => result.state), ["applied", "applied"]);
    assert.equal(h.children.length, 1);
    assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW).length, 2);
  });

  it("pauses and resumes a running member durably and refuses a card from an older version", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 1); await settleMicrotasks();
    const stale = memberTarget(h);
    assert.equal((await h.kernel.executeWorkerPool({ ...envelope(h), type: "pause-worker", target: stale })).state, "applied");
    assert.equal(h.database.authority.workerSlots.get(WORKER_1)?.paused, true);
    assert.equal(view(h).directive, "pause");
    assert.ok(h.children[0]?.sent.some(message => message.kind === "worker-pause"));
    assert.equal((await h.kernel.executeWorkerPool({ ...envelope(h), type: "resume-worker", target: memberTarget(h) })).state, "applied");
    assert.equal(h.database.authority.workerSlots.get(WORKER_1)?.paused, false);
    assert.equal(view(h).directive, "run");
    const refused = await h.kernel.executeWorkerPool({ ...envelope(h), type: "stop-worker", target: { ...stale, lifetimeId: "00000000-0000-4000-8000-000000000000" } });
    assert.equal(refused.state, "conflict");
    assert.equal(view(h).state, "running");
  });

  it("resets a member by stopping it over IPC into a fresh process, and Retry restarts only an exited member", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 1); await settleMicrotasks();
    const first = view(h);
    assert.equal((await h.kernel.executeWorkerPool({ ...envelope(h), type: "stop-worker", target: memberTarget(h) })).state, "applied");
    await settleMicrotasks();
    assert.deepEqual(h.children[0]?.sent.map(message => message.kind), ["worker-stop"]);
    assert.deepEqual(h.children[0]?.kills, []);
    assert.equal(h.children.length, 2);
    assert.notEqual(view(h).lifetimeId, first.lifetimeId);
    assert.equal(view(h).state, "running");
    const running = await h.kernel.executeWorkerPool({ ...envelope(h), type: "retry-worker", target: memberTarget(h) });
    assert.equal(running.state, "rejected");
    h.children[1]?.exit(1, null); await settleMicrotasks();
    assert.equal(view(h).exit?.outcome, "crashed");
    assert.equal((await h.kernel.executeWorkerPool({ ...envelope(h), type: "retry-worker", target: memberTarget(h) })).state, "applied");
    assert.equal(h.children.length, 3);
    assert.equal(view(h).state, "running");
  });

  it("sends a browser refresh as an IPC request and refuses it for an exited member", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 1); await settleMicrotasks();
    const browserSessionId = "bbbbbbbb-0001-4000-8000-000100000000";
    const browserTarget = () => { const { workflowId: _workflow, ...target } = memberTarget(h); return { ...target, browserSessionId }; };
    const target = browserTarget();
    assert.equal((await h.kernel.executeWorkerPool({ ...envelope(h), type: "refresh-browser", target })).state, "applied");
    const request = h.children[0]?.sent.find(message => message.kind === "worker-request");
    assert.ok(request?.kind === "worker-request");
    assert.deepEqual(request.request, { type: "refresh-browser", browserSessionId });
    h.children[0]?.exit(1, null); await settleMicrotasks();
    const refused = await h.kernel.executeWorkerPool({ ...envelope(h), type: "refresh-browser", target: browserTarget() });
    assert.ok(refused.state === "rejected");
    assert.equal(refused.code, "invalid-state");
    assert.equal(refused.message, "WORKER_EXITED");
  });

  it("settles a browser refresh in flight when its worker exits as an audited WORKER_EXITED rejection", async () => {
    const h = await openControlHarness({ answers: false });
    await planWorkers(h, 1); await settleMicrotasks();
    const { workflowId: _workflow, ...target } = memberTarget(h);
    const command = { ...envelope(h), type: "refresh-browser" as const, target: { ...target, browserSessionId: "bbbbbbbb-0001-4000-8000-000100000000" } };
    const pending = h.kernel.executeWorkerPool(command);
    await settleMicrotasks();
    assert.ok(h.children[0]?.sent.some(message => message.kind === "worker-request"));
    h.children[0]?.exit(1, null); await settleMicrotasks();
    const result = await pending;
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "invalid-state");
    assert.equal(result.message, "WORKER_EXITED");
    const audit = h.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(audit?.result.state === "rejected");
    assert.equal(audit.result.message, "WORKER_EXITED");
  });

  it("shutdown stops every member, including one that ignores stop, and a crashed member never blocks it", async () => {
    const h = await openControlHarness({ exitOnStop: false });
    await planWorkers(h, 2); await settleMicrotasks();
    assert.equal(h.children.length, 2);
    h.children[1]?.exit(1, null); await settleMicrotasks();
    const stopping = h.workers.pool.stopAll("shutdown");
    await settleMicrotasks();
    h.clock.advanceMonotonic(120_000);
    for (const entry of h.scheduler.pending()) entry.fire();
    await settleMicrotasks();
    h.clock.advanceMonotonic(30_000);
    for (const entry of h.scheduler.pending()) entry.fire();
    const views = await stopping;
    assert.deepEqual(views.map(entry => entry.state), ["exited", "exited"]);
    assert.deepEqual(h.children[0]?.kills, ["SIGTERM", "SIGKILL"]);
    assert.ok(views.every(entry => entry.held === undefined));
  });
});
