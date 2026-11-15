import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
import { z } from "zod";
import { CanonicalListRunsRequestSchema } from "../../../../src/backend/storage/sqlite/run-store-contracts.js";
import { createAssistantService } from "../../../../src/backend/assistant/service.js";
import { AssistantToolRefusal } from "../../../../src/backend/assistant/plugins/plugin.js";
import { createAssistantReferenceTable } from "../../../../src/backend/assistant/references.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { PersonLookupCanonicalInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { EXECUTOR_EID, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { createAssistantPlugins } from "../../../../src/backend/assistant/plugins/registry.js";
import { assistantWorkflowFacts } from "../../../../src/backend/assistant/plugins/workflows/facts.js";
import { createAssistantPluginDeps } from "../../../../src/backend/app/composition/dashboard/assistant.js";
import { composeNotificationRoutes } from "../../../../src/backend/app/composition/dashboard/notification-wiring.js";
import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
import { createNotificationTargetQuery } from "../../../../src/backend/runs/queries/notifications.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { AssistantInferenceRequestSchema } from "../../../../src/models/dashboard/assistant.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { EditableWorkbookSchema } from "../../../../src/models/dashboard/workbooks.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../../support/helpers/chatgpt-account-fixtures.js";
import { completedResponseStream } from "../../../support/helpers/chatgpt-response-stream.js";
import { makeWorld, runRecordOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import { createSubjectTitleTestWorld } from "../../../support/helpers/backend/subject-title-world.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { seedInitialSettingsRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const worlds: DashboardWorld[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.dispose(); });

const { descriptor: subjectDescriptor, searchingCheckpoint, RESOLVED } = createSubjectTitleTestWorld();
const CANARIES = {
  subject: RESOLVED.selected.name, eid: RESOLVED.selected.emplId, actor: "canary-actor-operator", runTitle: "Canary run title",
  notificationTitle: "Canary notification title", notificationSummary: "Canary notification summary",
  workbook: "Canary Roster Workbook", worksheet: "Canary Worksheet", cell: "Canary cell value", typeName: "Canary Workbook Type",
  fieldLabel: "Canary Field Label", field: "roster.CanaryField", header: "Canary column header", setting: "Canary Operator Label",
} as const;
const WireSchema = AssistantInferenceRequestSchema.safeExtend({ store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false),
  include: z.tuple([z.literal("reasoning.encrypted_content")]) });

