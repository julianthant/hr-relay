import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { z } from "zod";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { appliedRunIds } from "../../../support/fixtures/operator-command-fixtures.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { admitFixtureSlot } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";

/** Admissions are frozen, so the store reads and the repair service record which admission the command handed them. */
const admitted = vi.hoisted((): { reads: Array<{ owner: RuntimeAdmission; stateRoot: string }>; repairs: Array<{ owner: RuntimeAdmission; stateRoot: string }>; failRead: boolean; failRepair: boolean } => ({ reads: [], repairs: [], failRead: false, failRepair: false }));
vi.mock("../../../../src/backend/storage/sqlite/authority-database.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../src/backend/storage/sqlite/authority-database.js")>();
  const open: typeof actual.AuthorityDatabase.open = (admission, input, ...rest) => {
    if (typeof input === "object" && input !== null && "migrationOwner" in input && input.migrationOwner === "span-root-repair-search") {
      admitted.reads.push({ owner: admission, stateRoot: admission.stateRoot });
      if (admitted.failRead) throw new Error("fixture-store-read-failed");
    }
    return actual.AuthorityDatabase.open(admission, input, ...rest);
  };
  return { ...actual, AuthorityDatabase: new Proxy(actual.AuthorityDatabase, {
    get: (target, key, receiver): unknown => key === "open" ? open : Reflect.get(target, key, receiver) }) };
});
vi.mock("../../../../src/backend/runs/recovery/span-root-repair.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../src/backend/runs/recovery/span-root-repair.js")>();
  return { ...actual, OfflineSpanRootRepairService: new Proxy(actual.OfflineSpanRootRepairService, {
    construct(target, args: ConstructorParameters<typeof actual.OfflineSpanRootRepairService>) {
      admitted.repairs.push({ owner: args[1], stateRoot: args[1].stateRoot });
      if (admitted.failRepair) throw new Error("fixture-repair-failed");
      return new target(...args);
    } }) };
});

const clock = manualClock(new Date(NOW));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  admitted.reads.length = 0; admitted.repairs.length = 0; admitted.failRead = false; admitted.failRepair = false;
  for (const close of cleanups.splice(0).reverse()) await close();
});

/** One claimed run with its settled start command and no `run.queued` root; the ids are fixed, so two seeded stores hold the same run id. */
function seedRunWithoutRoot(person: RuntimeAdmission, path: string): string {
  const database = AuthorityDatabase.open(person, { path, busyTimeoutMs: 500, migrationOwner: "person-stores-test" },
    clock, undefined, undefined, undefined, boundProfileCredentials(person));
  try {
    const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock, person);
    database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint,
      provenance: resolved.provenance, capturedAt: clock.now().toISOString() });
    const ids = sequentialIdFactory("c"), active = database.authority.runtimeConfig.get();
    assert.ok(active);
    const descriptors = { resolve: (workflow: string) => workflow === fixtureDescriptor.id ? fixtureDescriptor : undefined };
    const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("a"), publishQueued: () => undefined });
    const unused = () => { throw new Error("unrequested runtime effect"); };
    const kernel = createCommandKernel({ authority: database, lifecycle, clock, ids, appVersion: "0.1.0", descriptors,
      writeResolution: { recheck: unused, resolveAbsent: unused }, configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS, workerRuntime: { pool: unusedWorkerPool(unused) } });
    const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock, ids: sequentialIdFactory("b"),
      planTtlMs: 600000, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
    const plan = planner.plan({ workflowId: fixtureDescriptor.id, submissions: [{ eid: "10812345", mode: "write" }], dryRun: true,
      selectedStepKeys: fixtureDescriptor.timeline.map(step => step.key) });
    const result = kernel.execute({ commandId: UUID_1, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
      target: { workflowId: fixtureDescriptor.id, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
    const [runId] = appliedRunIds(result);
    assert.ok(runId);
    const slot = database.withAuthorityTransaction(repositories => admitFixtureSlot(repositories, fixtureDescriptor.id, 1, NOW));
    requireLifecycleApplied(lifecycle.claimNext({ commandId: ids.uuid(), workflow: fixtureDescriptor.id, workerId: slot.workerId,
      runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
        configFingerprint: active.configFingerprint } }));
    return runId;
  } finally { database.close(); }
}

