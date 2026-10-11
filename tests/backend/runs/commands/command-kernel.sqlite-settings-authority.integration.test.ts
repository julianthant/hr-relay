import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createCommandKernel,executeSettingsCommand,type CommandAuthority } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as nativeCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase,createCredentialStore,type CredentialStoreHooks } from "../../../support/helpers/synthetic-storage-admission.js";

import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { NO_INTAKE_PROJECTIONS,UNSTORED_CONFIG_IDENTITY,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { seedSyntheticRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";

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
  it("refuses a retained credential identity before async worker-pool effects", async () => {
    const f = fixture();
    const pending = protectedCommand();
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    const before = f.store.read();
    const generation = f.database.getMeta().authorityGeneration;
    let effects = 0;
    const unused = (): never => { effects++; throw new Error("unexpected kernel seam"); };
    const ids = { uuid: randomUUID };
    const kernel = createCommandKernel({
      authority: f.database, clock: f.clock, ids,
      lifecycle: new RunRecordService({ database: f.database, clock: f.clock, ids, publishQueued: () => {} }),
      appVersion: "0.1.0",
      configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      descriptors: { resolve: (id) => DESCRIPTORS.find((descriptor) => String(descriptor.id) === id) },
      writeResolution: { resolvePresent: unused, resolveAbsent: unused },
      workerRuntime: { pool: {
        planPoolWorkerCount: () => { effects++; return Promise.resolve({ state: "accepted", workerIds: ["person-lookup-worker-1"], retirements: [] }); },
        spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
        stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused,
      } },
    });
    const command = { family: "worker-browser", type: "plan-worker-count", commandId: pending.commandId,
      requestedAt: pending.requestedAt, requestedBy: "local-operator", source: "dashboard",
      target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } };
    const result = await kernel.executeWorkerPool(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "command-divergent");
    assert.equal(effects, 0, "phase A must refuse before the external process seam, even though phase C also checks identity");
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.database.authority.workerPools.get("person-lookup"), undefined);
    assert.deepEqual(f.store.read(), before);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.execute(pending).state, "applied");
    // Positive control: the same valid pool request reaches its effect with a fresh ID.
    assert.equal((await kernel.executeWorkerPool({ ...command, commandId: randomUUID() })).state, "applied");
    assert.equal(effects, 1);
    assert.deepEqual(readFileSync(path), bytes);
  });
});
