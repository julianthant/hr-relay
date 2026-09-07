import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  ProtectedSettingsNameSchema,
  type ProtectedSettingsPatch,
} from "../../src/domain/config/protected-settings.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { AuthorityHealthPreflightRunner } from "../../src/infra/sqlite/authority-health-runner.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../src/infra/sqlite/storage-doctor.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hr-credential-doctor-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const authorityPath = join(root, "state.db");
  const database = AuthorityDatabase.open({
    path: authorityPath,
    busyTimeoutMs: 100,
    migrationOwner: "unit-test",
  });
  cleanups.push(() => database.close());
  const credentialDirectory = join(root, "credentials");
  const credentialPath = join(credentialDirectory, "protected.json");
  const credentialStore = createCredentialStore({ stateRoot: root });
  const options = {
    authorityPath,
    stateRoot: root,
    stateRootTrustAnchor: root,
    backupDirectory: join(root, "backups"),
    busyTimeoutMs: 100,
  };
  return { root, database, credentialDirectory, credentialPath, credentialStore, options };
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
    if (name === "state.db-shm") {
      assert.ok(bytes && bytes.length >= 136);
      bytes.fill(0, 100, 120);
    }
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

async function unchanged(f: ReturnType<typeof fixture>) {
  const before = snapshot(f.root);
  const meta = f.database.getMeta();
  const report = await doctorAuthorityStorage(f.options);
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(f.database.getMeta(), meta);
  return report.protectedSettings;
}

describe("D336 credential presence doctor", () => {
  it("reports every name and presence without a credential value or identity", async () => {
    const f = fixture();
    const record = writeCredentials(f, {
      timekeeperName: { set: "Protected Doctor Canary" },
      ucpathPassword: { set: "doctor-private-password" },
    });

    const report = await unchanged(f);

    assert.deepEqual(report, {
      state: "available",
      entries: ProtectedSettingsNameSchema.options.map((name) => ({
        name,
        present: name === "timekeeperName" || name === "ucpathPassword",
      })),
    });
    const serialized = JSON.stringify(report);
    for (const entry of Object.values(record.entries)) {
      assert.equal(serialized.includes(
        typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value),
      ), false);
      assert.equal(serialized.includes(entry.valueId), false);
      assert.equal(serialized.includes(entry.updatedAt), false);
    }
  });

  it("treats an absent credential store as the read-only empty baseline", async () => {
    const f = fixture();
    assert.deepEqual(await unchanged(f), {
      state: "available",
      entries: ProtectedSettingsNameSchema.options.map((name) => ({ name, present: false })),
    });
  });

  it.each(["corrupt", "permissions"])(
    "keeps %s credential state unavailable and untouched with a closed diagnostic",
    async (fault) => {
      const f = fixture();
      writeCredentials(f, { timekeeperName: { set: "Protected Doctor Canary" } });
      if (fault === "corrupt") writeFileSync(f.credentialPath, "Protected Doctor Canary");
      if (fault === "permissions") chmodSync(f.credentialPath, 0o644);

      assert.deepEqual(await unchanged(f), {
        state: "unavailable",
        cause: {
          code: "authority-unavailable",
          summary: "credentials in credentials could not be verified read-only",
        },
      });
    },
  );

  it("reports the same presence facts through authority.health and fails unreadable closed", async () => {
    const f = fixture();
    writeCredentials(f, { timekeeperName: { set: "Protected Doctor Canary" } });
    const runner = new AuthorityHealthPreflightRunner(f.options);
    const context = {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      deadlineMonotonicMs: 10_000,
      redaction: "presence-only" as const,
    };
    const before = snapshot(f.root);
    const observation = await runner.run(context);
    assert.deepEqual(snapshot(f.root), before);
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