/** An installation with two ready people, the second signed in unless `signedOut`; `holders` names whose stores get the run. */
async function installation(holders: ReadonlyArray<"first" | "second">, signedOut = false) {
  const first = await createBoundProfileFixture();
  cleanups.push(() => first.close());
  const firstId = first.admission.profileBinding.profileId;
  const firstRun = holders.includes("first") ? seedRunWithoutRoot(first.admission, first.path) : undefined;
  createProfileRegistry(first.machine).advanceSession(null);
  first.admission.release(); first.machine.release();
  const second = await createBoundProfileFixture({ workspace: first.workspace, lifetime: first.lifetime, email: "second@ucsd.edu" });
  cleanups.push(() => second.closeController());
  const secondRun = holders.includes("second") ? seedRunWithoutRoot(second.admission, second.path) : undefined;
  if (firstRun !== undefined && secondRun !== undefined) assert.equal(firstRun, secondRun);
  if (signedOut) createProfileRegistry(second.machine).advanceSession(null);
  const people = { first: { profileId: firstId, path: first.path, stateRoot: first.stateRoot },
    second: { profileId: second.admission.profileBinding.profileId, path: second.path, stateRoot: second.stateRoot } };
  const released = (entries: ReadonlyArray<{ owner: RuntimeAdmission; stateRoot: string }>) => entries.map(({ owner, stateRoot }) => {
    assert.throws(() => owner.assertLive(), /released admission/u);
    return stateRoot === people.first.stateRoot ? "first" : stateRoot === people.second.stateRoot ? "second" : stateRoot;
  });
  return {
    person: second.admission, ...people,
    /** Both people's store files, to show a refusal wrote nothing. */
    stores: () => [readFileSync(first.path), readFileSync(second.path)],
    /** The machine is back to an ordinary stopped state: no maintenance operation is left held. */
    assertMaintenanceReleased() { second.machine.acquireOfflineMaintenance().release(); },
    runId: firstRun ?? secondRun ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    repair(args: readonly string[]) {
      return composeStorageCommand(rebuildRuntimeIsolation, ["repair-span-root", ...args], clock, first.workspace, second.machine);
    },
    /** The people whose stores the command read and repaired, in order; each of those admissions is released. */
    released: () => ({ reads: released(admitted.reads.splice(0)), repairs: released(admitted.repairs.splice(0)) }),
  };
}

const RepairedSchema = z.strictObject({ profileId: z.string(), report: z.looseObject({ state: z.string(), runId: z.string() }) });

/** Read straight from the file after the command: how many `run.queued` roots the store holds for the run. */
function queueRoots(path: string, runId: string): number {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return z.object({ roots: z.number() }).parse(raw.prepare(
      "SELECT count(*) AS roots FROM timeline_events WHERE run_id=? AND json_extract(payload_json,'$.payload.event.t')='run.queued'").get(runId)).roots;
  } finally { raw.close(); }
}

/** A refusal: exit 1, the named reason, nothing written to either person's store, and nobody left admitted. */
async function assertRefused(world: Awaited<ReturnType<typeof installation>>, args: readonly string[], reason: RegExp,
  touched: { reads: string[]; repairs: string[] } = { reads: [], repairs: [] }): Promise<void> {
  const before = world.stores();
  const outcome = await world.repair(args);
  assert.equal(outcome.exitCode, 1, outcome.output);
  assert.match(outcome.output, /^span root repair REFUSED — /u);
  assert.match(outcome.output, reason);
  assert.deepEqual(world.stores(), before);
  assert.deepEqual(world.released(), touched);
  world.assertMaintenanceReleased();
}

