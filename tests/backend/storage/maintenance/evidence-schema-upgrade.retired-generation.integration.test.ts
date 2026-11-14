import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import type { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import type { EvidenceSchemaAdmission } from "../../../../src/models/storage/evidence-schema-admission.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { retiredSeparationsRun, simulatePreviousSeparationsInputGeneration } from "../../../support/helpers/backend/retired-separations-run.js";
import { predecessorSeparationsRerun } from "../../../support/helpers/backend/predecessor-separations-rerun.js";
import { RETIRED_INPUT_GENERATIONS } from "../../../../src/models/storage/evidence-schema-admission.js";
import { NAME_DOMAIN_CANONICAL_INPUT_HASH, PRE_INITIALS_CANONICAL_INPUT_HASH } from "../../../support/fixtures/storage/pre-initials-separations.js";

const tables = ["runs", "run_results", "run_checkpoints", "write_intents", "write_attempts", "gate_results", "run_delegations", "commands", "command_audits", "run_receipts", "timeline_events", "delegation_dependencies", "run_failures", "run_requests"] as const;
const retiredHashes = RETIRED_INPUT_GENERATIONS.separations ?? [];

async function assertGenerationMoved() {
  const { deriveSchemaHash } = await import("../../../../src/models/validation/schema-bound-value.js");
  const { predecessorEvidenceSchemaHash } = await import("../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js");
  const { separationsDescriptor } = await import("../../../support/helpers/registered-workflows.js");
  const current = deriveSchemaHash(separationsDescriptor.canonicalInput, "output"), predecessor = predecessorEvidenceSchemaHash(separationsDescriptor.canonicalInput);
  assert.ok(!retiredHashes.includes(current)); assert.ok(!retiredHashes.includes(predecessor)); assert.notEqual(current, predecessor);
  return current;
}
function frozenRows(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])); }
  finally { database.close(); }
}
function journal(path: string, id: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare("SELECT payload_json FROM database_upgrades WHERE json_extract(payload_json,'$.evidenceSchemas.id')=?").all(id).map(row => String(row.payload_json)); }
  finally { database.close(); }
}