async function seededOwners() {
  const w = await makeWorld({ descriptors: { resolve: () => subjectDescriptor } }); worlds.push(w);
  const { database, clock } = w;
  if (database.authority.runtimeConfig.get() === undefined) seedInitialSettingsRuntimeConfig(database, clock);
  const run = runRecordOf({ seed: 41, descriptor: subjectDescriptor, claimGeneration: 1 });
  database.authority.runs.enqueue(run);
  database.registerRunSearchDeclarations([{ workflow: run.envelope.workflow, version: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint, subjectProjection: subjectDescriptor.subjectProjection ?? null }]);
  const e = run.envelope;
  createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit({
    t: "run.queued", kind: "run", ts: clock.now().toISOString(), workflow: e.workflow, runId: e.runId, attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId,
    itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun, actorId: CANARIES.actor, title: CANARIES.runTitle, descriptorVersion: e.descriptorVersion,
    contractFingerprint: e.contractFingerprint, resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId });
  database.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse(searchingCheckpoint(41, RESOLVED)));
  const now = clock.now().toISOString();
  database.withAuthorityTransaction(({ notifications }) => {
    notifications.create(NotificationRecordSchema.parse({ notificationId: randomUUID(), actorId: "local-operator",
      dedupeFingerprint: "a".repeat(64), trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: CANARIES.notificationTitle,
      summary: CANARIES.notificationSummary, links: [{ kind: "storage", diagnosticFingerprint: "b".repeat(64) }], count: 1, version: 1, lastSeenAt: now, createdAt: now, updatedAt: now }));
    // A run-linked notification whose display context resolves the run's subject.
    notifications.create(NotificationRecordSchema.parse({ notificationId: randomUUID(), actorId: "local-operator",
      dedupeFingerprint: "c".repeat(64), trigger: "failed", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: CANARIES.notificationTitle,
      summary: CANARIES.notificationSummary, links: [{ kind: "run", runId: run.envelope.runId }], count: 1, version: 1, lastSeenAt: now, createdAt: now, updatedAt: now }));
  });
  const patch = { "actor.label": { set: CANARIES.setting } };
  const saved = executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), { apply: () => { throw new Error("ordinary settings use no credentials"); } } as never) }, {
    commandId: randomUUID(), family: "settings", type: "apply-settings", requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: readSettings(database.authority).revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  assert.equal(saved.state, "applied");
  const library = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock });
  const type = library.putType({ id: randomUUID(), name: CANARIES.typeName, keyFieldId: null, fields: [CANARIES.field], defaultWorkbookId: null, fieldLabels: { [CANARIES.field]: CANARIES.fieldLabel } });
  const created = library.create(EditableWorkbookSchema.parse({ name: CANARIES.workbook, themes: [], hasFormulas: false,
    sheets: [{ id: randomUUID(), name: CANARIES.worksheet, width: 1, hidden: [], headerRow: 1,
      rows: [{ id: randomUUID(), cells: [{ value: CANARIES.header }] }, { id: randomUUID(), cells: [{ value: CANARIES.cell }] }] }] }));
  const entry = library.catalog().find(candidate => candidate.libraryId === created.libraryId); assert.ok(entry);
  await library.libraryAction(created.libraryId, { operationId: randomUUID(), expectedRevision: entry.state.revision, expectedVersion: entry.version,
    change: { kind: "metadata", metadata: { typeId: z.object({ id: z.string() }).parse(type).id, sharePoint: null } } }, new AbortController().signal);
  const search = createCrossDateSearchService({ clock, sourceIdentity: database.getSourceDatabaseIdentity(), cursorSigningKey: new Uint8Array(32).fill(7),
    descriptors: { resolve: () => subjectDescriptor }, authority: { readSnapshot: read => database.withAuthorityReadSnapshot(() => read({
      authorityGeneration: database.getMeta().authorityGeneration, searchRuns: input => database.authority.runs.search(input) })) } });
  const runDetail = createRunDetailTestWorld().depsOf(w);
  const lifecycle = new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: () => undefined });
  const notifications = composeNotificationRoutes({ database, clock, lifecycle, descriptors: { resolve: () => subjectDescriptor }, runDetailDeps: runDetail, assertCurrent() {},
    notificationObserver: { status: () => { throw new Error("observer unused by the snapshot"); } } as never,
    notificationTarget: createNotificationTargetQuery({ get: database.authority.notifications.get, read: id => lifecycle.read(id), failure: database.authority.failures.get,
      command: commandId => database.authority.commands.readForNotice(commandId), bulk: () => undefined }) });
  const facts = assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => descriptor.id === "person-lookup"));
  const deps = createAssistantPluginDeps({ database, runs: lifecycle, runDetail, assertCurrent() {}, facts: () => facts,
    search: () => search, notifications: () => notifications, workbooks: () => library,
    attachment: (conversationId, id) => database.authority.assistantHistory.attachment(conversationId, id, clock.now().toISOString()) });
  return { w, run, deps, plugins: () => createAssistantPlugins(deps), facts, settings: () => readSettings(database.authority).settings,
    notificationSubjects: () => notifications.snapshot("local-operator").flatMap(row => row.kind === "notification" && row.context.state === "available" ? [row.context.subject] : []) };
}

