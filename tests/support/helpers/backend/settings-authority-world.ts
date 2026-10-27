import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand, type CommandAuthority } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { createCredentialStore as nativeCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase, createCredentialStore, type CredentialStoreHooks } from "../synthetic-storage-admission.js";
import { seedSyntheticRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";





export function createSettingsAuthorityTestWorld() {
  const roots: string[] = [];

  const databases: AuthorityDatabase[] = [];

  const admissions: RuntimeAdmission[] = [];
  const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];

  async function fixture(hooks?: CredentialStoreHooks, exclusive = false, sharedMachine = false) {
    if (exclusive && sharedMachine) throw new Error("exclusive settings fixture cannot share machine");
    const profile = await createBoundProfileFixture(sharedMachine ? { sharedMachine: true } : {}); profiles.push(profile);
    const repoRoot = profile.workspace; roots.push(repoRoot);
    const admission = exclusive ? profile.admission : undefined;
    if (admission !== undefined) admissions.push(admission);
    const root = profile.stateRoot;
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
    const clock = manualClock(new Date("2026-09-06T12:00:00Z"));
    const path = profile.path;
    const options = { path, busyTimeoutMs: 250, migrationOwner: "settings-test" };
    const credentialOptions = { stateRoot: root, ...(hooks === undefined ? {} : { hooks }) };
    const store = admission === undefined ? createCredentialStore(credentialOptions) : nativeCredentialStore({ ...credentialOptions, admission,
      erasureJournalAdmission: profile.machine, erasureJournalPath: join(profile.machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
    const database = admission === undefined ? AuthorityDatabase.open(options, clock) : NativeAuthorityDatabase.open(admission, options, clock, undefined, undefined, undefined, store); databases.push(database);
    seedSyntheticRuntimeConfig(database);
    const registered = profile.machine.readProfileRegistry().profiles.find(row => row.profileId === profile.admission.profileBinding.profileId);
    assert.ok(registered?.lifecycle === "ready" && registered.credentialState === "saved");
    assert.equal(store.ownsCommandId(registered.registration.commandId), true);
    assert.equal(store.read().revision, registered.registration.credentialRevision);
    const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), store);
    const execute = (request: unknown, authority: CommandAuthority = database) => executeSettingsCommand({ authority, clock, ids: { uuid: randomUUID }, settings }, request);
    const renewAfterRestore = () => {
      const renewed = profile.renewAfterRestore();
      const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), renewed.credentials);
      return { admission: renewed.admission, store: renewed.credentials,
        execute: (request: unknown, authority: CommandAuthority) => executeSettingsCommand({ authority, clock, ids: { uuid: randomUUID }, settings }, request) };
    };
    return { repoRoot, root, path, database, store, execute, clock, admission, renewAfterRestore };
  }

  function protectedCommand(expectedRevision: number) {
    return { family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
      target: { expectedRevision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-private-value" } } } };
  }

  function failAudit(database: AuthorityDatabase): CommandAuthority {
    return { withAuthorityTransaction: (work) => database.withAuthorityTransaction((repositories) => work({ ...repositories,
      commandAudits: { ...repositories.commandAudits, insert: () => { throw new Error("injected audit failure"); } },
    })) };
  }
  const cleanup = async () => { for (const database of databases.splice(0)) database.close(); for (const admission of admissions.splice(0)) admission.release(); for (const profile of profiles.splice(0)) await profile.close(); roots.splice(0); };
  return { roots, databases, admissions, fixture, protectedCommand, failAudit, cleanup };
}
