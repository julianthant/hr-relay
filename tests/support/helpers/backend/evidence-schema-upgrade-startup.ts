import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { predecessorSeparationsRerun } from "./predecessor-separations-rerun.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import type { EvidenceSchemaAdmission } from "../../../../src/models/storage/evidence-schema-admission.js";

export const CLOCK = manualClock(new Date("2026-08-14T10:00:00.000Z"));
const tables = ["runs", "run_results", "run_checkpoints", "write_intents", "write_attempts", "gate_results", "run_delegations", "commands", "command_audits", "run_receipts", "timeline_events", "delegation_dependencies", "run_failures"] as const;
export async function assertConversionRefused(workspace: string, lifetime: RuntimeLifetimeLock) {
  const { acquireEntrypointAdmission } = await import("../../../../src/backend/storage/admission/bootstrap-admission.js");
  const { composeProfileRuntime } = await import("../../../../src/backend/app/composition/storage-compose.js");
  const machine = acquireEntrypointAdmission(workspace, "shared", lifetime);
  const runtime = composeProfileRuntime({ admission: machine, clock: CLOCK, hostFacts: { primaryDisplay: null } });
  try {
    const custodyUnavailable = (error: unknown): boolean => error instanceof Error
      && (("code" in error && error.code === "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE")
        || custodyUnavailable(error.cause) || error instanceof AggregateError && error.errors.some(custodyUnavailable));
    assert.throws(() => runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: CLOCK.now().toISOString() }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_STARTUP_CONVERSION_REFUSED"
        && (process.platform !== "win32" || custodyUnavailable(error.cause)));
  } finally { await runtime.close("shutdown"); machine.release(); }
}
export function frozenRows(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])); }
  finally { database.close(); }
}
export function conversions(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare("SELECT payload_json FROM database_upgrades WHERE json_extract(payload_json,'$.evidenceSchemas.id')='profile-name-domain'").all(); }
  finally { database.close(); }
}

