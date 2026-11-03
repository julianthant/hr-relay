import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { convertDelegationAdmissionRow, migrateDelegationAdmissions } from "../../../../src/backend/storage/sqlite/delegation-admission-migration.js";
import { DelegationAdmissionRequestSchema, DelegationInvocationRequestSchema } from "../../../../src/backend/storage/sqlite/delegation-contracts.js";
import { RunLifecycleCommandRecordSchema } from "../../../../src/rules/commands/commands.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture(pending = false) {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  database.exec(`CREATE TABLE commands(id TEXT PRIMARY KEY,family TEXT,actor_id TEXT,parent_id TEXT,target_id TEXT,
    request_digest TEXT,request_json TEXT,state TEXT,outcome_json TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE command_audits(id TEXT PRIMARY KEY,command_id TEXT,payload_json TEXT,created_at TEXT)`);
  const runId = randomUUID(), fingerprint = "a".repeat(64);
  const invocation = DelegationInvocationRequestSchema.parse({ commandId: randomUUID(), runId, attempt: 1, nodeId: "lookup", edgeId: "lookup", manifestId: randomUUID(),
    definitionFingerprint: fingerprint, parentInputDigest: fingerprint, approvalDigest: fingerprint, scopeEvidence: [],
    target: { workflowId: "person-lookup", descriptorVersion: 1, contractFingerprint: fingerprint,
      inputSchemaHash: fingerprint, canonicalInputSchemaHash: fingerprint, resultSchemaHash: fingerprint },
    configSnapshotId: randomUUID(), configFingerprint: fingerprint, dryRun: true, cardinality: "many", join: "all-settled",
    policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    planFingerprint: fingerprint, children: [] });
  const frame = (operation: "delegation-invocation" | "delegation-admission", request: { commandId: string }, fence: unknown) => RunLifecycleCommandRecordSchema.parse({
    kind: "run-lifecycle", commandId: request.commandId, operation, request, fence, recordedAt: NOW,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0${operation}\0${canonicalJsonStringify(request)}`),
  });
  const request = { commandId: lifecycleCommandId("delegation-admission", { invocationCommandId: invocation.commandId, claimGeneration: 1, version: 4 }),
    runId, expectedVersion: 4, claim: { workerId: "worker-delegation-proof", claimGeneration: 1 }, invocationCommandId: invocation.commandId,
    scopeEvidence: [], observedScopeDigest: sha256Hex("[]") };
  const before = frame("delegation-admission", request, { kind: "terminal", expectedVersion: 4, ...request.claim });
  const audit = { kind: "run-lifecycle", auditId: before.commandId, request: before, result: { kind: "run", runId, appliedVersion: 5 }, completedAt: NOW };
  for (const command of [frame("delegation-invocation", invocation, { kind: "none" }), before]) {
    const json = canonicalJsonStringify(command), admission = command.commandId === before.commandId;
    database.prepare("INSERT INTO commands VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(command.commandId, "run-lifecycle", "local-operator", null, runId,
      sha256Hex(json), json, admission && !pending ? "succeeded" : "admitted", admission && !pending ? canonicalJsonStringify(audit) : null, NOW, NOW);
  }
  if (!pending) database.prepare("INSERT INTO command_audits VALUES(?,?,?,?)").run(audit.auditId, before.commandId, canonicalJsonStringify(audit), NOW);
  const row = () => database.prepare("SELECT * FROM commands WHERE id=?").get(before.commandId);
  return { database, before, invocation, row };
}

for (const pending of [false, true]) it(`converts ${pending ? "pending" : "completed"} predecessor custody while preserving its identity and release fence`, () => {
  const f = fixture(pending), original = f.row();
  assert.throws(() => commandFromRow(original));
  migrateDelegationAdmissions(f.database);
  const command = RunLifecycleCommandRecordSchema.parse(commandFromRow(f.row()));
  assert.equal(command.commandId, f.before.commandId);
  assert.deepEqual(command.fence, f.before.fence);
  const request = DelegationAdmissionRequestSchema.parse(command.request);
  assert.equal(request.nodeId, "lookup");
  assert.deepEqual(request.members, [{ state: "admitted", nodeId: "lookup", invocationCommandId: f.invocation.commandId,
    scopeEvidence: [], observedScopeDigest: sha256Hex("[]") }]);
  assert.throws(() => convertDelegationAdmissionRow(f.database, "commands", f.row()));
  assert.equal(f.database.prepare("SELECT count(*) AS count FROM commands").get()?.count, 2);
});

for (const fault of ["digest", "fingerprint", "fence", "missing-invocation", "foreign-invocation", "audit"] as const) {
  it(`refuses ${fault} predecessor corruption before changing any row`, () => {
    const f = fixture();
    if (fault === "digest") f.database.prepare("UPDATE commands SET request_digest=? WHERE id=?").run("b".repeat(64), f.before.commandId);
    else if (fault === "missing-invocation") f.database.prepare("DELETE FROM commands WHERE id=?").run(f.invocation.commandId);
    else if (fault === "foreign-invocation") {
      const invocation = { ...f.invocation, runId: randomUUID() };
      const command = { ...RunLifecycleCommandRecordSchema.parse(JSON.parse(String(f.database.prepare("SELECT request_json FROM commands WHERE id=?").get(f.invocation.commandId)?.request_json))),
        request: invocation, requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0delegation-invocation\0${canonicalJsonStringify(invocation)}`) };
      f.database.prepare("UPDATE commands SET request_json=? WHERE id=?").run(canonicalJsonStringify(command), f.invocation.commandId);
    } else {
      const command = fault === "fingerprint" ? { ...f.before, requestFingerprint: "b".repeat(64) }
        : fault === "fence" ? { ...f.before, fence: { kind: "none" } } : f.before;
      const json = canonicalJsonStringify(command);
      f.database.prepare("UPDATE commands SET request_json=?,request_digest=? WHERE id=?").run(json, sha256Hex(json), f.before.commandId);
      if (fault === "audit") f.database.prepare("UPDATE command_audits SET payload_json=?").run(canonicalJsonStringify({ kind: "run-lifecycle", auditId: f.before.commandId,
        request: { ...f.before, requestFingerprint: "b".repeat(64) }, result: { kind: "run", runId: f.invocation.runId, appliedVersion: 5 }, completedAt: NOW }));
    }
    const before = [f.database.prepare("SELECT * FROM commands ORDER BY id").all(), f.database.prepare("SELECT * FROM command_audits ORDER BY id").all()];
    assert.throws(() => migrateDelegationAdmissions(f.database));
    assert.deepEqual([f.database.prepare("SELECT * FROM commands ORDER BY id").all(), f.database.prepare("SELECT * FROM command_audits ORDER BY id").all()], before);
  });
}