describe("storage repair-span-root on an installation", () => {
  it("repairs the run in the store of the person who holds it and leaves the other person's store file unchanged", async () => {
    const world = await installation(["second"]);
    const firstBefore = readFileSync(world.first.path);
    const outcome = await world.repair(["--run", world.runId, "--json"]);
    assert.equal(outcome.exitCode, 0, outcome.output);
    const repaired = RepairedSchema.parse(JSON.parse(outcome.output));
    assert.equal(repaired.profileId, world.second.profileId);
    assert.deepEqual({ state: repaired.report.state, runId: repaired.report.runId }, { state: "repaired", runId: world.runId });
    assert.deepEqual(readFileSync(world.first.path), firstBefore);
    assert.deepEqual(world.released(), { reads: ["second"], repairs: ["second"] });
    assert.equal(queueRoots(world.second.path, world.runId), 1);
    world.assertMaintenanceReleased();
  });

  it("names the person and repeats as already repaired without another root", async () => {
    const world = await installation(["second"]);
    const first = await world.repair(["--run", world.runId, "--person", world.second.profileId]);
    assert.equal(first.exitCode, 0, first.output);
    assert.match(first.output, new RegExp(`^person ${world.second.profileId}\\nspan root repair — repaired `, "u"));
    const repeat = await world.repair(["--run", world.runId, "--person", world.second.profileId, "--json"]);
    assert.equal(repeat.exitCode, 0, repeat.output);
    assert.equal(RepairedSchema.parse(JSON.parse(repeat.output)).report.state, "already-repaired");
    assert.equal(queueRoots(world.second.path, world.runId), 1);
    assert.deepEqual(world.released(), { reads: ["second", "second"], repairs: ["second", "second"] });
  });

  it("refuses a run the signed-in person's store does not hold and names the people it could not search", async () => {
    const world = await installation(["first"]);
    await assertRefused(world, ["--run", world.runId],
      new RegExp(`the store of the signed-in person ${world.second.profileId} does not hold run ${world.runId}; not searched, because they are not signed in: ${world.first.profileId}`, "u"),
      { reads: ["second"], repairs: [] });
    await assertRefused(world, ["--run", world.runId, "--person", world.second.profileId], /does not hold run/u, { reads: ["second"], repairs: [] });
  });

  it("refuses --person for a person who is not signed in or not ready without opening any store", async () => {
    const world = await installation(["first", "second"]);
    await assertRefused(world, ["--run", world.runId, "--person", world.first.profileId],
      new RegExp(`person ${world.first.profileId} is not signed in`, "u"));
    await assertRefused(world, ["--run", world.runId, "--person", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      /person cccccccc-cccc-4ccc-8ccc-cccccccccccc is not a ready person on this installation/u);
    assert.equal(queueRoots(world.first.path, world.runId) + queueRoots(world.second.path, world.runId), 0);
  });

  it("refuses when nobody is signed in", async () => {
    const world = await installation(["second"], true);
    await assertRefused(world, ["--run", world.runId], /no ready person is signed in/u);
  });

  it("releases the admitted person when reading their store throws", async () => {
    const world = await installation(["second"]);
    admitted.failRead = true;
    await assertRefused(world, ["--run", world.runId], /fixture-store-read-failed/u, { reads: ["second"], repairs: [] });
  });

  it("releases the admitted person and the maintenance operation when the repair throws", async () => {
    const world = await installation(["second"]);
    admitted.failRepair = true;
    await assertRefused(world, ["--run", world.runId], /fixture-repair-failed/u, { reads: ["second"], repairs: ["second"] });
    admitted.failRepair = false;
    const raw = new DatabaseSync(world.second.path);
    try { raw.prepare("DELETE FROM timeline_events WHERE run_id=?").run(world.runId); }
    finally { raw.close(); }
    await assertRefused(world, ["--run", world.runId], /has no timeline events to recover around/u, { reads: ["second"], repairs: ["second"] });
  });

  it("asks for a profile id after --person", async () => {
    const world = await installation([]);
    const outcome = await world.repair(["--run", world.runId, "--person"]);
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.output, /^storage repair-span-root --person names one person of an installation: --person <profile-id>\n/u);
    assert.match(outcome.output, /\n {7}storage repair-span-root --run <run-id> \[--person <profile-id>\] \[--json\]\n/u);
    assert.match(outcome.output, /on an installation the repair runs in the store\n\s+of the signed-in person, which must hold the run, and --person must name them$/u);
    assert.deepEqual(world.released(), { reads: [], repairs: [] });
  });
});

describe("storage repair-span-root on a store that is not an installation", () => {
  it("repairs that store under the admission it was given and prints the bare report", async () => {
    const world = await installation(["second"]);
    assert.equal(world.person.isInstallation(), false);
    const run = (args: readonly string[]) => composeStorageCommand(rebuildRuntimeIsolation, ["repair-span-root", ...args], clock, "/unused", world.person);
    const outcome = await run(["--run", world.runId, "--json"]);
    assert.equal(outcome.exitCode, 0, outcome.output);
    const report = z.looseObject({ state: z.string(), runId: z.string() }).parse(JSON.parse(outcome.output));
    assert.deepEqual({ state: report.state, runId: report.runId, person: "profileId" in report }, { state: "repaired", runId: world.runId, person: false });
    assert.equal(queueRoots(world.second.path, world.runId), 1);
    assert.equal(admitted.reads.length, 0);
    assert.deepEqual(admitted.repairs.splice(0).map(({ owner }) => owner === world.person), [true]);
    world.person.assertLive();
    const refused = await run(["--run", world.runId, "--person", world.second.profileId]);
    assert.equal(refused.exitCode, 2);
    assert.match(refused.output, /--person names one person of an installation/u);
  });
});
