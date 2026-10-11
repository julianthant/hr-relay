import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand, type CommandAuthority } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
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
  return { roots, databases, admissions, fixture, protectedCommand, failAudit };
}
