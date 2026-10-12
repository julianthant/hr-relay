import { default as assert } from "node:assert/strict";

import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";




import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";



import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";




export function createCredentialDoctorFixtures(cleanups: (() => void)[]) {
function fixture() {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-doctor-"));
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  const admission = acquireEntrypointAdmission(workspace,"exclusive");
  cleanups.push(() => admission.release());
  const root = admission.stateRoot;
  const authorityPath = join(root,"state.db");
  const database = AuthorityDatabase.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"credential-doctor-fixture"});
  cleanups.push(() => database.close());
  const credentialDirectory = join(root,"credentials");
  const credentialPath = join(credentialDirectory,"protected.json");
  const credentialStore = createCredentialStore({admission,stateRoot:root});
  const options = {authorityPath,stateRoot:root,stateRootTrustAnchor:workspace,backupDirectory:join(root,"backups","authority"),busyTimeoutMs:100};
  return {root,workspace,admission,database,credentialDirectory,credentialPath,credentialStore,options};
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
function writeCredentials(f: ReturnType<ReturnType<typeof createCredentialDoctorFixtures>["fixture"]>, entries: ProtectedSettingsPatch) {
  const outcome = f.credentialStore.apply(ProtectedSettingsApplyInputSchema.parse({
    commandId: COMMAND_ID,
    commandFingerprint: "1".repeat(64),
    expectedRevision: 1,
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