it("keeps every seeded personal value out of the provider requests across all production read tools", async () => {
  const owners = await seededOwners();
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const bodies: string[] = [], outputs: unknown[] = [];
    let step = 0;
    const tokens: { person?: string; run?: string; sheet?: string } = {};
    f.setResponse(init => {
      if (typeof init.body !== "string") throw new Error("synthetic JSON request body required");
      bodies.push(init.body);
      const request = WireSchema.parse(JSON.parse(init.body)), last = request.input.at(-1);
      if (last !== undefined && "type" in last && last.type === "function_call_output") outputs.push(JSON.parse(last.output));
      if (step === 1) {
        const found = z.object({ runs: z.array(z.object({ run: z.string(), person: z.string().nullable() })).min(1) }).parse(outputs[0]).runs[0]; assert.ok(found);
        tokens.run = found.run; tokens.person = found.person ?? undefined;
      }
      if (step === 8) tokens.sheet = z.object({ sheets: z.array(z.object({ sheet: z.string() })).min(1) }).parse(outputs[6]).sheets[0]?.sheet;
      // Two turns, each within the 8-call limit: run and people reads, then the library reads.
      const calls: readonly (readonly [string, unknown] | null)[] = [["find_runs", { workflow: null, status: null, day: null, limit: 5 }], ["find_people", { query: tokens.person }],
        ["read_run", { run: tokens.run }], ["read_run_logs", { run: tokens.run, last: 5 }], ["list_notifications", { unreadOnly: false }], ["read_settings", { key: null }], null,
        ["read_spreadsheets", { view: "list", sheet: null, limit: 10 }], ["read_spreadsheets", { view: "open", sheet: tokens.sheet, limit: 10 }],
        ["read_spreadsheets", { view: "versions", sheet: tokens.sheet, limit: 10 }], ["read_spreadsheets", { view: "types", sheet: null, limit: 10 }], null];
      const next = calls[step++];
      const output = next === null || next === undefined ? [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: `Found ${String(tokens.person)} in ${String(tokens.run)}.` }] }]
        : [{ type: "function_call", namespace: "relay", name: next[0], call_id: `call_${String(step)}`, arguments: JSON.stringify(next[1]), status: "completed" }];
      return new Response(completedResponseStream(output, request.model, `resp_${String(step)}`), { headers: { "Content-Type": "text/event-stream" } });
    });
    const debug: unknown[] = [];
    const service = createAssistantService({ account: f.service, clock: f.clock, actorId: "local-operator", facts: () => owners.facts, plugins: owners.plugins,
      owner: () => ({ profileId: "11111111-1111-4111-8111-111111111111", epoch: 1 }), debugEvents: { emit: event => { debug.push(event); } },
      selectedModel: () => ({ preference: { slug: "gpt-6.1-sol", effort: "medium" }, assertCurrent: () => {} }), runReferenceLabel: (id, version) => owners.deps.runReferenceLabel(id, version), history: () => owners.w.database.authority.assistantHistory });
    const conversationId = randomUUID();
    assert.equal(service.history({ operation: "create", conversationId, title: "Chat" }).state, "saved");
    const envelope = await service.respond({ conversationId, expectedRevision: 1, messageId: randomUUID(), message: "Who ran recently, and what needs my attention?" }, new AbortController().signal);
    assert.equal(envelope.kind, "result"); if (envelope.kind !== "result") throw new Error("result required");
    const { result } = envelope;
    assert.equal(result.state, "answered", JSON.stringify(result)); if (result.state !== "answered") throw new Error("answer required");
    assert.match(result.text, new RegExp(`^Found ${CANARIES.subject} in Person Lookup run, \\d{4}-\\d{2}-\\d{2}\\.$`, "u"));
    assert.ok(envelope.receipt);
    const library = await service.respond({ conversationId, expectedRevision: envelope.receipt.revision, messageId: randomUUID(), message: "What is in the Spreadsheets library?" }, new AbortController().signal);
    assert.equal(library.kind === "result" ? library.result.state : library.kind, "answered");
    assert.equal(bodies.length, 12);
    for (const [index, body] of bodies.entries()) for (const [name, value] of Object.entries(CANARIES)) assert.equal(body.includes(value), false, `request ${String(index + 1)} carried ${name}`);
    for (const value of [owners.run.envelope.runId, owners.run.envelope.traceId]) assert.ok(bodies.every(body => !body.includes(value)));
    const [runs, people, read, logs, notifications, settings, sheets, opened, versions, types] = outputs;
    assert.equal(z.object({ runs: z.array(z.object({ person: z.string() })).length(1) }).parse(runs).runs.length, 1);
    assert.deepEqual(z.object({ people: z.array(z.object({ person: z.string() })) }).parse(people).people.map(entry => entry.person), [tokens.person]);
    assert.equal(z.object({ person: z.string(), workflow: z.literal("person-lookup") }).parse(read).person, tokens.person);
    z.object({ steps: z.array(z.unknown()) }).parse(logs);
    assert.deepEqual(z.object({ items: z.array(z.object({ trigger: z.string() })) }).parse(notifications).items.map(item => item.trigger).sort(), ["failed", "storage"]);
    const Library = { sheet: z.string(), type: z.string(), version: z.number(), sharePointLinked: z.boolean(), formulas: z.literal(false), unsupportedMetadata: z.literal(false) };
    assert.equal(z.strictObject({ view: z.literal("list"), sheets: z.array(z.strictObject({ ...Library, worksheets: z.literal(1), rows: z.literal(1) })), more: z.literal(false) }).parse(sheets).sheets.length, 1);
    assert.deepEqual(z.strictObject({ view: z.literal("open"), ...Library, worksheets: z.array(z.unknown()) }).parse(opened).worksheets, [{ position: 1, rows: 1, columns: 1, hiddenColumns: 0 }]);
    assert.equal(z.object({ versions: z.array(z.object({ version: z.string().regex(/^\[\[V1\.g\d+\]\]$/u), inUse: z.literal(true) })).length(1) }).parse(versions).versions.length, 1);
    assert.ok(z.object({ types: z.array(z.object({ type: z.string(), workbooks: z.number() })) }).parse(types).types.some(entry => entry.workbooks === 1));
    const served = z.object({ settings: z.array(z.object({ key: z.string(), value: z.unknown() })) }).parse(settings).settings;
    for (const entry of served) assert.ok(typeof entry.value === "boolean" || typeof entry.value === "number" || entry.value === "set" || entry.value === "unset", entry.key);
    assert.deepEqual(served.find(entry => entry.key === "actor.label"), { key: "actor.label", value: "set" });
    assert.equal(z.object({ actor: z.object({ label: z.string() }) }).parse(owners.settings()).actor.label, CANARIES.setting);
    assert.ok(owners.notificationSubjects().includes(CANARIES.subject), "the run-linked notification resolves the subject locally");
    assert.ok(Object.values(CANARIES).every(value => !JSON.stringify(debug).includes(value)));
  } finally { await f.cleanup(); }
});

