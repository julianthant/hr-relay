import { runInheritedRuntimeChild } from "../../../support/helpers/backend/runtime-lifetime.js";
import { createSettingsAuthorityTestWorld } from "../../../support/helpers/backend/settings-authority-world.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "vitest";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";

const {fixture, protectedCommand, failAudit, cleanup } = createSettingsAuthorityTestWorld();

afterEach(cleanup);
function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
}

describe("SQLite settings authority", () => {
  it("rolls ordinary values and every journal effect back on an audit failure", async () => {
    const f = await fixture(); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert.throws(() => f.execute(request, failAudit(f.database)), /injected audit failure/u);
    assert.equal(f.database.getMeta().authorityGeneration, before);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.equal(f.execute(request).state, "applied");
  });
  it("refuses a foreign journal identity before committing credentials", async () => {
    const f = await fixture(); const existing = ordinary();
    f.execute(existing);
    const generation = f.database.getMeta().authorityGeneration;
    const audit = f.database.authority.commandAudits.findByCommand(existing.commandId);
    const before = f.store.read();
    const credentialBaseline = storageTree(join(f.root, "credentials"));
    assert.ok(Object.hasOwn(credentialBaseline, "protected.json"));
    const result = f.execute({ ...protectedCommand(f.store.read().revision), commandId: existing.commandId });
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "command-divergent");
    assert.deepEqual(f.store.read(), before);
    assert.deepEqual(storageTree(join(f.root, "credentials")), credentialBaseline);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(f.database.authority.commandAudits.findByCommand(existing.commandId), audit);
    assert.deepEqual(f.database.authority.commands.get(existing.commandId), existing);
  });
  it("retains global ownership after credential commit and failed audit", async () => {
    const f = await fixture(); const pending = protectedCommand(f.store.read().revision);
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const path = join(f.root, "credentials", "protected.json"); const bytes = readFileSync(path);
    const before = f.store.read(); const generation = f.database.getMeta().authorityGeneration;
    const foreign = f.execute({ ...ordinary(), commandId: pending.commandId });
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.equal(foreign.code, "command-divergent");
    assert.deepEqual(f.store.read(), before);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.execute(pending).state, "applied");
    assert.equal(f.execute(pending).state, "already-applied");
    assert.deepEqual(readFileSync(path), bytes);
  });
  it("fences a competing process during private commit and refuses its reuse after SQL rollback", async () => {
    let contenderRan = false;
    const f = await fixture({ afterRename: () => {
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import assert from 'node:assert/strict';
        import { DatabaseSync } from 'node:sqlite';
        const db = new DatabaseSync(${JSON.stringify(f.path)});
        db.exec('PRAGMA busy_timeout = 50');
        try { assert.throws(() => db.exec('BEGIN IMMEDIATE'), /database is locked/); }
        finally { db.close(); }
      `], { encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr);
      contenderRan = true;
    } }, false, true);
    const pending = protectedCommand(f.store.read().revision);
    const generation = f.database.getMeta().authorityGeneration;
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    assert.equal(contenderRan, true);
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    const foreign = { ...ordinary(), commandId: pending.commandId };
    const child = await runInheritedRuntimeChild(f.lifetime, `
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import { AuthorityDatabase } from './src/backend/storage/sqlite/authority-database.ts';
      import { acquireSharedRuntimeAdmission } from './src/backend/storage/admission/admission.ts';
      import { WorkerRuntimeLifetimeLock } from './src/backend/storage/admission/lifetime-lock.ts';
      import { createProfileRegistry } from './src/backend/profiles/registry.ts';
      import { basename, dirname, join } from 'node:path';
      import { manualClock } from './src/rules/time/clock.ts';
      import { resolveConfigWithProvenance } from './src/backend/app/config/resolve.ts';
      import { executeSettingsCommand } from './src/backend/runs/commands/command-kernel.ts';
      import { createCredentialStore } from './src/backend/storage/configuration/credential-store.ts';
      import { createSettingsApplicationExecutor } from './src/backend/runs/commands/settings-service.ts';
      const clock = manualClock(new Date('2026-09-06T12:00:00Z'));
      const path = ${JSON.stringify(f.path)};
      const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[1]), () => process.exit(1));
      const machine = acquireSharedRuntimeAdmission(${JSON.stringify(f.repoRoot)}, lifetime);
      const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(basename(dirname(path))));
      const store = createCredentialStore({ admission, stateRoot: ${JSON.stringify(f.root)}, erasureJournalAdmission: machine,
        erasureJournalPath: join(machine.stateRoot, 'machine', 'erasures', admission.profileBinding.profileId + '.json') });
      const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 50, migrationOwner: 'r9-child' }, clock, undefined, undefined, undefined, store);
      try {
        const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), store);
        const result = executeSettingsCommand({ authority: db, clock, ids: { uuid: randomUUID }, settings }, ${JSON.stringify(foreign)});
        assert.equal(result.state, 'rejected'); assert.equal(result.code, 'command-divergent');
      } finally { db.close(); admission.release(); machine.release(); await lifetime.close(); process.disconnect(); }
    `, [], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)) });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.equal(f.execute(pending).state, "applied");
    assert.deepEqual(readFileSync(path), bytes);
  });
  it("refuses CAS conflicts without changing ordinary authority", async () => {
    const f = await fixture(); f.execute(ordinary()); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert.equal(f.execute(request).state, "conflict");
    assert.equal(f.database.getMeta().authorityGeneration, before);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
  });
  it.each(["schema", "fingerprint"] as const)("refuses an invalid ordinary %s before authority access", async (field) => {
    const f = await fixture(); const command = ordinary();
    if (field === "schema") command.payload.settingsSchemaHash = FingerprintSchema.parse("0".repeat(64));
    else command.payload.patchFingerprint = "0".repeat(64);
    const refused = f.execute(command, { withAuthorityTransaction: () => { throw new Error("forbidden authority access"); } });
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, field === "schema" ? "schema-mismatch" : "patch-fingerprint-mismatch");
  });
  it("retains credential commit after audit failure, verifies exact retry and rejects divergent values", async () => {
    const f = await fixture(); const revision = f.store.read().revision; const request = protectedCommand(revision);
    assert.throws(() => f.execute(request, failAudit(f.database)), /credential-audit-uncertain/u);
    assert.equal(f.store.read().revision, revision + 1);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
    const divergent = structuredClone(request); divergent.payload.entries.ucpathPassword.set = "different-private-value";
    assert.equal(f.execute(divergent).state, "rejected");
    assert.equal(f.execute(request).state, "applied");
    assert.equal(f.execute(request).state, "already-applied");
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      const rows = JSON.stringify(raw.prepare("SELECT request_json FROM commands UNION ALL SELECT payload_json FROM command_audits").all());
      assert.equal(rows.includes("synthetic-private-value"), false);
      assert.equal(rows.includes("different-private-value"), false);
      assert.ok(rows.includes("<set>"));
    } finally { raw.close(); }
  });
});