it("admits a store written by the pre-initials build as retired history without changing a row", async () => {
  const f = await retiredSeparationsRun();
  const before = frozenRows(f.path), stored = f.run.input.parsed.schemaHash;
  assert.equal(stored, PRE_INITIALS_CANONICAL_INPUT_HASH); assert.ok(retiredHashes.includes(stored));
  try {
    const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
    const { acquireEntrypointAdmission } = await import("../../../../src/backend/storage/admission/bootstrap-admission.js");
    const { initializeRegisteredPersonStores, composeProfileRuntime } = await import("../../../../src/backend/app/composition/storage-compose.js");
    const { AuthorityDatabase } = await import("../../../../src/backend/storage/sqlite/authority-database.js");
    const { createReceiptService } = await import("../../../../src/backend/runs/trust/receipt-service.js");
    const { testRunService } = await import("../../../support/fixtures/run-lifecycle-fixtures.js");
    const { createCredentialStore } = await import("../../../../src/backend/storage/configuration/credential-store.js");
    const { deriveSchemaHash } = await import("../../../../src/models/validation/schema-bound-value.js");
    const { separationsDescriptor: descriptor } = await import("../../../support/helpers/registered-workflows.js");
    const { AuthorityEvidenceSchemaUpgradeRecordSchema } = await import("../../../../src/models/config/authority.js");
    const { systemClock } = await import("../../../../src/rules/time/clock.js");
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try {
      const startup = () => initializeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null });
      if (process.platform === "win32") {
        await startup();
        assert.deepEqual(frozenRows(f.path), before); assert.equal(journal(f.path, "retired-input-generation").length, 0); return;
      }
      await startup();
      const rows = journal(f.path, "retired-input-generation"), backups = readdirSync(join(f.stateRoot, "backups", "authority")).sort();
      assert.equal(rows.length, 1); assert.equal(journal(f.path, "profile-name-domain").length, 0);
      const record = AuthorityEvidenceSchemaUpgradeRecordSchema.parse(JSON.parse(String(rows[0])));
      assert.equal(record.evidenceSchemas.id, "retired-input-generation");
      if (record.evidenceSchemas.id !== "retired-input-generation") throw new Error("retired-conversion-expected");
      assert.deepEqual(record.evidenceSchemas.retirements.map(({ owner, workflowId, sourceSchemaHash }) => ({ owner, workflowId, sourceSchemaHash })),
        [{ owner: { kind: "run-input", id: f.run.envelope.runId }, workflowId: "separations", sourceSchemaHash: stored }]);
      assert.deepEqual(frozenRows(f.path), before);
      await startup();
      assert.deepEqual(journal(f.path, "retired-input-generation"), rows);
      assert.deepEqual(readdirSync(join(f.stateRoot, "backups", "authority")).sort(), backups); assert.deepEqual(frozenRows(f.path), before);
      const machine = acquireEntrypointAdmission(f.workspace, "exclusive", lifetime);
      const runtime = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock });
      try {
        const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: systemClock.now().toISOString() });
        assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("retired-evidence-sign-in-refused");
        const admission = machine.admitProfile(active.profileId);
        const database = AuthorityDatabase.open(admission, { path: f.path, migrationOwner: "retired-evidence-readback", busyTimeoutMs: 250 }, systemClock,
          undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: admission.stateRoot }));
        try {
          const owner = { kind: "run-input" as const, id: f.run.envelope.runId }, fresh = await assertGenerationMoved();
          assert.equal(fresh, deriveSchemaHash(descriptor.canonicalInput, "output")); assert.notEqual(fresh, stored);
          assert.equal(database.evidenceSchemaHash(owner, f.run.input, stored, fresh), stored);
          assert.throws(() => database.evidenceSchemaHash(owner, { ...f.run.input, parsed: { ...f.run.input.parsed, protectedBindings: [] } }, stored, fresh), /source-changed/u);
          assert.throws(() => admission.assertEvidenceSchemaConversion({ ...record, evidenceSchemaMac: "0".repeat(64) }), /seal-invalid/u);
          assert.throws(() => createReceiptService({ database, runReader: testRunService(database, systemClock), descriptors: [descriptor] }).ensureReceipt(f.run.envelope.runId), /canonical-input/u);
          assert.deepEqual(frozenRows(f.path), before);
        } finally { database.close(); admission.release(); }
      } finally { await runtime.close(); machine.release(); }
    } finally { await lifetime.close(); }
  } finally { await f.cleanup(); }
});

it("refuses a stored Separations run under an unlisted input hash", async () => {
  const f = await retiredSeparationsRun();
  try {
    await assertGenerationMoved();
    const { collectEvidenceSchemaAdmissions } = await import("../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js");
    const { separationsDescriptor } = await import("../../../support/helpers/registered-workflows.js");
    const { RunRecordSchema } = await import("../../../../src/models/run/record.js");
    const unlisted = RunRecordSchema.parse({ ...f.run, input: { ...f.run.input, parsed: { ...f.run.input.parsed, schemaHash: "e".repeat(64) } } });
    assert.throws(() => collectEvidenceSchemaAdmissions({ descriptors: [separationsDescriptor], runs: [unlisted], writes: [], checkpoints: [] }), /evidence-schema-source-selector-refused/u);
  } finally { await f.cleanup(); }
});

const backupEntries = (stateRoot: string) => {
  const directory = join(stateRoot, "backups", "authority");
  return existsSync(directory) ? readdirSync(directory).sort() : [];
};
type ProfileAdmission = ReturnType<ReturnType<typeof acquireEntrypointAdmission>["admitProfile"]>;
type PredecessorStore = Awaited<ReturnType<typeof predecessorSeparationsRerun>>;

async function startupOnce(f: PredecessorStore) {
  const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
  const { initializeRegisteredPersonStores } = await import("../../../../src/backend/app/composition/storage-compose.js");
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  try { await initializeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null }); } finally { await lifetime.close(); }
}

async function parseRecord(row: string | undefined) {
  assert.ok(row !== undefined);
  const { AuthorityEvidenceSchemaUpgradeRecordSchema } = await import("../../../../src/models/config/authority.js");
  return AuthorityEvidenceSchemaUpgradeRecordSchema.parse(JSON.parse(row));
}

