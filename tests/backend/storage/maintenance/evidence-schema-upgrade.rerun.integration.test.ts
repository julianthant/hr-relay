import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { predecessorSeparationsRerun } from "../../../support/helpers/backend/predecessor-separations-rerun.js";
import { assertConversionRefused, CLOCK, conversions, frozenRows } from "../../../support/helpers/backend/evidence-schema-upgrade-startup.js";

// Catch any fixture composition that accidentally falls back to elapsed system time.
vi.mock("../../../../src/rules/time/clock.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../src/rules/time/clock.js")>();
  let elapsedMs = 0;
  return { ...actual, systemClock: { ...actual.systemClock, monotonicMs: () => elapsedMs += 51 } };
});
// Sign-up and sign-in verify at one cheaper scrypt cost; these files prove the evidence upgrade, not the password hash.
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scryptSync: (...[password, salt, length, options]: Parameters<typeof actual.scryptSync>) => actual.scryptSync(password, salt, length, { ...options, N: 2 ** 10 }) };
});

it("opens certified predecessor Separations Rerun after backed startup and derives fresh admitted identity", async () => {
  const f = await predecessorSeparationsRerun();
  const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
  const { acquireEntrypointAdmission } = await import("../../../../src/backend/storage/admission/bootstrap-admission.js");
  const { initializeRegisteredPersonStores, composeProfileRuntime } = await import("../../../../src/backend/app/composition/storage-compose.js");
  const { AuthorityDatabase } = await import("../../../../src/backend/storage/sqlite/authority-database.js");
  const { createCredentialStore } = await import("../../../../src/backend/storage/configuration/credential-store.js");
  const { createCredentialSecretSource, readAdmittedProfileIdentity } = await import("../../../../src/backend/runtime/settings/settings-runtime.js");
  const { readRerunValues } = await import("../../../../src/backend/runs/start/rerun-values.js");
  const { createStartPlanService } = await import("../../../../src/backend/runs/commands/start-plan-service.js");
  const { separationsDescriptor: descriptor } = await import("../../../support/helpers/registered-workflows.js");
  const { sequentialIdFactory } = await import("../../../support/fixtures/phase1f-run-fixtures.js");
  const { repeatEvidenceDigest } = await import("../../../../src/models/run/rerun.js");
  const { profileInitials } = await import("../../../../src/models/profiles/profile-identity.js");
  const before = frozenRows(f.path), lifetime = await RuntimeLifetimeLock.acquire(0);
  try {
    const startup = () => initializeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null }, CLOCK);
    if (process.platform === "win32") {
      await startup(); await assertConversionRefused(f.workspace, lifetime);
      assert.deepEqual(frozenRows(f.path), before); assert.equal(conversions(f.path).length, 0); return;
    }
    await startup(); assert.equal(conversions(f.path).length, 1); assert.deepEqual(frozenRows(f.path), before);
    const journal = conversions(f.path), backups = readdirSync(join(f.stateRoot, "backups", "authority")).sort();
    await startup(); assert.deepEqual(conversions(f.path), journal);
    assert.deepEqual(readdirSync(join(f.stateRoot, "backups", "authority")).sort(), backups);
    assert.deepEqual(frozenRows(f.path), before);
    const machine = acquireEntrypointAdmission(f.workspace, "exclusive", lifetime);
    const runtime = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: CLOCK });
    try {
      const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: CLOCK.now().toISOString() });
      assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("converted-rerun-sign-in-refused");
      // The account enters initials of its own, so a plan that derived letters from the name would be caught.
      assert.equal(runtime.session.changeDetails(active.token, { timekeeperInitials: "QZ" }).state, "changed");
      const admission = machine.admitProfile(active.profileId), credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
      const database = AuthorityDatabase.open(admission, { path: f.path, migrationOwner: "certified-rerun-readback", busyTimeoutMs: 250 }, CLOCK,
        undefined, undefined, undefined, credentials);
      try {
        const identity = readAdmittedProfileIdentity(machine, admission), request = { runId: f.run.envelope.runId, expectedVersion: f.run.version };
        const descriptors = { resolve: () => descriptor }, reader = { read: () => ({ state: "present" as const, disposition: "live" as const, run: f.run }) };
        const values = readRerunValues({ database, reader, descriptors }, request);
        assert.equal(values.state, "available"); if (values.state !== "available") throw new Error("converted-rerun-values-refused");
        const write = f.writes.find(intent => intent.status === "committed"); assert.ok(write);
        const digest = repeatEvidenceDigest(write, f.run.input.parsed.protectedBindings);
        assert.ok(values.snapshot.transactions.some(transaction => transaction.evidenceDigest === digest));
        const config = database.authority.runtimeConfig.get(); assert.ok(config);
        const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock: CLOCK,
          ids: sequentialIdFactory("b"), planTtlMs: 600_000, plannedBy: "local-operator", configFingerprint: config.configFingerprint,
          configSnapshotId: config.configSnapshotId, protectedSecrets: createCredentialSecretSource(credentials, () => readAdmittedProfileIdentity(machine, admission)) });
        const source = { ...request, intent: "rerun", selectedStepKeys: descriptor.timeline.map(step => step.key) };
        const warning = planner.previewWarnings({ workflowId: descriptor.id, source });
        assert.ok(warning.rerun.warnings.some(entry => entry.evidenceDigest === digest));
        assert.deepEqual(frozenRows(f.path), before);
        const documentNumber: unknown = Reflect.get(Object(f.run.input.parsed.value), "documentNumber");
        const input = { workflowId: descriptor.id, submissions: [{ documentNumber }],
          dryRun: true, selectedStepKeys: source.selectedStepKeys, rerunSource: source, warningAcknowledgment: warning.rerun.warningDigest };
        const plan = planner.plan(input); assert.equal(plan.refused.length, 0); assert.equal(plan.rerun?.warningDigest, warning.rerun.warningDigest);
        const retained = database.authority.startPlans.get(plan.startPlanId); assert.ok(retained);
        assert.equal(Reflect.get(Object(retained.planned[0]?.input.value), "timekeeperName"), identity.displayName);
        assert.notEqual(identity.displayName, Reflect.get(Object(f.run.input.parsed.value), "timekeeperName"));
        assert.equal(identity.initials, "QZ"); assert.notEqual(profileInitials(identity.displayName), identity.initials);
        assert.equal(Reflect.get(Object(retained.planned[0]?.input.value), "timekeeperInitials"), identity.initials);
        assert.equal(Object.hasOwn(z.record(z.string(), z.unknown()).parse(f.run.input.parsed.value), "timekeeperInitials"), false);
        assert.throws(() => planner.plan({ ...input, submissions: [{ ...input.submissions[0], timekeeperName: "Caller Override" }] }));
        for (const wire of [values, warning, plan]) {
          assert.equal(JSON.stringify(wire).includes("Deterministic Timekeeper"), false);
          assert.equal(JSON.stringify(wire).includes(identity.displayName), false);
        }
        assert.deepEqual(database.authority.runs.get(f.run.envelope.runId), f.run);
        assert.deepEqual(database.authority.writeIntents.listByRun(f.run.envelope.runId), f.writes);
      } finally { database.close(); admission.release(); }
    } finally { await runtime.close(); machine.release(); }
  } finally { await lifetime.close(); await f.cleanup(); }
});
