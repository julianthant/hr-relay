import type { RuntimeAdmission } from '../../../../src/backend/storage/admission/admission.js';
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { it } from "vitest";
import { composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeProfileCredentialRepairInventory, composeProfileCredentialInitializationInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createCredentialStore, readForErasure, observeCredentialPresence } from "../../../../src/backend/storage/configuration/credential-store.js";
import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const retainedRestoredErasureOwners = new Set<object>();

for (const copy of ["none", "encrypted-stage", "missing-owner", "membership-mutation", "never-initialized", "missing-with-history", "retained-active-engine"] as const) it(`guards restored partial-history repair with ${copy} and preserves exact original erasure identity`, async () => {
  const held: { fixture?: ReturnType<typeof createBoundProfileFixture>; context?: ReturnType<typeof composeSelectedProfileStorage>;
    session?: ReturnType<typeof createProfileSession>; child?: RuntimeAdmission;
    settlement?: RuntimeAdmission;
    inventoryAdmission?: RuntimeAdmission;
    database?: DatabaseSync; primary?: unknown } = {};
  retainedRestoredErasureOwners.add(held);
  let primary: { error: unknown } | undefined;
  try {
    const f = createBoundProfileFixture();
    held.fixture = f;
    const clock = manualClock(new Date("2026-10-22T12:00:00.000Z"));
    assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(f.admission).settingsAuthority.state, "never-initialized");
    if (copy !== "never-initialized") {
      const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
      held.context = context;
      await context.account.close(); context.database.close();
      assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(f.admission).settingsAuthority.state, "initialized");
    }
    const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot, activity: { hasUnquiescedWork: () => false },
      repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine: f.machine, admission: child, clock, hostFacts: { primaryDisplay: null } })(request, writer, copies),
      initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine: f.machine, admission: child,
        clock, hostFacts: { primaryDisplay: null } })(operation, writer, copies) });
    held.session = session;
    const active = session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("genuine profile sign-in refused");
    const child = f.machine.admitProfile(createProfileRegistry(f.machine).storageClaim(active.profileId));
    held.child = child;
    const journalPath = join(f.machine.stateRoot, "machine", "erasures", `${active.profileId}.json`);
    const store = createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalAdmission: f.machine, erasureJournalPath: journalPath });
    const path = join(child.stateRoot, "credentials", "protected.json"), older = readFileSync(path), prior = store.read();
    const request = ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "d".repeat(64),
      expectedRevision: prior.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: clock.now().toISOString(),
      entries: { ucpathPassword: { set: "synthetic-newer-erased-value" } } });
    assert.equal(store.apply(request).state, "applied");
    const erased = session.logOut(active.token, { at: clock.now().toISOString() });
    assert.equal(erased.state, "refused");
    if (erased.state !== "refused" || erased.operationId === undefined) throw new Error("exact retained logout operation required");
    const operationPath = join(f.machine.stateRoot, "machine", "operations", `${erased.operationId}.json`);
    const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
    f.machine.publishProfileOperation({ ...operation, phase: "erasing" });
    const settlement = f.machine.admitProfile(createProfileRegistry(f.machine).settlementClaim(erased.operationId));
    held.settlement = settlement;
    const retained = createCredentialStore({ admission: settlement, stateRoot: settlement.stateRoot, erasureJournalAdmission: f.machine, erasureJournalPath: journalPath,
      ...(copy === "missing-owner" ? {} : { repairInventory: (request, writer, copies) => {
        const inventory = composeProfileCredentialRepairInventory({ machine: f.machine, admission: settlement, clock, hostFacts: { primaryDisplay: null } })(request, writer, copies);
        if (copy === "membership-mutation") writeFileSync(join(f.stateRoot, "unowned.json"), "{}", { mode: 0o600 });
        return inventory;
      } }) });
    const erase = CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId, expectedRevision: operation.expectedRevision,
      commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: operation.at });
    {
      writeFileSync(path, older, { mode: 0o600 });
      const passiveBefore = readFileSync(path), passiveHead = readFileSync(journalPath), passiveAnchor = readFileSync(`${journalPath}.authority`);
      assert.throws(() => observeCredentialPresence(retained, settlement), /profile-settlement-credential-read-refused/u);
      assert.equal(readFileSync(path).equals(passiveBefore), true);
      assert.equal(readFileSync(journalPath).equals(passiveHead), true);
      assert.equal(readFileSync(`${journalPath}.authority`).equals(passiveAnchor), true);
      assert.throws(() => store.read(), error => {
        if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
        return true;
      });
      const stage = join(f.stateRoot, "credentials", `.protected.${randomUUID()}.${randomUUID()}.tmp`);
      if (copy === "encrypted-stage") copyFileSync(path, stage);
      const activeEnginePath = join(f.stateRoot, "credentials", "duo-webauthn.json");
      if (copy === "retained-active-engine") writeFileSync(activeEnginePath, JSON.stringify({ rpId: "duosecurity.com", credentialId: "synthetic-retained-id",
        privateKey: "synthetic-retained-key", signCount: 42, transport: "internal" }), { mode: 0o600 });
      if (copy === "missing-with-history") {
        const database = new DatabaseSync(f.path);
        held.database = database;
        database.prepare("DELETE FROM settings WHERE id='current'").run();
        database.close();
        const inventoryAdmission = settlement.forCredentialRepairInventory(erase);
        held.inventoryAdmission = inventoryAdmission;
        assert.throws(() => AuthorityDatabase.readProfileMaintenanceInventory(inventoryAdmission), /settings-current-missing-with-history/);
        inventoryAdmission.release();
      }
      if (copy !== "none" && copy !== "never-initialized") {
        const before = readFileSync(path), head = readFileSync(journalPath), anchor = readFileSync(`${journalPath}.authority`);
        if (copy === "retained-active-engine") {
          const activeEngineBytes = readFileSync(activeEnginePath);
          assert.throws(() => retained.erase(erase), /credential-maintenance-copy-capture-incomplete/u);
          assert.equal(readFileSync(activeEnginePath).equals(activeEngineBytes), true);
        } else assert.throws(() => retained.erase(erase), error => {
        if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
        return true;
      });
        assert.equal(readFileSync(path).equals(before), true); assert.equal(readFileSync(journalPath).equals(head), true);
        assert.equal(readFileSync(`${journalPath}.authority`).equals(anchor), true);
        if (copy === "encrypted-stage") unlinkSync(stage);
      } else {
      const exact = retained.erase(erase); assert.equal(exact.state, "applied");
      const observed = readForErasure(retained, erased.operationId);
      assert.equal(observed.revision, prior.revision + 1);
      assert.equal(observed.entries.ucpathUserId, undefined); assert.equal(observed.entries.ucpathPassword, undefined);
      assert.equal(retained.erase(erase).state, "applied");
      const before = readFileSync(path);
      assert.throws(() => retained.erase(CredentialEraseInputSchema.parse({ ...erase, expectedRevision: erase.expectedRevision - 1 })), error => {
        if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
        return true;
      });
      assert.throws(() => retained.erase(CredentialEraseInputSchema.parse({ ...erase, commandId: randomUUID() })), error => {
        if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
        return true;
      });
      assert.equal(readFileSync(path).equals(before), true);
      }
    }

  } catch (error) { primary = { error }; held.primary = error; }
  if (primary !== undefined) throw retainAuthoritySourceClosure([primary.error], { admission: held });
  try {
    held.settlement?.release(); held.child?.release(); held.fixture?.close();
    retainedRestoredErasureOwners.delete(held);
  } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
});
