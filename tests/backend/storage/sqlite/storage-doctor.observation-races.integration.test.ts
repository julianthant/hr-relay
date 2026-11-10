import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { join } from "node:path";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { createPreflightAdmission, PreflightAdmissionScopeSchema, PreflightObservationChangedError } from "../../../../src/rules/preflight/preflight-admission.js";
import { claimWithPreflight } from "../../../../src/backend/app/preflight/worker-admission.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { requiredPreflightChecks } from "../../../../src/models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../../src/models/runtime/runtime-dependencies.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { NOW, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const cleanups: (() => void | Promise<void>)[] = [];
const { fixture } = createCredentialDoctorFixtures(cleanups);
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const context = { signal: new AbortController().signal, timeoutMs: 10_000, deadlineMonotonicMs: 10_000, redaction: "presence-only" as const };

function notify(f: Awaited<ReturnType<typeof fixture>>) {
  const notificationId = randomUUID();
  f.database.authority.notifications.create({ notificationId, actorId: "local-operator", dedupeFingerprint: "e".repeat(64),
    trigger: "failed", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Fixture notice",
    summary: "Concurrent fixture write", links: [{ kind: "run", runId: UUID_1 }], count: 1, lastSeenAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW });
  return notificationId;
}

it("keeps a concurrent durable write as a distinct doctor failure without accepting mixed evidence", async () => {
  const f = await fixture();
  assert.equal((await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore)).authority.state, "healthy");
  const before = f.database.getMeta().authorityGeneration;
  const checking = doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore);
  notify(f);
  assert.equal(f.database.getMeta().authorityGeneration, before + 1);
  await assert.rejects(checking, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "StorageDoctorObservationChangedError");
    assert.match(error.message, /authority changed while the storage doctor awaited external evidence/u);
    return true;
  });
  assert.equal((await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore)).authority.state, "healthy");
});

it("maps only the real doctor observation race into the preflight refusal type", async () => {
  const f = await fixture();
  const runner = new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore);
  const checking = runner.run(context);
  notify(f);
  await assert.rejects(checking, PreflightObservationChangedError);
});

for (const method of ["inspectExistingReadOnly", "inspectSpanRunAuthorityReadOnly"] as const) it(`treats a transient SQLite lock in ${method} as changed observation`, async () => {
  const f = await fixture();
  vi.spyOn(AuthorityDatabase, method).mockImplementationOnce(() => { throw new Error("database is locked"); });
  await assert.rejects(new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore).run(context), PreflightObservationChangedError);
  assert.equal((await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore)).authority.state, "healthy");
});

it("rejects split corpus/run read snapshots as changed observation", async () => {
  const f = await fixture();
  const inspect = AuthorityDatabase.inspectSpanRunAuthorityReadOnly.bind(AuthorityDatabase);
  vi.spyOn(AuthorityDatabase, "inspectSpanRunAuthorityReadOnly").mockImplementationOnce((...args) => {
    const snapshot = inspect(...args);
    return { ...snapshot, authorityGeneration: snapshot.authorityGeneration + 1 };
  });
  await assert.rejects(new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore).run(context), PreflightObservationChangedError);
});