async function readBack(f: PredecessorStore, check: (database: AuthorityDatabase, admission: ProfileAdmission) => Promise<void>) {
  const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
  const { acquireEntrypointAdmission } = await import("../../../../src/backend/storage/admission/bootstrap-admission.js");
  const { composeProfileRuntime } = await import("../../../../src/backend/app/composition/storage-compose.js");
  const { AuthorityDatabase } = await import("../../../../src/backend/storage/sqlite/authority-database.js");
  const { createCredentialStore } = await import("../../../../src/backend/storage/configuration/credential-store.js");
  const { systemClock } = await import("../../../../src/rules/time/clock.js");
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  try {
    const machine = acquireEntrypointAdmission(f.workspace, "exclusive", lifetime);
    const runtime = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock });
    try {
      const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: systemClock.now().toISOString() });
      assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("retired-evidence-sign-in-refused");
      const admission = machine.admitProfile(active.profileId);
      const database = AuthorityDatabase.open(admission, { path: f.path, migrationOwner: "retired-evidence-readback", busyTimeoutMs: 250 }, systemClock,
        undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: admission.stateRoot }));
      try { await check(database, admission); } finally { database.close(); admission.release(); }
    } finally { await runtime.close(); machine.release(); }
  } finally { await lifetime.close(); }
}

async function assertGenerationOneStillVerifies(f: PredecessorStore, record: Awaited<ReturnType<typeof parseRecord>>,
  database: AuthorityDatabase) {
  const certified = record.evidenceSchemas;
  if (certified.id !== "profile-name-domain") throw new Error("profile-name-domain-record-required");
  assert.ok(f.writes.some(intent => intent.status === "committed"));
  for (const intent of f.writes) {
    if (intent.status !== "committed") throw new Error("fixture-completion-proof-required");
    const certificate: EvidenceSchemaAdmission | undefined = certified.admissions.find(entry => entry.owner.kind === "write-proof" && entry.owner.id === intent.writeIntentId);
    assert.ok(certificate);
    assert.equal(database.evidenceSchemaHash(certificate.owner, intent, certificate.sourceSchemaHash, certificate.currentSchemaHash), certificate.currentSchemaHash);
  }
}

it("converts both pending generations on one startup, one backed record each", async () => {
  const f = await predecessorSeparationsRerun();
  const stored = f.run.input.parsed.schemaHash, before = frozenRows(f.path), backupsBefore = backupEntries(f.stateRoot);
  assert.equal(stored, NAME_DOMAIN_CANONICAL_INPUT_HASH); assert.ok(retiredHashes.includes(stored));
  try {
    const fresh = await assertGenerationMoved();
    if (process.platform === "win32") {
      await startupOnce(f).catch(() => undefined);
      assert.deepEqual(frozenRows(f.path), before); assert.equal(journal(f.path, "retired-input-generation").length, 0); return;
    }
    await startupOnce(f);
    const domainRows = journal(f.path, "profile-name-domain"), retiredRows = journal(f.path, "retired-input-generation"), backups = backupEntries(f.stateRoot);
    assert.equal(domainRows.length, 1); assert.equal(retiredRows.length, 1);
    assert.ok(backups.length - backupsBefore.length >= 2);
    const domain = await parseRecord(domainRows[0]), retired = await parseRecord(retiredRows[0]);
    assert.notEqual(domain.upgradeId, retired.upgradeId);
    for (const record of [domain, retired]) assert.ok(existsSync(resolve(f.stateRoot, record.backup.manifestPath)));
    assert.notEqual(domain.backup.manifestPath, retired.backup.manifestPath);
    const retirements = retired.evidenceSchemas;
    if (retirements.id !== "retired-input-generation") throw new Error("retired-conversion-expected");
    assert.deepEqual(retirements.retirements.map(({ owner, workflowId, sourceSchemaHash }) => ({ owner, workflowId, sourceSchemaHash })),
      [{ owner: { kind: "run-input", id: f.run.envelope.runId }, workflowId: "separations", sourceSchemaHash: stored }]);
    const admissions = domain.evidenceSchemas;
    if (admissions.id !== "profile-name-domain") throw new Error("profile-name-domain-conversion-expected");
    assert.ok(admissions.admissions.some(entry => entry.owner.kind === "write-proof"));
    assert.ok(!admissions.admissions.some(entry => entry.owner.kind === "run-input" && entry.owner.id === f.run.envelope.runId));
    assert.deepEqual(frozenRows(f.path), before);
    await startupOnce(f);
    assert.deepEqual(journal(f.path, "profile-name-domain"), domainRows); assert.deepEqual(journal(f.path, "retired-input-generation"), retiredRows);
    assert.deepEqual(backupEntries(f.stateRoot), backups); assert.deepEqual(frozenRows(f.path), before);
    await readBack(f, async (database, admission) => {
      const owner = { kind: "run-input" as const, id: f.run.envelope.runId };
      assert.equal(database.evidenceSchemaHash(owner, f.run.input, stored, fresh), stored);
      await assertGenerationOneStillVerifies(f, domain, database);
      for (const record of [domain, retired]) assert.throws(() => admission.assertEvidenceSchemaConversion({ ...record, evidenceSchemaMac: "0".repeat(64) }), /seal-invalid/u);
      assert.deepEqual(frozenRows(f.path), before);
    });
  } finally { await f.cleanup(); }
});

