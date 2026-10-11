import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand,type CommandAuthority } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../src/backend/runs/commands/settings-service.js";
import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as nativeCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/models/config/protected-settings.js";
import { CommandIdentityConflictError } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase,createCredentialStore,type CredentialStoreHooks } from "../../support/helpers/synthetic-storage-admission.js";

import { seedSyntheticRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const admissions: RuntimeAdmission[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const admission of admissions.splice(0)) admission.release(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(hooks?: CredentialStoreHooks, exclusive = false) {
  const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "sqlite-settings-")); roots.push(repoRoot);
  const admission = exclusive ? acquireEntrypointAdmission(repoRoot, "exclusive") : undefined;
  if (admission !== undefined) admissions.push(admission);
  const root = join(repoRoot, rebuildRuntimeIsolation.stateRoot); mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock(new Date("2026-09-06T12:00:00Z"));
  const path = join(root, "state.db");
  const options = { path, busyTimeoutMs: 250, migrationOwner: "settings-test" };
  const database = admission === undefined ? AuthorityDatabase.open(options, clock) : NativeAuthorityDatabase.open(admission, options, clock); databases.push(database);
  seedSyntheticRuntimeConfig(database);
  const credentialOptions = { stateRoot: root, ...(hooks === undefined ? {} : { hooks }) };
  const store = admission === undefined ? createCredentialStore(credentialOptions) : nativeCredentialStore({ ...credentialOptions, admission });
  const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), store);
  const execute = (request: unknown, authority: CommandAuthority = database) => executeSettingsCommand({ authority, clock, ids: { uuid: randomUUID }, settings }, request);
  return { repoRoot, root, path, database, store, execute, clock, admission };
}
function protectedCommand() {
  return { family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: 1 }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-private-value" } } } };
}
function failAudit(database: AuthorityDatabase): CommandAuthority {
  return { withAuthorityTransaction: (work) => database.withAuthorityTransaction((repositories) => work({ ...repositories,
    commandAudits: { ...repositories.commandAudits, insert: () => { throw new Error("injected audit failure"); } },
  })) };
}

describe("SQLite settings authority", () => {
  it("protects a retained credential identity from internal lifecycle journal writers", () => {
    const f = fixture(); const pending = protectedCommand();
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const generation = f.database.getMeta().authorityGeneration;
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    assert.throws(() => f.database.withAuthorityTransaction((repositories) => repositories.lifecycleJournal.insertCommand({
      kind: "run-lifecycle", commandId: pending.commandId, operation: "create",
      requestFingerprint: "0".repeat(64), request: {}, fence: { kind: "none" }, recordedAt: pending.requestedAt,
    })), CommandIdentityConflictError);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.execute(pending).state, "applied");
  });
});
