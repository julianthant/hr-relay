import { createSettingsAuthorityTestWorld } from "../../support/helpers/backend/settings-authority-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, onTestFinished } from "vitest";
import { inspectOpenDatabase } from "../../../src/backend/storage/sqlite/backup-inspection.js";
import { CanonicalClaimNextRequestSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../src/models/config/protected-settings.js";
import { deriveBulkChildCommand } from "../../../src/rules/commands/command-groups.js";
import { BulkRunCommandRequestSchema, CommandRequestSchema, deriveBulkRunCommandFingerprint, COMMAND_FAMILY_REGISTRY, CommandIdentityConflictError, CommandResultSchema, markSettingsCommand } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { AuthorityDatabase, createCredentialStore, inspectAuthorityBackupReadOnly } from "../../support/helpers/synthetic-storage-admission.js";
import { PHASE1_ACTIVE_COMMAND_ARMS, PHASE1_DEFERRED_COMMAND_ARMS } from "../../../src/backend/runs/commands/command-kernel.js";








import { createIntakeAuthority, INTAKE_CSV } from "../../support/fixtures/dashboard/fixture-intake-authority.js";
import { defineIntakeFixtureDescriptor, INTAKE_FIXTURE_WORKFLOW_ID } from "../../support/fixtures/intake-workflow-fixture.js";
import { failure, foundationFixture, HASH, id, NOW as FOUNDATION_NOW, terminalizeFixtureFailure } from "../../support/helpers/database-foundation/fixtures.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import { CONFIG_SNAPSHOT, NOW, UUID_5, UUID_6, UUID_7, UUID_8 } from "../../support/fixtures/phase1c-contract-fixtures.js";

{
const roots: string[] = [];
const opened: AuthorityDatabase[] = [];
const now = "2026-09-08T12:00:00.000Z";
const clock = manualClock(new Date(now));
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "command-groups-")); roots.push(root);
  const stateRoot = join(root, ".tracker", "data"); mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const path = join(stateRoot, "state.db");
  const open = () => { const db = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "command-group-test" }, clock); opened.push(db); return db; };
  return { path, stateRoot, open };
}
function acceptance() {
  const id = randomUUID();
  const request = BulkRunCommandRequestSchema.parse({ commandId: id, bulkCommandId: id, requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel", reason: "synthetic selection", mode: "best-effort", targets: [{ runId: randomUUID(), expectedVersion: 1 }, { runId: randomUUID(), expectedVersion: 4 }] });
  return { bulkCommandId: id, request, requestFingerprint: deriveBulkRunCommandFingerprint(request) };
}
function lifecycleCommand(commandId: string) {
  const request = CanonicalClaimNextRequestSchema.parse({ commandId, workflow: "person-lookup", workerId: "person-lookup-worker-1",
    runtimeConfig: { generation: 1, settingsRevision: 1, settingsFingerprint: "a".repeat(64), configFingerprint: "b".repeat(64) } });
  return { kind: "run-lifecycle", commandId, operation: "claim-next", request,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0claim-next\0${canonicalJsonStringify(request)}`),
    fence: { kind: "none" }, recordedAt: now };
}
describe("command groups", () => {
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("keeps standalone, parent and child records distinct, fences membership and counts only executable commands", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance();
    db.authority.commands.acceptBulk(parent);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.pendingCommands, 0);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]);
    assert.throws(() => db.authority.commands.insert(child), /requires its parent/);
    assert.throws(() => db.authority.commands.insert(child, randomUUID()), /invalid parent membership/);
    assert.throws(() => db.authority.commands.insert({ ...child, reason: "forged" }, parent.bulkCommandId), /invalid parent membership/);
    assert.equal(db.authority.commands.insert(child, parent.bulkCommandId).state, "inserted");
    assert.equal(db.authority.commands.insert(child, parent.bulkCommandId).state, "existing");
    assert.throws(() => db.authority.commands.insert(child), /different-parent replay/);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.pendingCommands, 1);
    assert.equal(db.authority.commands.parentId(child.commandId), parent.bulkCommandId);
    const standalone = { ...child, commandId: randomUUID() };
    db.authority.commands.insert(standalone);
    assert.equal(db.authority.commands.parentId(standalone.commandId), null);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.pendingCommands, 2);
    assert.equal(CommandRequestSchema.safeParse({ kind: "bulk-parent", commandId: parent.bulkCommandId, acceptance: parent }).success, false);
    assert.throws(() => db.authority.commands.get(parent.bulkCommandId));
    assert.throws(() => db.authority.lifecycleJournal.getCommand(parent.bulkCommandId));
    assert.throws(() => db.authority.commands.getSettingsHistory(parent.bulkCommandId));
    assert.equal(CommandRequestSchema.safeParse({ ...standalone, parent_command_id: parent.bulkCommandId }).success, false);
    assert.throws(() => db.authority.lifecycleJournal.insertCommand(lifecycleCommand(parent.bulkCommandId)), /reused with different content/);

    assert.equal(db.authority.commands.acceptBulk(parent).state, "existing");
    assert.equal(db.authority.commandAudits.findByCommand(parent.bulkCommandId), undefined);
  });

  it("rejects parent/single collisions and rolls back a failed child without rolling back accepted siblings", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance();
    db.authority.commands.acceptBulk(parent);
    const [first, second] = parent.request.targets.map((target) => deriveBulkChildCommand(parent.request, target));
    db.authority.commands.insert(first, parent.bulkCommandId);
    assert.throws(() => db.withAuthorityTransaction((repo) => { repo.commands.insert(second, parent.bulkCommandId); throw new Error("child-before-commit"); }), /child-before-commit/);
    assert.equal(db.authority.commands.get(second.commandId), undefined);
    assert.deepEqual(db.authority.commands.get(first.commandId), first);
    assert.deepEqual(db.authority.commands.getBulk(parent.bulkCommandId), parent);
    assert.throws(() => db.authority.commands.insert({ ...first, commandId: parent.bulkCommandId }), /reused with different content/);
    const lifecycleCollision = acceptance();
    db.authority.lifecycleJournal.insertCommand(lifecycleCommand(lifecycleCollision.bulkCommandId));
    assert.throws(() => db.authority.commands.acceptBulk(lifecycleCollision), /reused with different content/);
    const preexistingChildParent = acceptance();
    db.authority.commands.insert(deriveBulkChildCommand(preexistingChildParent.request, preexistingChildParent.request.targets[0]));
    assert.throws(() => db.authority.commands.acceptBulk(preexistingChildParent), /reserves an existing command identity/);
    const colliding = acceptance();
    db.authority.commands.insert({ ...first, commandId: colliding.bulkCommandId });
    assert.throws(() => db.authority.commands.acceptBulk(colliding), /reused with different content/);
    db.close(); const restarted = f.open();
    assert.equal(restarted.authority.commands.insert(first, parent.bulkCommandId).state, "existing");
    assert.equal(restarted.authority.commands.insert(second, parent.bulkCommandId).state, "inserted");
  });

  it("protects current credential command identities before acceptance", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance();
    const store = createCredentialStore({ stateRoot: f.stateRoot });
    assert.equal(store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: parent.bulkCommandId, commandFingerprint: "a".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-command-group-credential" } }, updatedAt: now })).state, "applied");
    assert.throws(() => db.authority.commands.acceptBulk(parent), /command-divergent/);
    assert.equal(db.authority.commands.getBulk(parent.bulkCommandId), undefined);

  });

  it("rejects SQL self/missing/nested parents and keeps acceptance immutable without a fabricated audit", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance(); db.authority.commands.acceptBulk(parent);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]);
    const raw = new DatabaseSync(f.path);
    try {
      const statement = raw.prepare("INSERT INTO commands(id,family,actor_id,request_json,created_at,parent_id,request_digest,state,updated_at) VALUES (?,?,'local-operator',?,?,?,?,'admitted',?)");
      const insert = { run: (id: string, family: string, json: string, at: string, parentId: string) =>
        statement.run(id, family, json, at, parentId, sha256Hex(json), at) };
      assert.throws(() => insert.run(child.commandId, "run", JSON.stringify(child), now, child.commandId), /commands-parent-kind/u);
      assert.throws(() => insert.run(child.commandId, "run", JSON.stringify(child), now, randomUUID()), /commands-parent-kind/u);
      assert.throws(() => insert.run(randomUUID(), "bulk-parent", JSON.stringify(parent), now, parent.bulkCommandId), /commands-parent-kind/u);
      assert.throws(() => raw.prepare("DELETE FROM commands WHERE id=?").run(parent.bulkCommandId), /commands-bulk-retained/u);
      assert.throws(() => raw.prepare("UPDATE commands SET created_at=? WHERE id=?").run("2026-09-09T00:00:00.000Z", parent.bulkCommandId), /immutable/);
      assert.throws(() => raw.prepare("INSERT INTO command_audits(id,command_id,payload_json,created_at) VALUES (?,?,?,?)").run(randomUUID(), parent.bulkCommandId, "{}", now), /command-audits-no-bulk-parent/u);
    } finally { raw.close(); }
  });

  it.each(["removed", "reassigned"] as const)("detects %s child linkage in current inspection and backup admission", (kind) => {
    const f = fixture(); const db = f.open(); const parent = acceptance(); db.authority.commands.acceptBulk(parent);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]); db.authority.commands.insert(child, parent.bulkCommandId);
    const other = acceptance(); db.authority.commands.acceptBulk(other); db.close();
    const raw = new DatabaseSync(f.path);
    try {
      const trigger = String(raw.prepare("SELECT sql FROM sqlite_master WHERE name='commands_parent_immutable'").get()?.sql);
      assert.throws(() => raw.prepare("UPDATE commands SET parent_id=NULL WHERE id=?").run(child.commandId), /immutable/);
      raw.exec("DROP TRIGGER commands_parent_immutable");
      raw.prepare("UPDATE commands SET parent_id=? WHERE id=?").run(kind === "removed" ? null : other.bulkCommandId, child.commandId);
      raw.exec(trigger);
      assert.throws(() => inspectOpenDatabase(raw), /command-group child linkage mismatch/);
    } finally { raw.close(); }
    assert.throws(() => inspectAuthorityBackupReadOnly(f.path), /command-group child linkage mismatch/);
  });

});
}

{
describe("deferred arms", () => {

  it("partitions every family/action exactly once between active and deferred", () => {
    const partitioned = new Map<string, number>();
    for (const partition of [PHASE1_ACTIVE_COMMAND_ARMS, PHASE1_DEFERRED_COMMAND_ARMS]) {
      for (const [family, actions] of Object.entries(partition)) {
        for (const action of actions) {
          const key = `${family}/${action}`;
          partitioned.set(key, (partitioned.get(key) ?? 0) + 1);
        }
      }
    }
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...partitioned.keys()].sort(), [...registry].sort());
    for (const [key, count] of partitioned) assert.equal(count, 1, key);
  });

});
}

{
const { fixture, protectedCommand, failAudit, cleanup } = createSettingsAuthorityTestWorld();






describe("SQLite settings authority", () => {
afterEach(cleanup);

  it("protects a retained credential identity from internal lifecycle journal writers", () => {
    const f = fixture(); const pending = protectedCommand(f.store.read().revision);
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const generation = f.database.getMeta().authorityGeneration;
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    assert.throws(() => f.database.withAuthorityTransaction((repositories) => repositories.lifecycleJournal.insertCommand({
      kind: "run-lifecycle", commandId: pending.commandId, operation: "create",
      requestFingerprint: "0".repeat(64), request: {}, fence: { kind: "none" }, recordedAt: pending.requestedAt,
    })), CommandIdentityConflictError);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.execute(pending).state, "applied");
  });
});
}

{
type Harness = ReturnType<typeof createIntakeAuthority>;
const opened: Harness[] = [];
function harness() { const h = createIntakeAuthority(); opened.push(h); return h; }
async function send(h: Harness, wire: { intakeSessionId: string; expectedVersion: number }, type: string, payload?: unknown) {
  const response = await h.post(h.request(wire, type, payload));
  const result = CommandResultSchema.parse(await response.json());
  assert.equal(result.state, "applied", JSON.stringify(result));
  return h.intake.read(wire.intakeSessionId);
}
async function ready(h: Harness, csv = INTAKE_CSV) {
  let wire = (await h.upload(csv)).session;
  for (const [target, column] of [["emplId", 0], ["effectiveDate", 1]] as const) wire = await send(h, wire, "confirm-intake-mapping", { targetFieldId: target, sourceColumnId: wire.columns[column].sourceColumnId, headerFingerprint: wire.headerFingerprint });
  wire = await send(h, wire, "exclude-intake-row", { sourceRow: 2, reason: "Synthetic malformed identifier" });
  return send(h, wire, "validate-intake");
}
async function enqueue(h: Harness, wire: Awaited<ReturnType<typeof ready>>) {
  return send(h, wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding });
}
function noEffects(h: Harness, wire: Awaited<ReturnType<typeof ready>>) {
  assert.equal(h.database.authority.intakeManifests.get(wire.reservedManifestId ?? ""), undefined);
  assert.equal(h.database.authority.intakeSessions.get(wire.intakeSessionId)?.state, "validated");
  assert.ok(h.database.authority.runSessions.list().every(session => session.origin.kind !== "intake-manifest" || session.origin.intakeManifestId !== wire.reservedManifestId));
}
it("refuses an unavailable declared protected origin and rolls back the entire prepared fan-out",async()=>{
  onTestFinished(() => { for (const h of opened.splice(0)) h.close(); });

  const h=harness();
  h.setDescriptor(defineIntakeFixtureDescriptor({id:INTAKE_FIXTURE_WORKFLOW_ID,code:"if",contractFingerprint:"f".repeat(64),enqueue:"allow-parallel",protectedTimekeeper:true}));
  const wire=await ready(h);
  const result=CommandResultSchema.parse(await (await h.post(h.request(wire,"enqueue-intake-manifest",{dryRun:false,reviewBinding:wire.reviewBinding}))).json());
  assert.equal(result.state,"rejected");
  if (result.state !== "rejected") throw new Error("protected source refusal missing");
  assert.equal(result.code, "invalid-state");
  assert.equal(result.message, "protected input timekeeperName source is unavailable");
  noEffects(h,wire);
  assert.deepEqual(h.database.authority.runs.listByWorkflow(INTAKE_FIXTURE_WORKFLOW_ID),[]);
});
it.each([undefined, "0".repeat(64)])("refuses missing or mismatched confirmation with zero manifest effects (%s)", async reviewBinding => {
  onTestFinished(() => { for (const h of opened.splice(0)) h.close(); });

  const h = harness(); const wire = await ready(h);
  const result = CommandResultSchema.parse(await (await h.post(h.request(wire, "enqueue-intake-manifest", { dryRun: false, ...(reviewBinding === undefined ? {} : { reviewBinding }) }))).json());
  assert.equal(result.state, "rejected"); noEffects(h, wire);
  const committed = await enqueue(h, wire); assert.equal(committed.state, "enqueued"); assert.equal(committed.manifest?.validRows.length, 2);
});
it("binds explicit different-file comparison, preserves it on retry/restart, and invalidates old confirmation", async () => {
  onTestFinished(() => { for (const h of opened.splice(0)) h.close(); });

  const h = harness(); const first = await enqueue(h, await ready(h)); assert.ok(first.manifest);
  const before = JSON.stringify(h.database.authority.intakeManifests.get(first.manifest.manifestId));
  const changedCsv = INTAKE_CSV.replace("10998801", "10888888");
  const wire = await ready(h, changedCsv); const priorBinding = wire.reviewBinding;
  const compared = await send(h, wire, "inspect-intake", { comparisonManifestId: first.manifest.manifestId });
  assert.notEqual(compared.reviewBinding, priorBinding); assert.equal(compared.rerun?.intakeManifestId, first.manifest.manifestId);
  assert.equal(compared.rerun?.diff.kind, "changed");
  const retry = await h.upload(changedCsv); assert.equal(retry.state, "joined"); assert.equal(retry.session.reviewBinding, compared.reviewBinding);
  h.restart(); const cold = await h.intake.read(wire.intakeSessionId); assert.deepEqual(cold, compared);
  const stale = CommandResultSchema.parse(await (await h.post(h.request(compared, "enqueue-intake-manifest", { dryRun: false, reviewBinding: priorBinding }))).json());
  assert.equal(stale.state, "rejected"); noEffects(h, compared);
  await enqueue(h, cold); assert.equal(JSON.stringify(h.database.authority.intakeManifests.get(first.manifest.manifestId)), before);
});

it("replays a genuinely completed current intake command after its source bytes disappear without rereading or new effects", async () => {
  onTestFinished(() => { for (const h of opened.splice(0)) h.close(); });

  const h = harness();
  const wire = await ready(h);
  const request = h.request(wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding });
  const result = CommandResultSchema.parse(await (await h.post(request)).json());
  assert.equal(result.state, "applied");
  const inventory = () => {
    const raw = new DatabaseSync(h.path, { readOnly: true });
    try { return raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
      if (typeof name !== "string" || !/^[a-z_]+$/u.test(name)) throw new Error("invalid native table name");
      return { name, rows: raw.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() };
    }); } finally { raw.close(); }
  };
  const before = inventory();
  const generation = h.database.getMeta().authorityGeneration;
  const ids = h.mintedIds;
  const reads = h.artifactReads;
  const artifactRoot = join(h.root, ".tracker", "artifacts");
  const source = join(artifactRoot, `${wire.artifact.sha256}.artifact`);
  assert.ok(readFileSync(source).length > 0);
  unlinkSync(source);
  const remainingFiles = readdirSync(artifactRoot).map(name => ({ name, bytes: readFileSync(join(artifactRoot, name)) }));
  h.restart();
  const replay = CommandResultSchema.parse(await (await h.post(request)).json());
  assert.deepEqual(replay, { ...result, state: "already-applied" });
  assert.deepEqual(inventory(), before);
  assert.equal(h.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(h.mintedIds, ids);
  assert.equal(h.artifactReads, reads);
  assert.deepEqual(readdirSync(artifactRoot).map(name => ({ name, bytes: readFileSync(join(artifactRoot, name)) })), remainingFiles);
});
}

{
describe("F shared transactional storage contracts",()=>{
 it("rolls annotation and generation back on audit failure, fences competing writes and retains immutable UNKNOWN evidence",()=>{
  const f=foundationFixture();const raw=new DatabaseSync(f.path);
  try{
   const record=failure();terminalizeFixtureFailure(f,f.run,record);
   const original=raw.prepare("SELECT payload_json FROM run_failures WHERE id=?").get(record.failureId)?.payload_json;
   const request={runId:record.runId,failureId:record.failureId,expectedVersion:1,resolution:{status:"resolved",version:2,by:"local-operator",at:FOUNDATION_NOW,note:"synthetic annotation"}};
   const generation=f.db.getMeta().authorityGeneration;
   assert.throws(()=>f.db.withAuthorityTransaction(a=>{a.failureResolution.update(request);throw new Error("audit-write-fault");}),/audit-write-fault/u);
   assert.deepEqual(f.db.authority.failureResolution.read(record.runId,record.failureId)?.resolution,{status:"unresolved",version:1});
   assert.equal(f.db.getMeta().authorityGeneration,generation);
   f.db.authority.failureResolution.update(request);
   const second=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"annotation-second-connection"});
   try{
    assert.deepEqual(second.authority.failureResolution.read(record.runId,record.failureId)?.resolution,request.resolution);
    assert.throws(()=>second.authority.failureResolution.update(request),/version-conflict/u);
    second.authority.failureResolution.update({...request,expectedVersion:2,resolution:{status:"unresolved",version:3}});
   }finally{second.close();}
   assert.deepEqual(f.db.authority.failureResolution.read(record.runId,record.failureId)?.resolution,{status:"unresolved",version:3});
   assert.equal(raw.prepare("SELECT payload_json FROM run_failures WHERE id=?").get(record.failureId)?.payload_json,original);
   assert.equal(f.db.authority.failures.get(record.failureId)?.writeState,"unknown");
   assert.throws(()=>raw.prepare("UPDATE run_failures SET payload_json='{}',resolution_version=resolution_version+1,resolution_json=json_set(resolution_json,'$.version',resolution_version+1) WHERE id=?").run(record.failureId),/immutable/u);
   assert.throws(()=>f.db.authority.failureResolution.update({...request,runId:id(99)}),/version-conflict/u);
  }finally{raw.close();f.dispose();}
 });
 it("freezes S's ordinary no-restart result arm while protecting target and journal identity",()=>{
  const input={state:"applied",commandId:id(1),affectedTargets:[{family:"settings",revision:2}],restartRequired:false,settingsRevision:2,settingsFingerprint:HASH};assert.deepEqual(CommandResultSchema.parse(input),input);assert.equal(CommandResultSchema.safeParse({...input,settingsRevision:3}).success,false);assert.equal(CommandResultSchema.safeParse({...input,entries:[]}).success,false);
 });
});
}

{
const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const CLOCK = manualClock(new Date(NOW));

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);

  return database;
}

describe("authority persistence invariants", () => {
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

  it("finds a protected write-id owner after restart while excluding the replaying command", () => {
    const path = databasePath("protected-write-id.sqlite");
    const ownerCommandId = UUID_6;
    const writeId = UUID_7;
    const first = openDatabase(path);
    first.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    first.authority.commands.insert(markSettingsCommand({
      commandId: ownerCommandId,
      requestedAt: NOW,
      requestedBy: LOCAL_OPERATOR_ACTOR_ID,
      source: "settings-surface",
      family: "settings",
      type: "apply-protected-settings",
      target: { expectedRevision: 1 },
      payload: {
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId,
        entries: { ucpathPassword: { set: "synthetic-protected-value" } },
      },
    }));
    first.close();

    const reopened = openDatabase(path);
    const lookup: unknown = Reflect.get(
      reopened.authority.commands,
      "findProtectedSettingsCommandIdByWriteId",
    );
    assert.equal(typeof lookup, "function");
    const findOwner = lookup as (input: unknown) => string | undefined;
    assert.equal(findOwner({ writeId, excludingCommandId: ownerCommandId }), undefined);
    assert.equal(findOwner({ writeId, excludingCommandId: UUID_8 }), ownerCommandId);
    assert.equal(findOwner({ writeId: UUID_5, excludingCommandId: UUID_8 }), undefined);
  });
});
}