async function racingClaim(world: ReturnType<typeof createWorkerDirectiveTestWorld>, racedObservations: number) {
  const h = await world.loopHarness(), a = h.authority;
  const scope = PreflightAdmissionScopeSchema.parse({ configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
    configFingerprint: QUEUED_RUN.envelope.configFingerprint, descriptorFingerprint: QUEUED_RUN.envelope.contractFingerprint, requestedCapabilities: ["executor.run"] });
  const doctor = new AuthorityHealthPreflightRunner(a.profile.admission, { stateRootTrustAnchor: a.profile.workspace, stateRoot: a.stateRoot,
    authorityPath: a.path, backupDirectory: join(a.stateRoot, "backups", "authority"), busyTimeoutMs: 250 }, a.clock, boundProfileCredentials(a.profile.admission));
  const counts = { observations: 0, preparations: 0, claims: 0, reprepared: [] as number[] };
  const admission = createPreflightAdmission({ clock: a.clock, scheduler: h.scheduler, validate() {},
    runners: () => PREFLIGHT_CHECKS.filter(spec => requiredPreflightChecks(["executor.run"]).includes(spec.id)).map(spec => ({ check: spec.id, kind: spec.runner,
      async run(check) {
        if (spec.id !== "authority.health") return { check: spec.id, state: "healthy", summary: "Fixture healthy" };
        counts.observations++;
        const checking = doctor.run(check);
        if (counts.observations <= racedObservations) a.database.authority.notifications.create({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: randomUUID().replaceAll("-", "").padEnd(64, "e"), trigger: "failed", channel: "ping",
          status: "unread", snooze: { state: "not-snoozed" }, title: "Fixture notice", summary: "Concurrent fixture write", links: [{ kind: "run", runId: UUID_1 }],
          count: 1, lastSeenAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW });
        return checking;
      },
    })) });
  const claimNext = () => claimWithPreflight({ signal: h.stop.signal, onObservationChanged: attempt => { counts.reprepared.push(attempt); },
    preflight: { admission, currentScope: () => scope, runScope: () => scope, descriptor: () => personLookupDescriptor,
      prepareSession: async () => { throw new Error("no session should prepare"); } },
    prepareRun: async () => { counts.preparations++; }, claim: admit => { admit(RunRecordSchema.parse(QUEUED_RUN)); counts.claims++; throw new Error("no claim should commit"); } });
  return { h, counts, claimNext };
}

it("stops the real worker loop before claim and browser preparation when every bounded re-preparation observes a concurrent write", async () => {
  const world = createWorkerDirectiveTestWorld();
  try {
    const { h, counts, claimNext } = await racingClaim(world, Number.POSITIVE_INFINITY);
    const report = await runWorkerLoop({ ...h.deps, claimNext });
    assert.equal(report.stopped, "preflight-refused"); assert.equal(report.closure, "proved");
    assert.equal(report.preflightRefusal?.runId, QUEUED_RUN.envelope.runId); assert.deepEqual(report.outcomes, []);
    assert.equal(counts.observations, 4); assert.deepEqual(counts.reprepared, [1, 2, 3]);
    assert.equal(counts.preparations, 0); assert.equal(counts.claims, 0);
    assert.equal(h.sessions.opens("ucpath"), 0); assert.equal(h.sessions.opens("crm"), 0);
  } finally { await world.cleanup(); }
});

it("re-prepares after one concurrent write during the doctor's backup check and admits the claim", async () => {
  const world = createWorkerDirectiveTestWorld();
  try {
    const { counts, claimNext } = await racingClaim(world, 1);
    await assert.rejects(claimNext(), /no claim should commit/u);
    assert.equal(counts.observations, 2); assert.deepEqual(counts.reprepared, [1]);
    assert.equal(counts.preparations, 1); assert.equal(counts.claims, 1);
  } finally { await world.cleanup(); }
});

for (const change of ["same-generation-content", "backwards-generation", "unavailable"] as const) it(`does not relabel ${change} as an expected doctor race`, async () => {
  const f = await fixture();
  const notificationId = notify(f);
  const generation = f.database.getMeta().authorityGeneration;
  const runner = new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore);
  const checking = runner.run(context);
  using raw = new DatabaseSync(f.options.authorityPath);
  const meta = raw.prepare("SELECT schema_version FROM database_states WHERE id=1").get();
  assert.ok(meta && typeof meta.schema_version === "number");
  try {
    if (change === "same-generation-content") raw.prepare("UPDATE notifications SET payload_json=json_set(payload_json,'$.summary',?) WHERE id=?").run("Unjournaled content drift", notificationId);
    else if (change === "backwards-generation") raw.prepare("UPDATE database_states SET authority_generation=?,search_state='invalid' WHERE id=1").run(generation - 1);
    else raw.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(meta.schema_version + 1);
    if (change === "same-generation-content") assert.equal(f.database.getMeta().authorityGeneration, generation);
    await assert.rejects(checking, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof PreflightObservationChangedError, false);
      assert.notEqual(error.name, "StorageDoctorObservationChangedError");
      assert.match(error.message, /authority changed while the storage doctor awaited external evidence/u);
      return true;
    });
  } finally {
    raw.prepare("UPDATE database_states SET authority_generation=?,schema_version=? WHERE id=1").run(generation, meta.schema_version);
  }
});
