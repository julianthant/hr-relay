import { deriveBulkRunCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { NativeCommandAuditSchema,AssistantM1NativeCommandAuditSchema,AssistantM1NativeCommandRowSchema,assertAssistantM1CommandIdentity,commandIdentity,convertAssistantCommandPairToM1,commandFromRow,insertNativeCommand,settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { SETTINGS_SCHEMA_HASH,derivePersistedSettingsFingerprint } from "../../../../src/models/config/settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { COMMAND_FIXTURES,HASH_A,HASH_B,LATER,NOW,UUID_1,UUID_2,UUID_3,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const databases:DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
const request={commandId:UUID_1,runId:UUID_2,expectedVersion:5};
const command={kind:"run-lifecycle",commandId:UUID_1,operation:"delete",request,
  requestFingerprint:sha256Hex(`hrauto:run-lifecycle-command:v1\0delete\0${canonicalJsonStringify(request)}`),
  fence:{kind:"version",expectedVersion:5},recordedAt:NOW};
describe("whole native internal commands",()=>{
  it("persists the complete admitted request, immutable outcome and exact replay",()=>{
    const db=new DatabaseSync(":memory:");databases.push(db);
    for(const migration of SQLITE_MIGRATIONS)for(const sql of migration.statements)db.exec(sql);
    expect(insertNativeCommand(db,command)).toBe(1);
    expect(commandFromRow(db.prepare("SELECT * FROM commands").get())).toEqual(command);
    expect(db.prepare("SELECT target_id FROM commands").get()?.target_id).toBe(UUID_2);
    expect(()=>commandFromRow({...db.prepare("SELECT * FROM commands").get(),target_id:UUID_3})).toThrow(/identity-mismatch/u);
    const audit={kind:"run-lifecycle",auditId:UUID_3,request:command,result:{kind:"deletion",runIds:[UUID_2]},completedAt:LATER};
    settleNativeCommand(db,audit);expect(insertNativeCommand(db,command)).toBe(0);settleNativeCommand(db,audit);
    expect(db.prepare("SELECT state,updated_at,outcome_json FROM commands").get()).toEqual({state:"succeeded",updated_at:LATER,outcome_json:canonicalJsonStringify(audit)});
    expect(()=>settleNativeCommand(db,{...audit,result:{kind:"deletion",runIds:[UUID_3]}})).toThrow();
    expect(()=>insertNativeCommand(db,{...command,request:{...request,expectedVersion:6}})).toThrow();
  });
});

const ordinary = { ...commandIdentity(COMMAND_FIXTURES[0]).request, source: "assistant" };
const ordinaryAudit = { auditId: UUID_3, request: ordinary,
  result: { state: "applied", commandId: UUID_1, affectedTargets: [{ family: "run", runId: UUID_2 }] },
  completedAt: LATER, versionChanges: [], affectedDependencyIds: [] };
function pair(request: unknown, audit: unknown = null, state = audit === null ? "admitted" : "succeeded") {
  const identity = commandIdentity(request);
  const parsed = audit === null ? null : NativeCommandAuditSchema.parse(audit);
  return { command: { id: identity.request.commandId, family: identity.family, actor_id: identity.actor, parent_id: null,
    target_id: identity.targetId, request_digest: sha256Hex(identity.json), request_json: JSON.stringify(request, null, 2), state,
    outcome_json: audit === null ? null : canonicalJsonStringify(audit), created_at: identity.createdAt, updated_at: audit === null ? identity.createdAt : LATER },
  audit: audit === null ? null : { id: UUID_3, command_id: identity.request.commandId, code: parsed !== null && "code" in parsed.result ? parsed.result.code : null, payload_json: canonicalJsonStringify(audit), created_at: LATER } };
}
const attribution = { kind: "assistant", requestedBy: "local-operator", profileId: UUID_1, conversationId: UUID_2,
  acceptedMessageId: UUID_3, binding: { kind: "session", actionId: UUID_4 } };
describe("unregistered M1 command attribution conversion", () => {
  it.each(["admitted", "executing"])("preserves exact %s request bytes and explicit unknown provenance", state => {
    const before = pair(ordinary, null, state), after = convertAssistantCommandPairToM1(before.command, before.audit);
    expect(after).toEqual({ command: { ...before.command, attribution_json: '{"kind":"unrecorded"}' }, audit: null });
    expect(AssistantM1NativeCommandRowSchema.parse(after.command)).toEqual(after.command);
    expect(() => assertAssistantM1CommandIdentity(after.command, ordinary, { kind: "unrecorded" })).not.toThrow();
    expect(() => assertAssistantM1CommandIdentity(after.command, ordinary, attribution)).toThrow(/command-divergent/u);
    expect(() => commandFromRow(after.command)).toThrow();
    expect(AssistantM1NativeCommandRowSchema.safeParse(before.command).success).toBe(false);
  });
  it("authenticates ordinary settled copies without inferring assistant provenance", () => {
    const before = pair(ordinary, ordinaryAudit), snapshot = structuredClone(before), after = convertAssistantCommandPairToM1(before.command, before.audit);
    expect(before).toEqual(snapshot);
    expect(after.command.request_json).toBe(before.command.request_json);
    expect(after.command.request_digest).toBe(before.command.request_digest);
    expect(after.command.parent_id).toBeNull();
    expect(after.audit?.payload_json).toBe(after.command.outcome_json);
    expect(JSON.parse(after.command.outcome_json ?? "null")).toEqual({ ...ordinaryAudit, attribution: { kind: "unrecorded" } });
    expect(AssistantM1NativeCommandAuditSchema.parse(JSON.parse(after.audit?.payload_json ?? "null")).request).toEqual(ordinary);
    expect(() => assertAssistantM1CommandIdentity(after.command, ordinary, { kind: "unrecorded" })).not.toThrow();
    expect(() => assertAssistantM1CommandIdentity(after.command, ordinary, attribution)).toThrow(/command-divergent/u);
    expect(() => assertAssistantM1CommandIdentity(after.command, ordinary, { kind: "unrecorded" }, UUID_2)).toThrow(/command-divergent/u);
    const changed = AssistantM1NativeCommandAuditSchema.parse({ ...ordinaryAudit, attribution });
    const attributed = { ...after.command, attribution_json: canonicalJsonStringify(attribution), outcome_json: canonicalJsonStringify(changed) };
    expect(AssistantM1NativeCommandRowSchema.parse(attributed)).toEqual(attributed);
    expect(() => assertAssistantM1CommandIdentity(attributed, ordinary, attribution)).not.toThrow();
    expect(AssistantM1NativeCommandRowSchema.safeParse({ ...attributed, attribution_json: "invalid-json" }).success).toBe(false);
    expect(AssistantM1NativeCommandAuditSchema.safeParse({ ...changed, extra: true }).success).toBe(false);
    expect(AssistantM1NativeCommandAuditSchema.safeParse({ ...changed, result: { state: "pending", commandId: UUID_1 } }).success).toBe(false);
    expect(NativeCommandAuditSchema.safeParse(changed).success).toBe(false);
    const dashboard = { ...ordinary, source: "dashboard" }, dashboardAudit = { ...ordinaryAudit, request: dashboard };
    expect(AssistantM1NativeCommandAuditSchema.safeParse({ ...dashboardAudit, attribution }).success).toBe(false);
    const dashboardPair = pair(dashboard, dashboardAudit), historical = convertAssistantCommandPairToM1(dashboardPair.command, dashboardPair.audit);
    expect(historical.command.attribution_json).toBe('{"kind":"unrecorded"}');
    expect(AssistantM1NativeCommandRowSchema.safeParse({ ...pair(dashboard).command, attribution_json: canonicalJsonStringify(attribution) }).success).toBe(false);
    expect(AssistantM1NativeCommandRowSchema.safeParse({ ...historical.command, attribution_json: canonicalJsonStringify(attribution),
      outcome_json: canonicalJsonStringify({ ...dashboardAudit, attribution }) }).success).toBe(false);
    expect(AssistantM1NativeCommandRowSchema.safeParse({ ...after.command, outcome_json: canonicalJsonStringify(changed) }).success).toBe(false);
    expect(AssistantM1NativeCommandAuditSchema.safeParse({ ...changed, attribution: { ...attribution, requestedBy: "foreign" } }).success).toBe(false);
  });
  it("preserves lifecycle and settings-initialization audit refinements", () => {
    const lifecycle = { kind: "run-lifecycle", auditId: UUID_3, request: command, result: { kind: "deletion", runIds: [UUID_2] }, completedAt: LATER };
    const settings = { kind: "settings-initialization", commandId: UUID_1, revision: 1,
      settings: { revision: 1, settingsSchemaHash: SETTINGS_SCHEMA_HASH, settingsFingerprint: derivePersistedSettingsFingerprint({}), settings: {} }, configSnapshotId: UUID_2, configFingerprint: HASH_A, initializedAt: LATER };
    const initialized = { kind: "settings-initialization", auditId: UUID_3, request: settings,
      result: { state: "initialized", revision: 1, snapshotId: UUID_2, fingerprint: HASH_A }, completedAt: LATER };
    for (const [request, audit] of [[command, lifecycle], [settings, initialized]]) {
      const before = pair(request, audit), after = convertAssistantCommandPairToM1(before.command, before.audit);
      expect(JSON.parse(after.audit?.payload_json ?? "null")).toEqual({ ...audit, attribution: { kind: "unrecorded" } });
      expect(AssistantM1NativeCommandAuditSchema.safeParse({ ...audit, attribution }).success).toBe(false);
    }
    expect(AssistantM1NativeCommandAuditSchema.safeParse({ ...initialized, result: { ...initialized.result, fingerprint: HASH_B }, attribution: { kind: "unrecorded" } }).success).toBe(false);
  });
  it("keeps valid bulk-parent no-audit settlement and refuses uncertain or missing terminal proof", () => {
    const request = { commandId: UUID_1, bulkCommandId: UUID_1, requestedBy: "local-operator", requestedAt: NOW,
      source: "dashboard", family: "run", type: "pause", targets: [{ runId: UUID_2, expectedVersion: 1 }], mode: "best-effort" };
    const bulk = { kind: "bulk-parent", commandId: UUID_1, acceptance: { bulkCommandId: UUID_1, request,
      requestFingerprint: deriveBulkRunCommandFingerprint(request) } };
    const before = pair(bulk, null, "succeeded");
    expect(convertAssistantCommandPairToM1(before.command, null).audit).toBeNull();
    for (const state of ["succeeded", "refused", "uncertain"]) expect(() => convertAssistantCommandPairToM1(pair(ordinary, null, state).command, null)).toThrow();
    const settled = pair(ordinary, ordinaryAudit);
    expect(() => convertAssistantCommandPairToM1(settled.command, null)).toThrow();
    expect(() => convertAssistantCommandPairToM1(pair(ordinary).command, settled.audit)).toThrow();
  });
  it("keeps refused audits and rejects invalid native identity, columns, state and mirrored payload", () => {
    const audit = { ...ordinaryAudit, result: { state: "rejected", commandId: UUID_1, code: "replan-required", message: "Stale" } };
    const refused = pair(ordinary, audit, "refused");
    expect(convertAssistantCommandPairToM1(refused.command, refused.audit).command.state).toBe("refused");
    const before = pair(ordinary, ordinaryAudit);
    for (const patch of [{ id: UUID_2 }, { actor_id: "foreign" }, { target_id: UUID_3 }, { request_digest: HASH_B },
      { created_at: LATER }, { updated_at: NOW }, { state: "uncertain" }, { outcome_json: null }]) {
      expect(() => convertAssistantCommandPairToM1({ ...before.command, ...patch }, before.audit)).toThrow();
    }
    for (const patch of [{ id: UUID_2 }, { command_id: UUID_2 }, { code: "replan-required" }, { created_at: NOW },
      { payload_json: canonicalJsonStringify({ ...ordinaryAudit, versionChanges: [{ target: { family: "run", runId: UUID_2 }, before: 1, after: 2 }] }) }]) {
      expect(() => convertAssistantCommandPairToM1(before.command, { ...before.audit, ...patch })).toThrow();
    }
  });
});
