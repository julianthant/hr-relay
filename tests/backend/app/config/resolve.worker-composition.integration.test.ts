import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { EditableSettingsWireSchema } from "../../../../src/models/dashboard/settings-editor.js";
import { SettingsFactsWireSchema } from "../../../../src/models/dashboard/settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { installationAdmission,releaseAdmissionFixture,releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import {
SETTINGS_SCHEMA_HASH,
derivePersistedSettingsFingerprint,
deriveSettingsPatchFingerprint,
} from "../../../../src/models/config/settings.js";
import { manualClock,type TestClock } from "../../../../src/rules/time/clock.js";
import { UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { settingsSetOperations } from "../../../support/fixtures/settings-operation-fixtures.js";
import { AuthorityDatabase,createCredentialStore } from "../../../support/helpers/admission-fixture.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  releaseAdmissionFixtures();
  for (const root of roots.splice(0)) {
    releaseAdmissionFixture(root);
    rmSync(root, { recursive: true, force: true });
  }
});

const NOW = "2026-08-03T09:00:00.000Z";

function repoRootWithState(): { repoRoot: string; stateRoot: string } {
  const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-worker-compose-"));
  roots.push(repoRoot);
  const stateRoot = installationAdmission(repoRoot).stateRoot;
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "worker-composition-fixture", version: "0.1.0", type: "module" }));
  return { repoRoot, stateRoot };
}

function reopen(stateRoot: string, clock: TestClock): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);
  return database;
}

function persistUnjournaledWorkerSettings(repoRoot: string, clock: TestClock, patch: unknown) {
  patch = settingsSetOperations(patch);
  const patchFingerprint = deriveSettingsPatchFingerprint(patch);
  const command = {
    commandId: "33333333-3333-4333-8333-333333333333",
    requestedAt: "2026-08-28T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
  };
  void repoRoot; void clock;
  return Object.freeze({ command, settingsFingerprint: derivePersistedSettingsFingerprint({ browser: { headless: false } }) });
}

function journalWorkerSettings(
  database: AuthorityDatabase,
  persisted: ReturnType<typeof persistUnjournaledWorkerSettings>,
  stateRoot: string,
): void {
  const clock = manualClock(new Date(NOW));
  if (database.authority.runtimeConfig.get() === undefined) {
    const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, {
      stateRoot, artifactRoot: join(stateRoot, "artifacts"),
    });
    database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1,
      fingerprint: resolved.fingerprint, capturedAt: clock.now().toISOString(),
      capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
  }
  const result = executeSettingsCommand({ authority: database, clock, ids: sequentialIdFactory("4"),
    settings: createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }), createCredentialStore({ stateRoot })) }, persisted.command);
  assert.equal(result.state, "applied");
}


it("F composed dashboard reads active settings after boot through real HTTP", async () => {
 const { repoRoot, stateRoot } = repoRootWithState();
 const clock = manualClock(new Date(NOW));
 for (const name of ["package.json", "package-lock.json"])
  writeFileSync(join(repoRoot, name), readFileSync(join(process.cwd(), name)));
 const dashboard = await composeDashboardRuntime({ admission: installationAdmission(repoRoot), isolation: rebuildRuntimeIsolation, repoRoot, env: {}, clock,
  backendPortOverride: 0, frontendPortOverride: 0 });
 try {
  const database = reopen(stateRoot, clock);
  const before = database.authority.runtimeConfig.get();
  assert.ok(before !== undefined);
  const snapshot = database.authority.configSnapshots.get(before.configSnapshotId);
  assert.ok(snapshot !== undefined);
  const settings = persistUnjournaledWorkerSettings(repoRoot, clock, { display: { screenWidth: 1980, screenHeight: 1080 } });
  journalWorkerSettings(database, settings, stateRoot);
  const record = readSettings(database.authority);
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") });
  database.authority.configSnapshots.insert({ configSnapshotId: UUID_7, revision: 1,
   fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance,
   capturedAt: NOW, capturedBy: "local-operator" });
  database.authority.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
   configSnapshotId: UUID_7, configFingerprint: resolved.fingerprint, activatedAt: NOW });
  const response = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/editable`);
  assert.equal(response.status, 200);
  const editor = EditableSettingsWireSchema.parse(await response.json());
  assert.equal(editor.runtimeStatus.state, "current");
  assert.equal(editor.revision, record.revision);
  // Facts must follow the active snapshot as well; a synthetic endpoint is never contacted.
  const config = structuredClone(resolved.config);
  config.urls.crm.prod.entry = "https://synthetic.example.invalid/";
  const nextId = "83000000-0000-4000-8000-000000000098";
  const fingerprint = sha256Hex(canonicalJsonStringify(config));
  database.authority.configSnapshots.insert({ ...snapshot, configSnapshotId: nextId, config, fingerprint });
  database.authority.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
   configSnapshotId: nextId, configFingerprint: fingerprint, activatedAt: NOW });
  const factsResponse = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/facts`);
  assert.equal(factsResponse.status, 200);
  const facts = SettingsFactsWireSchema.parse(await factsResponse.json());
  assert.equal(facts.systemHosts.find(entry => entry.system === "crm")?.production, "https://synthetic.example.invalid/");
 } finally { await dashboard.stop(); }
});
