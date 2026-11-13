import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { retiredSeparationsRun } from "../../../support/helpers/backend/retired-separations-run.js";
import { RETIRED_INPUT_GENERATIONS } from "../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";

const SCHEMA_BOUND_VALUE = "../../../../src/models/validation/schema-bound-value.js";
const tables = ["runs", "run_results", "run_checkpoints", "write_intents", "write_attempts", "gate_results", "run_delegations", "commands", "command_audits", "run_receipts", "timeline_events", "delegation_dependencies", "run_failures", "run_requests"] as const;
const retiredHashes = RETIRED_INPUT_GENERATIONS.separations ?? [];
const newGenerationHash = (original: string) => sha256Hex(`relay:test:new-input-generation\0${original}`);

function simulateNewBuild() {
  vi.resetModules();
  vi.doMock(SCHEMA_BOUND_VALUE, async importOriginal => {
    const current = await importOriginal<typeof import("../../../../src/models/validation/schema-bound-value.js")>();
    const { FingerprintSchema } = await import("../../../../src/rules/identity/ids.js");
    return { ...current, deriveSchemaHash: (schema: Parameters<typeof current.deriveSchemaHash>[0], io: "input" | "output") => {
      const original = current.deriveSchemaHash(schema, io);
      return retiredHashes.includes(original) ? FingerprintSchema.parse(newGenerationHash(original)) : original;
    } };
  });
}
function restoreBuild() { vi.doUnmock(SCHEMA_BOUND_VALUE); vi.resetModules(); }
function frozenRows(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])); }
  finally { database.close(); }
}
function journal(path: string, id: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare("SELECT payload_json FROM database_upgrades WHERE json_extract(payload_json,'$.evidenceSchemas.id')=?").all(id); }
  finally { database.close(); }
}

it("admits a store written by the previous Separations input generation as retired history without changing a row", async () => {
  const f = await retiredSeparationsRun();
  const before = frozenRows(f.path), stored = f.run.input.parsed.schemaHash;
  assert.ok(retiredHashes.includes(stored));
  simulateNewBuild();
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
      const record = AuthorityEvidenceSchemaUpgradeRecordSchema.parse(JSON.parse(String(rows[0]?.payload_json)));
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
          const owner = { kind: "run-input" as const, id: f.run.envelope.runId }, fresh = deriveSchemaHash(descriptor.canonicalInput, "output");
          assert.equal(fresh, newGenerationHash(stored)); assert.notEqual(fresh, stored);
          assert.equal(database.evidenceSchemaHash(owner, f.run.input, stored, fresh), stored);
          assert.throws(() => database.evidenceSchemaHash(owner, { ...f.run.input, parsed: { ...f.run.input.parsed, protectedBindings: [] } }, stored, fresh), /source-changed/u);
          assert.throws(() => admission.assertEvidenceSchemaConversion({ ...record, evidenceSchemaMac: "0".repeat(64) }), /seal-invalid/u);
          assert.throws(() => createReceiptService({ database, runReader: testRunService(database, systemClock), descriptors: [descriptor] }).ensureReceipt(f.run.envelope.runId), /canonical-input/u);
          assert.deepEqual(frozenRows(f.path), before);
        } finally { database.close(); admission.release(); }
      } finally { await runtime.close(); machine.release(); }
    } finally { await lifetime.close(); }
  } finally { restoreBuild(); await f.cleanup(); }
});

it("refuses a stored Separations run under an unlisted input hash", async () => {
  const f = await retiredSeparationsRun();
  simulateNewBuild();
  try {
    const { collectEvidenceSchemaAdmissions } = await import("../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js");
    const { separationsDescriptor } = await import("../../../support/helpers/registered-workflows.js");
    const { RunRecordSchema } = await import("../../../../src/models/run/record.js");
    const unlisted = RunRecordSchema.parse({ ...f.run, input: { ...f.run.input, parsed: { ...f.run.input.parsed, schemaHash: "e".repeat(64) } } });
    assert.throws(() => collectEvidenceSchemaAdmissions({ descriptors: [separationsDescriptor], runs: [unlisted], writes: [], checkpoints: [] }), /evidence-schema-source-selector-refused/u);
  } finally { restoreBuild(); await f.cleanup(); }
});