function queuedLookup(eid: string, at = "2026-11-08T12:00:00.000Z", shape: RunRecord["envelope"]["shape"] = "single"): RunRecord {
  const base = RunRecordSchema.parse(personLookupQueuedRun({ runId: randomUUID(), itemId: randomUUID() }));
  return RunRecordSchema.parse({ ...base, createdAt: at, updatedAt: at, envelope: { ...base.envelope, shape, enqueuedAt: at }, input: { ...base.input,
    parsed: { schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"), protectedBindings: [],
      value: { mode: "search", emplId: eid, crmCheck: true, keepNonHdh: false, includeCrmDates: false } } } });
}
async function lookupOwners(replace?: (runs: RunRecordService) => Pick<RunRecordService, "list" | "read">) {
  const w = await makeWorld(); worlds.push(w);
  const runs = new RunRecordService({ database: w.database, clock: w.clock, ids: { uuid: randomUUID }, publishQueued() {} });
  const unused = () => { throw new Error("not used by canonical Lookup identity reads"); };
  const deps = createAssistantPluginDeps({ database: w.database, runs: replace?.(runs) ?? runs, runDetail: createRunDetailTestWorld().depsOf(w),
    assertCurrent() {}, facts: () => assistantWorkflowFacts(DESCRIPTORS.filter(row => row.id === "person-lookup")), search: unused,
    notifications: unused, workbooks: unused, attachment: unused });
  return { w, runs, deps };
}
const readRefused = (code: string) => (error: unknown) => error instanceof AssistantToolRefusal && error.code === code;

it("finds three exact canonical EIDs in shuffled queued single/member rows without a name checkpoint", async () => {
  const o = await lookupOwners(), eids = ["10000002", "10812345", "10000001"];
  const firstEid = eids[0]; assert.ok(firstEid);
  const parent = queuedLookup(firstEid, undefined, "operation");
  const rows = eids.map((eid, index) => queuedLookup(eid, `2026-11-08T12:00:0${index}.000Z`, index === 1 ? "operation-member" : "single"));
  const member = rows[1]; assert.ok(member);
  rows[1] = RunRecordSchema.parse({ ...member, envelope: { ...member.envelope, parent: { runId: parent.envelope.runId,
    tracePrefix: parent.envelope.traceId, edgeId: "lookup-members" } } });
  for (const row of [parent, rows[2], rows[0], rows[1]]) { assert.ok(row); assert.equal(o.w.database.authority.runs.enqueue(row).state, "inserted"); }
  for (const index of [2, 0, 1]) {
    const eid = eids[index], expected = rows[index]; assert.ok(eid && expected);
    const found = o.deps.findLookupRuns(eid);
    assert.deepEqual(found.map(row => [row.runId, row.version]), [[expected.envelope.runId, expected.version]]);
    assert.ok(found[0]?.label.includes(`EID ${eid}`));
    assert.equal(o.w.database.authority.runCheckpoints.listByItem(expected.envelope.workflow, expected.envelope.itemId).length, 0);
  }
  assert.deepEqual(o.deps.findLookupRuns(EXECUTOR_EID), []);
  const selected = rows[0]; assert.ok(selected);
  assert.ok(o.deps.runReferenceLabel(selected.envelope.runId, selected.version).includes(`EID ${eids[0]}`));
  assert.throws(() => o.deps.runReferenceLabel(selected.envelope.runId, selected.version + 1), readRefused("ASSISTANT_READ_STALE"));
});

