import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
import { z } from "zod";
import { createAssistantService } from "../../../../src/backend/assistant/service.js";
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
  const notifications = composeNotificationRoutes({ database, clock, lifecycle, descriptors: { resolve: () => subjectDescriptor as never }, runDetailDeps: runDetail, assertCurrent() {},
    notificationObserver: { status: () => { throw new Error("observer unused by the snapshot"); } } as never,
    notificationTarget: createNotificationTargetQuery({ get: database.authority.notifications.get, read: id => lifecycle.read(id), failure: database.authority.failures.get }) });
  const facts = assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => descriptor.id === "person-lookup"));
  return { w, run, plugins: () => createAssistantPlugins(createAssistantPluginDeps({ database, runDetail, assertCurrent() {}, facts: () => facts,
    search: () => search, notifications: () => notifications, workbooks: () => library })), facts, settings: () => readSettings(database.authority).settings,
    notificationSubjects: () => notifications.snapshot("local-operator").flatMap(row => row.kind === "notification" && row.context.state === "available" ? [row.context.subject] : []) };
}

it("keeps every seeded personal value out of the provider requests across all production read tools", async () => {
  const owners = await seededOwners();
  const f = await chatGptFixture(undefined, profiles.create);
  try {
    await f.connected();
    const bodies: string[] = [], outputs: unknown[] = [];
    let step = 0;
    const tokens: { person?: string; run?: string } = {};
    f.setResponse(init => {
      if (typeof init.body !== "string") throw new Error("synthetic JSON request body required");
      bodies.push(init.body);
      const request = WireSchema.parse(JSON.parse(init.body)), last = request.input.at(-1);
      if (last !== undefined && "type" in last && last.type === "function_call_output") outputs.push(JSON.parse(last.output));
      if (step === 1) {
        const found = z.object({ runs: z.array(z.object({ run: z.string(), person: z.string().nullable() })).min(1) }).parse(outputs[0]).runs[0]; assert.ok(found);
        tokens.run = found.run; tokens.person = found.person ?? undefined;
      }
      const calls: readonly (readonly [string, unknown])[] = [["find_runs", { workflow: null, status: null, day: null, limit: 5 }], ["find_people", { query: tokens.person }],
        ["read_run", { run: tokens.run }], ["read_run_logs", { run: tokens.run, last: 5 }], ["list_notifications", { unreadOnly: false }],
        ["list_spreadsheets", { limit: 10 }], ["read_settings", { key: null }]];
      const next = calls[step++];
      const output = next === undefined ? [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: `Found ${String(tokens.person)} in ${String(tokens.run)}.` }] }]
        : [{ type: "function_call", namespace: "relay", name: next[0], call_id: `call_${String(step)}`, arguments: JSON.stringify(next[1]), status: "completed" }];
      return new Response(completedResponseStream(output, request.model, `resp_${String(step)}`), { headers: { "Content-Type": "text/event-stream" } });
    });
    const debug: unknown[] = [];
    const service = createAssistantService({ account: f.service, clock: f.clock, actorId: "local-operator", facts: () => owners.facts, plugins: owners.plugins,
      owner: () => ({ profileId: "11111111-1111-4111-8111-111111111111", epoch: 1 }), debugEvents: { emit: event => { debug.push(event); } },
      modelPolicy: () => ({ policy: { model: "gpt-6.1-sol", eligible: true, consented: true, billing: "chatgpt-plan", verifiedUntil: "2026-10-13T00:00:00Z" }, isCurrent: () => true }), history: () => owners.w.database.authority.assistantHistory });
    const conversationId = randomUUID();
    assert.equal(service.history({ operation: "create", conversationId, title: "Chat" }).state, "saved");
    const envelope = await service.respond({ conversationId, expectedRevision: 1, messageId: randomUUID(), message: "Who ran recently, and what needs my attention?" }, new AbortController().signal);
    assert.equal(envelope.kind, "result"); if (envelope.kind !== "result") throw new Error("result required");
    const { result } = envelope;
    assert.equal(result.state, "answered"); if (result.state !== "answered") throw new Error("answer required");
    assert.match(result.text, new RegExp(`^Found ${CANARIES.subject} in Person Lookup run, \\d{4}-\\d{2}-\\d{2}\\.$`, "u"));
    assert.equal(bodies.length, 8);
    for (const [index, body] of bodies.entries()) for (const [name, value] of Object.entries(CANARIES)) assert.equal(body.includes(value), false, `request ${String(index + 1)} carried ${name}`);
    for (const value of [owners.run.envelope.runId, owners.run.envelope.traceId]) assert.ok(bodies.every(body => !body.includes(value)));
    const [runs, people, read, logs, notifications, sheets, settings] = outputs;
    assert.equal(z.object({ runs: z.array(z.object({ person: z.string() })).length(1) }).parse(runs).runs.length, 1);
    assert.deepEqual(z.object({ people: z.array(z.object({ person: z.string() })) }).parse(people).people.map(entry => entry.person), [tokens.person]);
    assert.equal(z.object({ person: z.string(), workflow: z.literal("person-lookup") }).parse(read).person, tokens.person);
    z.object({ steps: z.array(z.unknown()) }).parse(logs);
    assert.deepEqual(z.object({ items: z.array(z.object({ trigger: z.string() })) }).parse(notifications).items.map(item => item.trigger).sort(), ["failed", "storage"]);
    assert.deepEqual(z.strictObject({ sheets: z.array(z.strictObject({ sheet: z.string(), version: z.number(), worksheets: z.literal(1), rows: z.literal(1) })), more: z.literal(false) }).parse(sheets).sheets.length, 1);
    const served = z.object({ settings: z.array(z.object({ key: z.string(), value: z.unknown() })) }).parse(settings).settings;
    for (const entry of served) assert.ok(typeof entry.value === "boolean" || typeof entry.value === "number" || entry.value === "set" || entry.value === "unset", entry.key);
    assert.deepEqual(served.find(entry => entry.key === "actor.label"), { key: "actor.label", value: "set" });
    assert.equal(z.object({ actor: z.object({ label: z.string() }) }).parse(owners.settings()).actor.label, CANARIES.setting);
    assert.ok(owners.notificationSubjects().includes(CANARIES.subject), "the run-linked notification resolves the subject locally");
    assert.ok(Object.values(CANARIES).every(value => !JSON.stringify(debug).includes(value)));
  } finally { await f.cleanup(); }
});
