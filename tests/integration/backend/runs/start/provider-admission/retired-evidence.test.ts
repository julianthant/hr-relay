import { createGenericProviderAccounting } from "../../../../../../src/backend/storage/sqlite/provider-accounting.js";
import type { ProviderAccountingStorage } from "../../../../../../src/workflow-kit/provider-accounting.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { ConfigSchema } from "../../../../../../src/models/config/schema.js";
import { defaultRuntimePaths } from "../../../../../../src/backend/app/config/runtime-paths.js";
import { ConfigSnapshotRecordSchema, ConfigSnapshotWriteSchema } from "../../../../../../src/models/config/snapshot.js";
import { StoredConfigSchema, configSnapshotGeneration, executionConfigFromStored } from "../../../../../../src/models/config/snapshot-generations.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import { HistoricalProviderKeysCommandSchema, HistoricalProviderKeysAuditSchema } from "../../../../../../src/rules/commands/commands-history.js";
import { CommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import { ProviderAdmissionReserveRequestSchema, ProviderExecutionIdentitySchema } from "../../../../../../src/rules/providers/provider-admission.js";
import { HistoricalProviderExecutionIdentitySchema, HistoricalProviderCapabilitySchema } from "../../../../../../src/models/providers/historical-provider-evidence.js";

const id = "00000000-0000-4000-8000-000000000001";
const auditId = "00000000-0000-4000-8000-000000000002";
const now = "2026-10-07T12:00:00Z";
const hash = "a".repeat(64);

it("reads exact historical AI snapshot bytes and strips retired execution keys without rewriting authority", () => {
  const current = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  const old = { ...current, providers: { ...current.providers, ocrExtract: current.providers.geocodeCensus,
    aiAdvisory: current.providers.geocodeNominatim, gemini: { models: ["historical-model"] } } };
  const bytes = canonicalJsonStringify(old);
  const record = { configSnapshotId: id, revision: 1, fingerprint: sha256Hex(bytes), config: old, provenance: {}, capturedAt: now, capturedBy: "local-operator" };
  const read = ConfigSnapshotRecordSchema.parse(record);
  assert.equal(canonicalJsonStringify(read.config), bytes);
  assert.equal(sha256Hex(canonicalJsonStringify(read.config)), record.fingerprint);
  assert.equal(configSnapshotGeneration(read.config), 5);
  assert.equal(configSnapshotGeneration(StoredConfigSchema.parse(current)), 6);
  assert.deepEqual(executionConfigFromStored(read.config).providers, current.providers);
  assert.equal(ConfigSnapshotWriteSchema.safeParse(record).success, false);
  assert.equal(ConfigSchema.safeParse(old).success, false);
  assert.equal(StoredConfigSchema.safeParse({ ...old, providers: { ...old.providers, invented: {} } }).success, false);
  assert.equal(StoredConfigSchema.safeParse({ ...old, providers: { ...old.providers, gemini: { models: [] } } }).success, false);
});

it("reads marked retired key commands and audits while active replay and insertion refuse them", () => {
  const command = HistoricalProviderKeysCommandSchema.parse({ commandId: id, requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-provider-keys", target: { expectedRevision: 1, sourceVersionToken: hash },
    payload: { providerSchemaHash: hash, writeId: auditId, operations: { GEMINI_API_KEY: { set: "<set>" }, GROQ_API_KEY2: { clear: true } } } });
  const target = { family: "provider-keys", revision: 2 };
  const audit = HistoricalProviderKeysAuditSchema.parse({ auditId, request: command, completedAt: now, affectedDependencyIds: [],
    versionChanges: [{ target, before: 1, after: 2 }], result: { state: "applied", commandId: id, affectedTargets: [target],
      restartRequired: true, providerRevision: 2, providerReceiptId: auditId, providerSourceVersionToken: hash } });
  assert.equal(CommandRequestSchema.safeParse(command).success, false);
  assert.equal(HistoricalProviderKeysCommandSchema.safeParse({ ...command, payload: { ...command.payload, operations: { GEMINI_API_KEY: { set: "raw-value" } } } }).success, false);
  const root = mkdtempSync(join(tmpdir(), "retired-provider-evidence-")), path = join(root, "state.db");
  const clock = manualClock(new Date(now));
  let database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "retired-evidence" }, clock);
  database.close();
  try {
    const raw = new DatabaseSync(path);
    raw.prepare("INSERT INTO commands(record_key,family,record_json,created_at) VALUES (?, 'settings', ?, ?)").run(id, canonicalJsonStringify(command), now);
    raw.prepare("INSERT INTO command_audits(record_key,command_id,record_json,created_at) VALUES (?, ?, ?, ?)").run(auditId, id, canonicalJsonStringify(audit), now);
    raw.close();
    database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "retired-evidence" }, clock);
    assert.deepEqual(database.authority.commands.getSettingsHistory(id), command);
    assert.deepEqual(database.authority.commandAudits.findSettingsHistory(id), audit);
    assert.throws(() => database.authority.commands.insert(command));
    assert.throws(() => database.authority.commandAudits.insert(audit));
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
});

it("isolates historical advisory identities from every active admission grammar", () => {
  const historical = { runId: id, attempt: 1, surface: "failure-triage" };
  assert.equal(HistoricalProviderExecutionIdentitySchema.safeParse(historical).success, true);
  assert.equal(HistoricalProviderCapabilitySchema.safeParse("ai.advisory").success, true);
  assert.equal(ProviderExecutionIdentitySchema.safeParse(historical).success, false);
  const request = { admissionId: id, execution: historical, capability: "ai.advisory", configSnapshotId: id, configFingerprint: hash,
    requestFingerprint: hash, estimate: { maximumCostUsdMicros: 0 }, now, leaseExpiresAt: now, deadlineAt: now };
  assert.equal(ProviderAdmissionReserveRequestSchema.safeParse(request).success, false);
  const storage = new Proxy({}, { get() { throw new Error("retired admission touched storage"); } }) as ProviderAccountingStorage;
  const generic = createGenericProviderAccounting(storage);
  assert.throws(() => generic.reserve({ ...request, requestId: id, attribution: { kind: "legacy-capability", capability: "ai.advisory" }, budgets: [] }));
  assert.equal(ProviderAdmissionReserveRequestSchema.safeParse({ ...request, capability: "ocr.extract", execution: { runId: id, attempt: 1, nodeId: "extract", taskId: "ocr/extract-form-page" } }).success, false);
});
