import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { DelegationAdmissionRequestSchema } from "../../../../src/backend/storage/sqlite/delegation-contracts.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { RunLifecycleCommandRecordSchema, RunLifecycleCommandAuditRecordSchema } from "../../../../src/rules/commands/commands.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { boundProfileCredentials, withOfflineMaintenance } from "../../../support/helpers/admission-fixture.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { childPolicyModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

function restorePredecessor(path: string) {
  const raw = new DatabaseSync(path);
  try {
    const trigger = (name: string) => z.object({ sql: z.string() }).parse(raw.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name)).sql;
    const auditTrigger = trigger("command_audits_immutable"), upgradeTrigger = trigger("database_upgrades_immutable");
    raw.exec("DROP TRIGGER command_audits_immutable");
    raw.exec("DROP TRIGGER database_upgrades_immutable");
    const rows = raw.prepare("SELECT * FROM commands WHERE family='run-lifecycle' AND json_extract(request_json,'$.operation')='delegation-admission'").all();
    assert.equal(rows.length, 1);
    for (const row of rows) {
      const current = RunLifecycleCommandRecordSchema.parse(JSON.parse(z.string().parse(row.request_json)));
      const { nodeId: _nodeId, members, ...common } = DelegationAdmissionRequestSchema.parse(current.request);
      const [member] = members;
      assert.equal(members.length, 1);
      assert.ok(member?.state === "admitted");
      const request = { ...common, invocationCommandId: member.invocationCommandId, scopeEvidence: member.scopeEvidence, observedScopeDigest: member.observedScopeDigest };
      const command = RunLifecycleCommandRecordSchema.parse({ ...current, request,
        requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0delegation-admission\0${canonicalJsonStringify(request)}`) });
      const audit = RunLifecycleCommandAuditRecordSchema.parse(JSON.parse(z.string().parse(row.outcome_json)));
      const before = { ...audit, request: command }, json = canonicalJsonStringify(command);
      raw.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
        .run(json, sha256Hex(json), canonicalJsonStringify(before), command.commandId);
      raw.prepare("UPDATE command_audits SET payload_json=? WHERE command_id=?").run(canonicalJsonStringify(before), command.commandId);
    }
    const baseline = z.object({ id: z.string(), payload_json: z.string() }).parse(raw.prepare("SELECT id,payload_json FROM database_upgrades WHERE upgrade_id='fresh'").get());
    raw.prepare("UPDATE database_upgrades SET payload_json=? WHERE id=?").run(canonicalJsonStringify({
      ...z.record(z.string(), z.unknown()).parse(JSON.parse(baseline.payload_json)), toSchemaVersion: 18,
    }), baseline.id);
    raw.exec(auditTrigger);
    raw.exec(upgradeTrigger);
    raw.prepare("UPDATE database_states SET schema_version=18 WHERE id=1").run();
    raw.exec("PRAGMA user_version=18");
  } finally { raw.close(); }
}

it("backs up and converts a genuine waiting predecessor admission without changing its run, children or release identity", async () => {
  const { root, modules } = childPolicyModules("cascade");
  const h = await world.executorHarness({ descriptor: root.descriptor, stores: plan1Stores });
  const { database, clock, path, stateRoot, profile } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock), createCredentialStore({ stateRoot })) },
  { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface", requestedBy: "local-operator",
    requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  const execution = canonicalChildExecution(h.deps, database, path, id => modules.find(module => module.descriptor.id === id)?.descriptor);
  const run = execution.start(root.descriptor, { emplId: "10800000", text: "migration", mode: "ok" }, { dryRun: false });
  assert.equal((await execution.step(run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const wait = database.authority.dependencies.wait(run.envelope.runId, root.descriptor);
  assert.ok(wait);
  const releaseId = lifecycleCommandId("delegation-release", wait.admissionCommandId);
  const release = database.authority.lifecycleJournal.getCommand(releaseId), releaseAudit = database.authority.lifecycleJournal.findAuditByCommand(releaseId);
  assert.ok(release && releaseAudit);
  stopSyntheticDatabaseWorkers({ database, path });
  const retainedRun = database.authority.runs.get(run.envelope.runId);
  const children = database.authority.runs.listChildren(run.envelope.runId);
  const manifests = database.authority.delegationManifests.listByParentRun(run.envelope.runId);
  const dependencies = database.authority.dependencies.listByParentRun(run.envelope.runId);
  await h.manager.closeAll("worker-stop");
  h.authority.closeDatabase();
  restorePredecessor(path);
  const result = await withOfflineMaintenance(profile.admission, operation => upgradeStorage(profileBrowserClosure, profile.admission,
    { stateRoot, processLockRoot: join(profile.workspace, rebuildRuntimeIsolation.processLockRoot), plan: false }, clock, operation));
  assert.deepEqual(result, { state: "upgraded", fromSchemaVersion: 18, toSchemaVersion: 19, credentials: "unchanged" });
  const reopened = AuthorityDatabase.open(profile.admission, { path, busyTimeoutMs: 250, migrationOwner: "delegation-conversion-proof" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  try {
    assert.deepEqual(reopened.authority.runs.get(run.envelope.runId), retainedRun);
    assert.deepEqual(reopened.authority.runs.listChildren(run.envelope.runId), children);
    assert.deepEqual(reopened.authority.delegationManifests.listByParentRun(run.envelope.runId), manifests);
    assert.deepEqual(reopened.authority.dependencies.listByParentRun(run.envelope.runId), dependencies);
    assert.deepEqual(reopened.authority.dependencies.wait(run.envelope.runId, root.descriptor), wait);
    assert.deepEqual(reopened.authority.lifecycleJournal.getCommand(releaseId), release);
    assert.deepEqual(reopened.authority.lifecycleJournal.findAuditByCommand(releaseId), releaseAudit);
    const command = reopened.authority.lifecycleJournal.getCommand(wait.admissionCommandId);
    assert.ok(command && "kind" in command && command.kind === "run-lifecycle");
    assert.deepEqual(DelegationAdmissionRequestSchema.parse(command.request).members.map(member => member.nodeId), ["child"]);
    const phases = reopened.readUpgradePhases();
    assert.equal(phases.state, "available");
  } finally { reopened.close(); }
});