it("scans past the ascending first page and sorts genuine duplicate candidates newest first", async () => {
  const old = queuedLookup("10000001", "2026-11-07T12:00:00.000Z"), latest = queuedLookup("10000001");
  const parent = queuedLookup("10000001", undefined, "operation"), requests: unknown[] = [];
  const o = await lookupOwners(runs => ({ read: id => runs.read(id), list(request) {
    requests.push(request);
    return request.cursor === undefined ? { state: "listed", rows: [...Array.from({ length: 999 }, () => parent), old],
      cursor: CanonicalListRunsRequestSchema.shape.cursor.unwrap().parse({ generation: 1, offset: 1000, disposition: "live", workflow: "person-lookup" }) }
      : { state: "listed", rows: [latest] };
  } }));
  assert.deepEqual(o.deps.findLookupRuns("10000001").map(row => row.runId), [latest.envelope.runId, old.envelope.runId]);
  assert.deepEqual(requests, [{ workflow: "person-lookup", disposition: "live", limit: 1000 },
    { workflow: "person-lookup", disposition: "live", limit: 1000, cursor: { generation: 1, offset: 1000, disposition: "live", workflow: "person-lookup" } }]);
});

it("refuses incomplete capped or stale page scans rather than claiming an EID was not found", async () => {
  const parent = queuedLookup("10000001", undefined, "operation");
  for (const mode of ["cap", "stale"] as const) {
    const o = await lookupOwners(runs => ({ read: id => runs.read(id), list(request) {
      if (mode === "stale" && request.cursor !== undefined) return { state: "refused", refusal: { reason: "cursor-stale" } };
      return { state: "listed", rows: Array.from({ length: 1000 }, () => parent), cursor: CanonicalListRunsRequestSchema.shape.cursor.unwrap().parse({ generation: 1,
        offset: (request.cursor?.offset ?? 0) + 1000, disposition: "live", workflow: "person-lookup" }) };
    } }));
    assert.throws(() => o.deps.findLookupRuns("10000002"), readRefused(mode === "cap" ? "ASSISTANT_LIMIT" : "ASSISTANT_READ_STALE"));
  }
});

it("refuses wrong canonical schema bindings and malformed values without matching raw ingress", async () => {
  const base = queuedLookup("10000001");
  for (const parsed of [{ ...base.input.parsed, schemaHash: "a".repeat(64) },
    { ...base.input.parsed, value: { mode: "search", emplId: "10000001" } }]) {
    const row = RunRecordSchema.parse({ ...base, input: { ...base.input, parsed } });
    const o = await lookupOwners(() => ({ read: () => ({ state: "present", run: row, disposition: "live" }), list: () => ({ state: "listed", rows: [row] }) }));
    assert.throws(() => o.deps.findLookupRuns("10000001"), readRefused("ASSISTANT_READ_UNAVAILABLE"));
    assert.throws(() => o.deps.runReferenceLabel(row.envelope.runId, row.version), readRefused("ASSISTANT_READ_UNAVAILABLE"));
  }
});

it("withholds protected Lookup identities before extracting them and keeps the selected label protected-safe", async () => {
  const base = queuedLookup("10000001");
  const row = RunRecordSchema.parse({ ...base, input: { ...base.input, parsed: { ...base.input.parsed, schemaHash: "a".repeat(64),
    protectedBindings: [{ kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: randomUUID() }] } } });
  const o = await lookupOwners(() => ({ read: () => ({ state: "present", run: row, disposition: "live" }), list: () => ({ state: "listed", rows: [row] }) }));
  assert.deepEqual(o.deps.findLookupRuns("10000001"), []);
  assert.equal(o.deps.runReferenceLabel(row.envelope.runId, row.version), "Protected test subject");
  const tool = createAssistantPlugins(o.deps).flatMap(plugin => plugin.tools).find(tool => tool.name === "find_people"); assert.ok(tool?.kind === "read");
  const references = createAssistantReferenceTable(1);
  const output = await tool.invoke({ query: references.issue("E", "10000001", "10000001") }, { references, signal: new AbortController().signal,
    actorId: "local-operator", conversationId: randomUUID(), operatorText: "", assertCurrent() {}, assertRetainedCurrent() {} });
  assert.deepEqual(output, { people: [], more: false });

});

