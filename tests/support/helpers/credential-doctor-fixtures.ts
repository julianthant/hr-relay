import { randomUUID } from "node:crypto";
import { default as assert } from "node:assert/strict";

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";




import { createBoundProfileFixture, boundProfileCredentials } from "./admission-fixture.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";



import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";




export function createCredentialDoctorFixtures(cleanups: (() => void | Promise<void>)[]) {
async function fixture() {
  const profile = await createBoundProfileFixture();
  cleanups.push(async () => await profile.close());
  const { workspace, admission } = profile;
  const root = profile.stateRoot;
  const credentialStore = boundProfileCredentials(admission);
  const cleared = credentialStore.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(),
    commandFingerprint: "d".repeat(64), expectedRevision: credentialStore.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    updatedAt: "2026-10-22T12:00:00.000Z", entries: { ucpathUserId: { clear: true }, ucpathPassword: { clear: true }, timekeeperName: { clear: true },
      sharepointOnboardingRosterUrl: { clear: true }, activityPersonPseudonym: { clear: true } } }));
  assert.equal(cleared.state, "applied");
  const authorityPath = join(root,"state.db");
  const database = AuthorityDatabase.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"credential-doctor-fixture"}, undefined, undefined, undefined, undefined, credentialStore);
  cleanups.push(() => database.close());
  const credentialDirectory = join(root,"credentials");
  const credentialPath = join(credentialDirectory,"protected.json");
  const options = {authorityPath,stateRoot:root,stateRootTrustAnchor:workspace,backupDirectory:join(root,"backups","authority"),busyTimeoutMs:100};
  return {root,workspace,machineRoot: profile.machine.stateRoot,admission,database,credentialDirectory,credentialPath,credentialStore,options};
}

function snapshot(root: string): unknown {
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name);
    const stat = lstatSync(path);
    const bytes = stat.isDirectory() ? undefined : readFileSync(path);
    return {
      name,
      mode: stat.mode,
      uid: stat.uid,
      ino: stat.ino,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      content: stat.isDirectory() ? snapshot(path) : bytes?.toString("base64"),
    };
  });
}
return { fixture, snapshot };
}

export function createCredentialDoctorWriter(COMMAND_ID: string, WRITE_ID: string) {
function writeCredentials(f: Awaited<ReturnType<ReturnType<typeof createCredentialDoctorFixtures>["fixture"]>>, entries: ProtectedSettingsPatch) {
  const outcome = f.credentialStore.apply(ProtectedSettingsApplyInputSchema.parse({
    commandId: COMMAND_ID,
    commandFingerprint: "1".repeat(64),
    expectedRevision: f.credentialStore.read().revision,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: WRITE_ID,
    entries,
    updatedAt: "2026-09-06T20:00:00.000Z",
  }));
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential fixture failed to apply");
  return outcome.record;
}
return writeCredentials;
}