it("adds generation 2 to a store that already recorded generation 1", async () => {
  const f = await predecessorSeparationsRerun();
  const stored = f.run.input.parsed.schemaHash, before = frozenRows(f.path);
  let restoreBuild: (() => void) | undefined;
  try {
    assert.equal(stored, NAME_DOMAIN_CANONICAL_INPUT_HASH);
    if (process.platform === "win32") {
      await startupOnce(f).catch(() => undefined);
      assert.deepEqual(frozenRows(f.path), before); assert.equal(journal(f.path, "profile-name-domain").length, 0); return;
    }
    restoreBuild = simulatePreviousSeparationsInputGeneration();
    {
      const { deriveSchemaHash } = await import("../../../../src/models/validation/schema-bound-value.js");
      const { predecessorEvidenceSchemaHash } = await import("../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js");
      const { separationsDescriptor } = await import("../../../support/helpers/registered-workflows.js");
      assert.equal(deriveSchemaHash(separationsDescriptor.canonicalInput, "output"), PRE_INITIALS_CANONICAL_INPUT_HASH);
      assert.equal(predecessorEvidenceSchemaHash(separationsDescriptor.canonicalInput), NAME_DOMAIN_CANONICAL_INPUT_HASH);
    }
    await startupOnce(f);
    restoreBuild(); restoreBuild = undefined;
    const firstRows = journal(f.path, "profile-name-domain");
    assert.equal(firstRows.length, 1); assert.equal(journal(f.path, "retired-input-generation").length, 0); assert.deepEqual(frozenRows(f.path), before);
    const captured = firstRows[0];
    const fresh = await assertGenerationMoved();
    await startupOnce(f);
    const domainRows = journal(f.path, "profile-name-domain"), retiredRows = journal(f.path, "retired-input-generation"), backups = backupEntries(f.stateRoot);
    assert.equal(domainRows.length, 1); assert.equal(domainRows[0], captured);
    assert.equal(retiredRows.length, 1); assert.deepEqual(frozenRows(f.path), before);
    const domain = await parseRecord(domainRows[0]), retired = await parseRecord(retiredRows[0]);
    assert.notEqual(domain.upgradeId, retired.upgradeId); assert.ok(existsSync(resolve(f.stateRoot, retired.backup.manifestPath)));
    const retirements = retired.evidenceSchemas;
    if (retirements.id !== "retired-input-generation") throw new Error("retired-conversion-expected");
    assert.deepEqual(retirements.retirements.map(({ owner, sourceSchemaHash }) => ({ owner, sourceSchemaHash })),
      [{ owner: { kind: "run-input", id: f.run.envelope.runId }, sourceSchemaHash: stored }]);
    await startupOnce(f);
    assert.deepEqual(journal(f.path, "profile-name-domain"), domainRows); assert.deepEqual(journal(f.path, "retired-input-generation"), retiredRows);
    assert.deepEqual(backupEntries(f.stateRoot), backups); assert.deepEqual(frozenRows(f.path), before);
    await readBack(f, async database => {
      assert.equal(database.evidenceSchemaHash({ kind: "run-input", id: f.run.envelope.runId }, f.run.input, stored, fresh), stored);
      await assertGenerationOneStillVerifies(f, domain, database);
    });
  } finally { restoreBuild?.(); await f.cleanup(); }
});