it("keeps queued exact-EID relationships token-only in provider requests, including a selected member", async () => {
  const o = await lookupOwners(), eids = ["10000002", "10812345", "10000001"], rows = eids.map(eid => queuedLookup(eid));
  for (const row of rows) o.w.database.authority.runs.enqueue(row);
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const bodies: string[] = [], results: string[] = []; let step = 0;
    f.setResponse(init => {
      assert.ok(typeof init.body === "string"); const body = init.body; bodies.push(body);
      const request = WireSchema.parse(JSON.parse(body)), last = request.input.at(-1);
      if (last !== undefined && "type" in last && last.type === "function_call_output") {
        const result = z.object({ people: z.array(z.object({ runs: z.array(z.object({ run: z.string() })).length(1) })).length(1) }).parse(JSON.parse(last.output));
        const run = result.people[0]?.runs[0]; assert.ok(run); results.push(run.run);
      }
      const token = body.match(/\[\[E[1-3]\.g[0-9]+\]\]/gu)?.[step++];
      const output = step <= 3 ? [{ type: "function_call", namespace: "relay", name: "find_people", call_id: `find_${step}`,
        arguments: JSON.stringify({ query: token }), status: "completed" }] : [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: results.join("; ") }] }];
      return new Response(completedResponseStream(output, request.model, `resp_${step}`), { headers: { "Content-Type": "text/event-stream" } });
    });
    const service = createAssistantService({ account: f.service, clock: f.clock, actorId: "local-operator", facts: () => o.deps.facts(),
      plugins: () => createAssistantPlugins(o.deps), runReferenceLabel: (id, version) => o.deps.runReferenceLabel(id, version),
      owner: () => ({ profileId: "11111111-1111-4111-8111-111111111111", epoch: 1 }), selectedModel: () => ({
        preference: { slug: "gpt-6.1-sol", effort: "medium" }, assertCurrent() {} }), history: () => o.w.database.authority.assistantHistory });
    const conversationId = randomUUID(), selected = rows[0]; assert.ok(selected);
    service.history({ operation: "create", conversationId, title: "Lookup" });
    const response = await service.respond({ conversationId, expectedRevision: 1, messageId: randomUUID(), message: `Find ${eids.join(", ")}`,
      subjectRef: `run_${selected.envelope.runId}_${selected.version}` }, new AbortController().signal);
    assert.ok(response.kind === "result" && response.result.state === "answered");
    for (const eid of eids) { assert.ok(response.result.text.includes(`EID ${eid}`)); assert.equal(bodies.join().includes(eid), false); }
    assert.equal(new Set(results).size, 3);
    for (const row of rows) assert.equal(bodies.join().includes(row.envelope.runId), false);
  } finally { await f.cleanup(); }
});

it("does not infer EIDs from names, match inputs, preview rows or raw ingress", async () => {
  const base = queuedLookup("10000001");
  const values = [{ mode: "search", name: "Synthetic Person", crmCheck: true, keepNonHdh: false, includeCrmDates: false },
    { mode: "match", firstName: "Synthetic", lastName: "Person", dob: "01/15/2000", crmCheck: false, includeCrmDates: false }];
  const rows = values.map(value => RunRecordSchema.parse({ ...base, input: { ...base.input, parsed: { ...base.input.parsed, value } } }));
  const preview = queuedLookup("10000001", undefined, "preview");
  const first = rows[0]; assert.ok(first);
  const o = await lookupOwners(() => ({ read: () => ({ state: "present", run: first, disposition: "live" }),
    list: () => ({ state: "listed", rows: [...rows, preview] }) }));
  assert.deepEqual(o.deps.findLookupRuns(EXECUTOR_EID), []);
  assert.deepEqual(o.deps.findLookupRuns("10000001"), []);
  const label = o.deps.runReferenceLabel(base.envelope.runId, base.version);
  assert.equal(label.includes("Synthetic Person"), false); assert.equal(label.includes("EID"), false);
});

it("uses the retained operator run number in local labels without a separate numbering read", async () => {
  const row = RunRecordSchema.parse({ ...queuedLookup("10000001"), runNumber: 47 });
  const o = await lookupOwners(() => ({ read: () => ({ state: "present", run: row, disposition: "live" }), list: () => ({ state: "listed", rows: [row] }) }));
  assert.ok(o.deps.runReferenceLabel(row.envelope.runId, row.version).startsWith("Person Lookup #47 · EID 10000001"));
  assert.equal(o.deps.findLookupRuns("10000001")[0]?.label, o.deps.runReferenceLabel(row.envelope.runId, row.version));
});
