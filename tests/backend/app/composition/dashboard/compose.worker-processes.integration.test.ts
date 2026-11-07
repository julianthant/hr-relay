import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { createBrowserRoots, workerProfileDirectory, type BrowserRootLaunchInput } from "../../../../../src/backend/storage/browser-roots.js";
import { createDashboardChildTestWorld, type RealChildRecord } from "../../../../support/helpers/backend/dashboard-child-world.js";
import { createDashboardPoolTestWorld } from "../../../../support/helpers/backend/dashboard-pool-world.js";
import { releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";

const pools = createDashboardPoolTestWorld();
const children = createDashboardChildTestWorld(() => { releaseAdmissionFixtures(); }, root => { releaseAdmissionFixture(root); });
afterEach(async () => { await pools.cleanup(); await children.cleanup(); }, 30_000);

async function realHarness(mode: "obey" | "ignore-stop") {
  const records: RealChildRecord[] = [];
  const h = await pools.openControlHarness({}, lifetime => ({ launch: children.stubLaunch(lifetime, mode), spawn: children.realStubSpawner(records, lifetime) }));
  const output = () => JSON.stringify({ records: records.map(record => record.argv.join(" ")), members: h.workers.pool.snapshot(), faults: h.faults.map(fault => fault.message) });
  return { h, records, output };
}

async function fireDeadlines(h: Awaited<ReturnType<typeof realHarness>>["h"], ms: number) {
  h.clock.advanceMonotonic(ms);
  for (const entry of h.scheduler.pending()) entry.fire();
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("real worker processes under the composed pool", () => {
  it("runs two real children concurrently and settles a kill -9 as a crash while the peer keeps running", async () => {
    const { h, records, output } = await realHarness("obey");
    await pools.planWorkers(h, 2);
    await children.waitFor(() => h.workers.pool.snapshot().filter(view => view.state === "running").length === 2, "two running members", output);
    const [first, second] = records;
    assert.ok(first?.pid !== undefined && second?.pid !== undefined);
    assert.equal(children.pidAlive(first.pid) && children.pidAlive(second.pid), true);

    first.child.kill("SIGKILL");
    await children.waitFor(() => h.settled.length === 1, "the killed child's exit settlement", output);
    const views = h.workers.pool.snapshot();
    assert.equal(views.find(view => view.pid === first.pid)?.exit?.outcome, "crashed");
    assert.equal(views.find(view => view.pid === second.pid)?.state, "running");

    await h.workers.ensureRunning(pools.WORKFLOW);
    await children.waitFor(() => h.workers.pool.snapshot().filter(view => view.state === "running").length === 2, "the replacement member", output);
    assert.equal(records.length, 3, "the crashed member is replaced by a fresh process");
  }, 60_000);

  it("probes a killed child's open browser root closed while a live peer and its open root stay untouched, so the replacement can launch it", async () => {
    const { h, records, output } = await realHarness("obey");
    await pools.planWorkers(h, 2);
    await children.waitFor(() => h.workers.pool.snapshot().filter(view => view.state === "running").length === 2, "two running members", output);
    const [first, peer] = records;
    assert.ok(first?.pid !== undefined && peer?.pid !== undefined);
    const peerView = h.workers.pool.snapshot().find(view => view.pid === peer.pid);
    assert.ok(peerView !== undefined);
    const roots = createBrowserRoots(h.admission);
    const rootOf = (workerId: string, slotOrdinal: number): BrowserRootLaunchInput => ({ profileId: h.admission.profileBinding.profileId, profileRoot: h.profileRoot,
      profileDirectory: workerProfileDirectory({ profileRoot: h.profileRoot, slotOrdinal, system: "ucpath" }), credentialFingerprint: null,
      owner: { kind: "worker", database: h.database, workerId } });
    const input = rootOf(pools.WORKER_1, 1), peerInput = rootOf(peerView.member.workerId, peerView.member.ordinal);
    const crashed = roots.beginLaunch(input), peerLaunch = roots.beginLaunch(peerInput);
    for (const directory of [input.profileDirectory, peerInput.profileDirectory]) mkdirSync(directory, { recursive: true, mode: 0o700 });
    crashed.opened(); peerLaunch.opened();
    const peerRow = () => roots.inventory().roots.find(row => row.launch.launchId === peerLaunch.launchId);
    const peerBefore = peerRow();
    assert.equal(peerBefore?.launch.state, "opened");

    first.child.kill("SIGKILL");
    await children.waitFor(() => h.settled.length === 1, "the killed child's exit settlement", output);
    assert.equal(h.faults.length, 0, output());
    const crashedRow = roots.inventory().roots.find(row => row.launch.launchId === crashed.launchId);
    assert.deepEqual([crashedRow?.launch.state, crashedRow?.native], ["closed", undefined]);
    assert.deepEqual(peerRow(), peerBefore, "the live peer's root is unchanged");
    assert.equal(h.workers.pool.snapshot().find(view => view.pid === peer.pid)?.state, "running");
    assert.equal(children.pidAlive(peer.pid), true);

    await h.workers.ensureRunning(pools.WORKFLOW);
    await children.waitFor(() => h.workers.pool.snapshot().filter(view => view.state === "running" && view.pid !== first.pid).length === 2, "the replacement member", output);
    const replacement = roots.beginLaunch(input);
    assert.notEqual(replacement.launchId, crashed.launchId);
    replacement.closing(); replacement.closed();
    peerLaunch.closing(); peerLaunch.closed();
  }, 90_000);

  it("stops a real child over IPC with exit code 0 and no signal", async () => {
    const { h, records, output } = await realHarness("obey");
    await pools.planWorkers(h, 1);
    await children.waitFor(() => pools.view(h).state === "running", "a running member", output);
    const stopped = h.workers.pool.stopAll("shutdown");
    const views = await stopped;
    assert.deepEqual(views.map(view => [view.state, view.exit?.code, view.exit?.signal, view.exit?.outcome]), [["exited", 0, null, "stopped"]]);
    assert.equal(children.pidAlive(records[0]?.pid ?? 0), false);
  }, 60_000);

  it("escalates a real child that ignores Stop and SIGTERM to SIGKILL and still finishes shutdown", async () => {
    const { h, records, output } = await realHarness("ignore-stop");
    await pools.planWorkers(h, 1);
    await children.waitFor(() => pools.view(h).state === "running", "a running member", output);
    const stopping = h.workers.pool.stopAll("shutdown");
    await fireDeadlines(h, 120_000);
    await children.waitFor(() => records[0]?.child.signalCode === null && pools.view(h).state === "stopping", "SIGTERM to be ignored", output, 2_000);
    await fireDeadlines(h, 30_000);
    const views = await stopping;
    assert.deepEqual(views.map(view => [view.state, view.exit?.signal, view.held]), [["exited", "SIGKILL", undefined]]);
  }, 60_000);
});
