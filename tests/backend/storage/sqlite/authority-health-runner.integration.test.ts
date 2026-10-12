import assert from "node:assert/strict";
import {
chmodSync,
lstatSync,
mkdtempSync,
readFileSync,
readdirSync,
realpathSync,
rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterEach,describe,it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import {
PROTECTED_SETTINGS_SCHEMA_HASH,
ProtectedSettingsApplyInputSchema,
ProtectedSettingsNameSchema,
type ProtectedSettingsPatch,
} from "../../../../src/models/config/protected-settings.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});

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

function writeCredentials(f: ReturnType<typeof fixture>, entries: ProtectedSettingsPatch) {
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

describe("credential presence doctor", () => {

  it("reports the same presence facts through authority.health and fails unreadable closed", async () => {
    const f = fixture();
    writeCredentials(f, { timekeeperName: { set: "Protected Doctor Canary" } });
    const runner = new AuthorityHealthPreflightRunner(f.admission,f.options);
    const context = {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      deadlineMonotonicMs: 10_000,
      redaction: "presence-only" as const,
    };
    const before = snapshot(f.root);
    const observation = await runner.run(context);
    assert.ok(isDeepStrictEqual(snapshot(f.root), before), "preflight changed source inventory or bytes");
    for (const name of ProtectedSettingsNameSchema.options) {
      assert.ok(observation.summary.includes(
        `${name}=${name === "timekeeperName" ? "present" : "absent"}`,
      ));
    }
    assert.equal(observation.summary.includes("Protected Doctor Canary"), false);

    chmodSync(f.credentialPath, 0o644);
    const unavailable = await runner.run(context);
    assert.equal(unavailable.state, "unhealthy");
    assert.ok(unavailable.summary.includes("could not be verified read-only"));
    assert.equal(unavailable.summary.includes(f.root), false);
  });
});