/** Upgrade the retained predecessor Kuali evidence through startup, optionally after an interrupted committed conversion, and prove every frozen row survives a second startup. */
export async function upgradeRetainedPredecessorEvidence(interrupted: boolean): Promise<void> {
  const f = await predecessorSeparationsRerun();
  assert.ok(f.writes.some(intent => intent.status === "committed"));
  const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
  const { acquireEntrypointAdmission } = await import("../../../../src/backend/storage/admission/bootstrap-admission.js");
  const { initializeRegisteredPersonStores, composeProfileRuntime } = await import("../../../../src/backend/app/composition/storage-compose.js");
  const { AuthorityDatabase } = await import("../../../../src/backend/storage/sqlite/authority-database.js");
  const { createReceiptService } = await import("../../../../src/backend/runs/trust/receipt-service.js");
  const { testRunService } = await import("../../fixtures/run-lifecycle-fixtures.js");
  const { createCanonicalCredentials } = await import("../../../../src/backend/storage/configuration/canonical-credential-store.js");
  const { authenticateDocument, createCredentialStore } = await import("../../../../src/backend/storage/configuration/credential-store.js");
  const { deriveSchemaHash } = await import("../../../../src/models/validation/schema-bound-value.js");
  const { separationsDescriptor: descriptor } = await import("../registered-workflows.js");
  const before = frozenRows(f.path), protectedPath = join(f.stateRoot, "credentials", "protected.json"), oldCredentials = readFileSync(protectedPath);
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  let restoreFault: (() => void) | undefined;
  try {
    const startup = () => initializeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null }, CLOCK);
    if (process.platform === "win32") {
      await startup(); await assertConversionRefused(f.workspace, lifetime);
      assert.deepEqual(frozenRows(f.path), before); assert.deepEqual(readFileSync(protectedPath), oldCredentials);
      assert.equal(conversions(f.path).length, 0); return;
    }
    if (interrupted) {
      const convert = AuthorityDatabase.convertEvidenceSchemas.bind(AuthorityDatabase);
      const fault = vi.spyOn(AuthorityDatabase, "convertEvidenceSchemas").mockImplementation((...args) => {
        convert(...args); throw new Error("synthetic-interruption-after-closed-evidence-conversion");
      });
      restoreFault = () => fault.mockRestore();
      await startup(); await assertConversionRefused(f.workspace, lifetime); restoreFault(); restoreFault = undefined;
      assert.equal(conversions(f.path).length, 1);
      assert.deepEqual(readFileSync(protectedPath), oldCredentials); assert.deepEqual(frozenRows(f.path), before);
    }
    await startup();
    assert.equal(conversions(f.path).length, 1); assert.deepEqual(frozenRows(f.path), before);
    const credentials = readFileSync(protectedPath), journal = conversions(f.path), backups = readdirSync(join(f.stateRoot, "backups", "authority")).sort();
    assert.notDeepEqual(credentials, oldCredentials);
    await startup();
    assert.deepEqual(readFileSync(protectedPath), credentials); assert.deepEqual(conversions(f.path), journal);
    assert.deepEqual(readdirSync(join(f.stateRoot, "backups", "authority")).sort(), backups); assert.deepEqual(frozenRows(f.path), before);
    const machine = acquireEntrypointAdmission(f.workspace, "exclusive", lifetime);
    const runtime = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: CLOCK });
    try {
      const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: CLOCK.now().toISOString() });
      assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("converted-evidence-sign-in-refused");
      const admission = machine.admitProfile(active.profileId);
      const database = AuthorityDatabase.open(admission, { path: f.path, migrationOwner: "converted-evidence-readback", busyTimeoutMs: 250 }, CLOCK,
        undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: admission.stateRoot }));
      try {
        const document = createCanonicalCredentials(admission).readRecord("protected"); assert.ok(document);
        assert.equal(authenticateDocument(document.value).retiredLegacy.valueIds.includes(f.valueId), true);
        const service = createReceiptService({ database, runReader: testRunService(database, CLOCK), descriptors: [descriptor] });
        assert.deepEqual(service.ensureReceipt(f.run.envelope.runId), f.receipt);
        const { createOperatorProjection } = await import("../../../../src/backend/app/composition/dashboard/queue.js");
        const { createOperatorRunDetail } = await import("../../../../src/backend/app/composition/dashboard/run-detail.js");
        const { buildRunLogsSection } = await import("../../../../src/backend/runs/queries/run-logs.js");
        const { READABLE_WORKFLOW_MODULES } = await import("../../../../src/backend/app/registries/workflow-registry.js");
        const descriptors = { resolve: (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor };
        const reader = testRunService(database, CLOCK);
        const projection = createOperatorProjection({ database, reader, descriptors, stateRoot: f.stateRoot, clock: CLOCK,
          appVersion: "0.1.0", descriptorSetHash: descriptor.contractFingerprint,
          ledger: { foldActivityRange: () => { throw new Error("unrequested-activity"); } } });
        projection.rebuildFromTimeline();
        const detail = createOperatorRunDetail({ database, runReader: reader, projection, stateRoot: f.stateRoot, canonical: { database, reader, descriptors } });
        assert.equal(buildRunLogsSection(detail, f.run.envelope.runId, projection.runFold(f.run.envelope.runId), f.run).section, "logs");
        assert.deepEqual(frozenRows(f.path), before);
        const owner = { kind: "run-input" as const, id: f.run.envelope.runId };
        const current = deriveSchemaHash(descriptor.canonicalInput, "output"), old = f.run.input.parsed.schemaHash;
        assert.notEqual(old, current); assert.equal(database.evidenceSchemaHash(owner, f.run.input, old, current), old);
        assert.throws(() => database.evidenceSchemaHash(owner, { ...f.run.input, parsed: { ...f.run.input.parsed, protectedBindings: [] } }, old, current), /source-changed/u);
        assert.equal(database.evidenceSchemaHash(owner, f.run.input, old, "f".repeat(64)), old);
        assert.throws(() => database.evidenceSchemaHash(owner, f.run.input, "e".repeat(64), current), /source-changed/u);
        const { AuthorityEvidenceSchemaUpgradeRecordSchema } = await import("../../../../src/models/config/authority.js");
        const record = AuthorityEvidenceSchemaUpgradeRecordSchema.parse(JSON.parse(String(journal[0]?.payload_json)));
        assert.throws(() => admission.assertEvidenceSchemaConversion({ ...record, evidenceSchemaMac: "0".repeat(64) }), /seal-invalid/u);
        assert.throws(() => admission.assertEvidenceSchemaConversion({ ...record, evidenceSchemas: { ...record.evidenceSchemas, profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }), /foreign/u);
        const certified = record.evidenceSchemas;
        if (certified.id !== "profile-name-domain") throw new Error("profile-name-domain-record-required");
        for (const intent of f.writes) {
          if (intent.status !== "committed") throw new Error("fixture-completion-proof-required");
          const certificate: EvidenceSchemaAdmission | undefined = certified.admissions.find(entry => entry.owner.kind === "write-proof" && entry.owner.id === intent.writeIntentId);
          assert.ok(certificate);
          assert.throws(() => database.evidenceSchemaHash(certificate.owner, { ...intent, bindingProofDigest: "f".repeat(64) }, certificate.sourceSchemaHash, certificate.currentSchemaHash), /source-changed/u);
        }
      } finally { database.close(); admission.release(); }
    } finally { await runtime.close(); machine.release(); }
  } finally { restoreFault?.(); await lifetime.close(); await f.cleanup(); }
}
