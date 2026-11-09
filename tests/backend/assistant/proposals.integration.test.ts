import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it, vi } from "vitest";
import { createAssistantAuthorization } from "../../../src/backend/assistant/authorization.js";
import { createAssistantProposals, plannedRowDisplay } from "../../../src/backend/assistant/proposals.js";
import { AssistantToolRefusal } from "../../../src/backend/assistant/plugins/plugin.js";
import { createAssistantReferenceTable } from "../../../src/backend/assistant/references.js";
import { composeDataQueries } from "../../../src/backend/app/composition/dashboard/data.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { createCommandKernel, executeSettingsCommand } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { ASSISTANT_MESSAGES_MAX, AssistantActionDecisionSchema, type AssistantActionProposal } from "../../../src/models/dashboard/assistant.js";
import { NotificationRecordSchema } from "../../../src/models/notifications/notifications.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint, deriveSettingsPatchFingerprint } from "../../../src/models/config/settings.js";
import { parseInputRunText, toRawSubmission } from "../../../src/models/workflow/ingress.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { WriteIntentRecordSchema } from "../../../src/rules/write-safety/write-safety.js";
import { workflowPlanning } from "../../../src/workflow-kit/workflow.js";
import { assistantProposalDigest } from "../../../src/dashboard/surfaces/assistant/assistant-controller-model.js";
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { makeWorld } from "../../support/helpers/backend/dashboard-harness.js";
import { rerunValuesHarness } from "../../support/fixtures/rerun-values-fixtures.js";
import { launchHarness } from "../../support/fixtures/run-launch-fixtures.js";
import { absentProbeEvidence } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { createWorkbookLibraryService, type WorkbookSyncDownload } from "../../../src/backend/workbooks/workbook-library-service.js";
import { EditableWorkbookSchema } from "../../../src/models/dashboard/workbooks.js";
import type { AssistantAttachmentRecord } from "../../../src/models/dashboard/assistant.js";
import { createHash } from "node:crypto";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

type Harness = Awaited<ReturnType<typeof rerunValuesHarness>>;
type SubmitMode = "direct" | "hold-before" | "lost-after" | "hold-after";

/** The real proposal owner over a real executing harness: canonical planner, kernel, rerun values and assistant authorization. */
async function owners(source: (profileFixture: typeof profiles.create) => Promise<Harness> = rerunValuesHarness, attempting = false) {
  const h = await source(profiles.create), w = await makeWorld({ profileFixture: profiles.create });
  cleanups.push(() => h.dispose(), () => w.dispose());
  const { database, clock } = h, profileId = h.profile.admission.profileBinding.profileId;
  const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), { apply: () => { throw new Error("ordinary settings use no credentials"); } } as never);
  const executeSettings = (patch: Record<string, unknown>, assistantPermission?: { expectedPolicyRevision: number; mode: "every-action" }) => executeSettingsCommand(
    { authority: database, clock, ids: { uuid: randomUUID }, settings, authorityProfileId: profileId }, CommandRequestSchema.parse({ commandId: randomUUID(),
      requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
      target: { expectedRevision: readSettings(database.authority).revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: assistantPermission === undefined ? deriveSettingsPatchFingerprint(patch) : deriveRawSettingsPatchFingerprint({}), patch, ...(assistantPermission === undefined ? {} : { assistantPermission }) } }));
  assert.equal(executeSettings({}, { expectedPolicyRevision: 0, mode: "every-action" }).state, "applied");
  const unused = () => { throw new Error("unrequested runtime operation"); };
  const owner: { authorization?: ReturnType<typeof createAssistantAuthorization> } = {};
  let factsSha = "a".repeat(64);
  const kernel = createCommandKernel({ lifecycle: h.lifecycle, appVersion: "0.1.0", authority: database, clock, ids: { uuid: randomUUID }, descriptors: { resolve: () => h.descriptor },
    configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: { recheck: unused, resolveAbsent: unused },
    workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } },
    assistantFactsSha256: () => factsSha, workflowSources: { [h.descriptor.id]: "served" },
    assistantRevalidate: command => { if (database.authority.assistantAuthorization.actionByCommand(command.commandId) !== undefined) owner.authorization?.assertEffect(command.commandId, command); } });
  const authorization = owner.authorization = createAssistantAuthorization({ database, kernel, clock, current: () => ({ profileId, epoch: 1 }) });
  const attemptingIntent = (runId: string, itemId: string, runAttempt: number) => WriteIntentRecordSchema.parse({ ...WRITE_INTENT_ATTEMPTING, workflowId: h.descriptor.id, itemId, runId, runAttempt });
  let attemptingFor: ReturnType<typeof attemptingIntent> | undefined;
  const canonicalDatabase = !attempting ? database : { withAuthorityReadSnapshot: database.withAuthorityReadSnapshot.bind(database),
    authority: { ...database.authority, writeIntents: { ...database.authority.writeIntents, listAttemptingByItem: () => attemptingFor === undefined ? [] : [attemptingFor] } } };
  const data = composeDataQueries({ stateRoot: w.stateRoot, timeline: w.timeline, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined },
    runReader: h.lifecycle, canonical: { reader: h.lifecycle, database: canonicalDatabase, descriptors: { resolve: () => h.descriptor } } });
  let mode: SubmitMode = "direct", entered = false, release: () => void = () => {};
  const gate = () => new Promise<void>(resolve => { release = resolve; });
  cleanups.push(() => { release(); });
  const sync: { download: WorkbookSyncDownload["withDownload"] } = { download: () => Promise.reject(new Error("no SharePoint download in this test")) };
  const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: { withDownload: (command, use) => sync.download(command, use) } });
  const workbookOwner: { library: Parameters<typeof createAssistantProposals>[0] extends { workbooks(): infer L } ? L : never } = { library };
  const files = new Map<string, AssistantAttachmentRecord & Readonly<{ bytes: Uint8Array }>>();
  const proposals = createAssistantProposals({ database, authorization, kernel, ocrSources: () => { throw new Error("no OCR source in this harness"); }, workbooks: () => workbookOwner.library,
    attachment: (conversation, id) => { const file = files.get(id); return file?.conversationId === conversation ? file : undefined; }, plans: h.planner, runs: h.lifecycle, descriptors: { resolve: () => h.descriptor },
    rerunValues: request => data.rerunValues(request), served: () => true, actorId: "local-operator", clock, assertCurrent() {},
    commands: { publish() {}, async submit(command) {
      entered = true;
      if (mode === "hold-before") await gate();
      const result = kernel.execute(command);
      if (mode === "hold-after") await gate();
      if (mode === "lost-after") throw new Error("synthetic lost response after execution");
      return result;
    } } });
  let modelCurrent = true;
  const references = createAssistantReferenceTable(1), conversationId = randomUUID();
  assert.equal(database.authority.assistantHistory.apply({ operation: "create", conversationId, title: "Chat" }, clock.now().toISOString()).state, "saved");
  /** The decision captions stored in the card's conversation. */
  const captions = () => (database.authority.assistantHistory.conversation(conversationId, clock.now().toISOString())?.messages ?? [])
    .filter(row => row.kind === "decision").map(row => row.text);
  const context = { signal: new AbortController().signal, references, actorId: "local-operator", conversationId, operatorText: "", assertCurrent() {},
    assertRetainedCurrent() { if (!modelCurrent) throw new Error("model verification expired"); } };
  const tool = (name: string) => { const found = proposals.plugin.tools.find(candidate => candidate.name === name); assert.ok(found?.kind === "proposal"); return found; };
  const decide = async (proposal: AssistantActionProposal, decision: "confirm" | "cancel", signal = new AbortController().signal, digest?: string) =>
    proposals.decideAction(AssistantActionDecisionSchema.parse({ chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision, decision,
      ...(decision === "confirm" ? { reviewedDigest: digest ?? await assistantProposalDigest(proposal) } : {}) }), signal);
  const done = async (eid?: string) => { const queued = h.start(h.proposal(undefined, undefined, false, eid)); assert.equal((await h.execute(queued)).state, "done"); return h.fresh(queued); };
  const runCount = () => database.authority.runs.listByWorkflow(h.descriptor.id).length;
  const commandOf = (card: AssistantActionProposal) => database.authority.assistantAuthorization.action(card.actionId)?.command;
  /** Stages one accepted attachment of this chat and returns its `A` reference. */
  const attach = (name: string, mediaType: AssistantAttachmentRecord["mediaType"], text: string) => {
    const bytes = new TextEncoder().encode(text), id = randomUUID(), now = clock.now().toISOString();
    files.set(id, { id, conversationId, messageId: randomUUID(), ordinal: 1, mediaType, name, byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"), createdAt: now, expiresAt: new Date(clock.nowMs() + 86_400_000).toISOString(), bytes });
    return references.issue("A", id, name);
  };
  const replaceAttachment = (token: string) => { const id = references.resolve(token, ["A"]).target, file = files.get(id); assert.ok(file); files.set(id, { ...file, sha256: "0".repeat(64) }); };
  return { h, database, clock, kernel, proposals, library, sync, workbookOwner, attach, replaceAttachment, tool, decide, done, runCount, commandOf, references, context, captions, executeSettings,
    submitMode(next: SubmitMode) { mode = next; entered = false; }, entered: () => entered, release: () => { release(); },
    expireModel() { modelCurrent = false; }, changeManifest() { factsSha = "b".repeat(64); },
    markAttempting(runId: string, itemId: string, runAttempt: number) { attemptingFor = attemptingIntent(runId, itemId, runAttempt); } };
}
type Owners = Awaited<ReturnType<typeof owners>>;
const rerunCard = async (o: Owners, sourceRun: Awaited<ReturnType<Owners["done"]>>) =>
  o.tool("propose_rerun").propose({ run: o.references.issue("R", sourceRun.envelope.runId, "run", sourceRun.envelope.runId) }, o.context);
const refusedWith = (code: string) => (error: unknown) => error instanceof AssistantToolRefusal && error.code === code;

it("issues and confirms an eligible rerun once and refuses its replay", async () => {
  const o = await owners(), source = await o.done(), before = o.runCount();
  const card = await o.tool("propose_rerun").propose({ run: o.references.issue("R", source.envelope.runId, "run", source.envelope.runId, source.version) }, o.context);
  assert.ok(card.effect === "workflow-start" && card.source === "rerun" && card.startPlan.planned.length === 1);
  assert.equal(o.runCount(), before, "no dispatch without Confirm");
  assert.deepEqual(await o.decide(card, "confirm"), { state: "applied", actionId: card.actionId });
  assert.equal(o.runCount(), before + 1);
  assert.equal(o.database.authority.commandAudits.findByCommand(o.commandOf(card)?.commandId ?? "")?.result.state, "applied");
  await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u);
  assert.equal(o.runCount(), before + 1);
  assert.deepEqual(o.captions(), [`Done: ${card.label}.`], "one caption; a refused replay adds none");
});

it("keeps a Confirm whose caption cannot be stored in a full chat UNKNOWN after its single effect", async () => {
  const o = await owners(), source = await o.done(), before = o.runCount(), history = o.database.authority.assistantHistory, now = () => o.clock.now().toISOString();
  for (let index = 0; index < ASSISTANT_MESSAGES_MAX; index++) {
    const revision = history.conversation(o.context.conversationId, now())?.revision; assert.ok(revision !== undefined);
    assert.equal(history.apply({ operation: "local", conversationId: o.context.conversationId, expectedRevision: revision, messageId: randomUUID(), text: `Local ${String(index)}` }, now()).state, "saved");
  }
  const card = await rerunCard(o, source);
  assert.deepEqual(await o.decide(card, "confirm"), { state: "unknown", actionId: card.actionId });
  assert.equal(o.runCount(), before + 1, "the claimed effect ran once");
  assert.deepEqual(o.captions(), [], "the full chat refused the caption instead of storing a silent success");
  await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u);
  assert.equal(o.runCount(), before + 1);
});

it("applies a notification change at once without a card, and refuses with nothing changed when there is nothing to change", async () => {
  const o = await owners(), now = () => o.clock.now().toISOString(), notificationId = randomUUID();
  const change = o.proposals.plugin.tools.find(tool => tool.name === "change_notifications"); assert.ok(change?.kind === "change");
  await assert.rejects(change.invoke({ action: "read", target: "all" }, o.context), refusedWith("ASSISTANT_PROPOSAL_REFUSED"));
  o.database.withAuthorityTransaction(({ notifications }) => notifications.create(NotificationRecordSchema.parse({ notificationId, actorId: "local-operator",
    dedupeFingerprint: "d".repeat(64), trigger: "storage", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Local title", summary: "Local summary",
    links: [{ kind: "storage", diagnosticFingerprint: "e".repeat(64) }], count: 1, version: 1, lastSeenAt: now(), createdAt: now(), updatedAt: now() })));
  assert.deepEqual(await change.invoke({ action: "read", target: "all" }, o.context), { state: "applied", count: 1 });
  assert.equal(o.database.authority.notifications.get(notificationId)?.status, "read");
  assert.deepEqual(o.captions(), [], "no card, so no decision caption");
  await assert.rejects(change.invoke({ action: "read", target: "all" }, o.context), refusedWith("ASSISTANT_PROPOSAL_REFUSED"), "already read: nothing to change");
});

it("refuses reruns of cancelled, moved, parked and attempting sources through the proposal owner", async () => {
  const cancelledOwner = await owners(), queued = cancelledOwner.h.start(cancelledOwner.h.proposal());
  assert.equal(cancelledOwner.h.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: cancelledOwner.clock.now().toISOString(), requestedBy: "local-operator",
    source: "queue-row", family: "run", type: "cancel", target: { runId: queued.envelope.runId, expectedVersion: queued.version } })).state, "applied");
  await assert.rejects(rerunCard(cancelledOwner, cancelledOwner.h.fresh(queued)), refusedWith("ASSISTANT_PROPOSAL_REFUSED"));

  const movedOwner = await owners(), moved = await movedOwner.done();
  await assert.rejects(movedOwner.tool("propose_rerun").propose({ run: movedOwner.references.issue("R", moved.envelope.runId, "the selected run", moved.envelope.runId, moved.version + 1) },
    movedOwner.context), refusedWith("ASSISTANT_READ_STALE"));

  const parkedOwner = await owners(profileFixture => launchHarness("reject-active", undefined, undefined, profileFixture));
  parkedOwner.h.world.probeResults.push(absentProbeEvidence(parkedOwner.clock.now().toISOString()));
  parkedOwner.h.world.commitThrows = new Error("synthetic lost submit outcome");
  const parkedRun = parkedOwner.h.start(parkedOwner.h.proposal());
  assert.equal((await parkedOwner.h.execute(parkedRun)).state, "parked-write");
  await assert.rejects(rerunCard(parkedOwner, parkedOwner.h.fresh(parkedRun)), refusedWith("ASSISTANT_PROPOSAL_REFUSED"));

  const attemptingOwner = await owners(rerunValuesHarness, true), eligible = await attemptingOwner.done();
  attemptingOwner.markAttempting(eligible.envelope.runId, eligible.envelope.itemId, eligible.envelope.attempt);
  await assert.rejects(rerunCard(attemptingOwner, eligible), refusedWith("ASSISTANT_PROPOSAL_REFUSED"));
});

it("binds Confirm to the exact rendered multi-row card and lets one of a concurrent Confirm and Cancel win", async () => {
  const o = await owners(), first = await o.done("10812345"), second = await o.done("10812346");
  const card = await o.tool("propose_workflow_start").propose({ workflow: o.h.descriptor.id, entries: [
    o.references.issue("R", first.envelope.runId, "run", first.envelope.runId), o.references.issue("R", second.envelope.runId, "run", second.envelope.runId)] }, o.context);
  assert.ok(card.effect === "workflow-start" && card.source === "entries");
  const [rowA, rowB] = card.startPlan.planned; assert.ok(rowA && rowB);
  const before = o.runCount();
  for (const changed of [{ ...card, startPlan: { ...card.startPlan, planned: [rowA] } }, { ...card, startPlan: { ...card.startPlan, planned: [rowB, rowA] } },
    { ...card, startPlan: { ...card.startPlan, planned: [{ ...rowA, title: `${rowA.title}́` }, rowB] } }, { ...card, targetLabel: `${card.targetLabel} ` }, { ...card, label: "Start Ｗorkflow" }]) {
    await assert.rejects(o.decide(card, "confirm", undefined, await assistantProposalDigest(changed)), /assistant-reviewed-proposal-mismatch/u);
  }
  assert.equal(o.runCount(), before);
  const outcomes = await Promise.allSettled([o.decide(card, "confirm"), o.decide(card, "cancel")]);
  const settled = outcomes.flatMap(outcome => outcome.status === "fulfilled" ? [outcome.value.state] : []);
  assert.equal(settled.length, 1, JSON.stringify(outcomes));
  assert.equal(o.runCount(), before + (settled[0] === "applied" ? 2 : 0));
  assert.deepEqual(o.captions(), [settled[0] === "applied" ? `Done: ${card.label}.` : `Not done: ${card.label}.`]);
});

it("refuses every held-start invalidation after the claim with UNKNOWN, zero stale effects and no retry", async () => {
  for (const change of ["abort", "settings", "grant", "manifest", "model", "plan"] as const) {
    const o = await owners(), card = await rerunCard(o, await o.done()), command = o.commandOf(card), controller = new AbortController();
    assert.ok(command?.family === "start");
    o.submitMode("hold-before");
    const confirming = o.decide(card, "confirm", controller.signal);
    await vi.waitFor(() => { assert.ok(o.entered()); assert.equal(o.database.authority.assistantAuthorization.action(card.actionId)?.state, "claimed"); }, { timeout: 5_000, interval: 10 });
    const before = o.runCount();
    if (change === "abort") controller.abort();
    if (change === "settings") assert.equal(o.executeSettings({ "browser.headless": { set: false } }).state, "applied");
    if (change === "grant") assert.equal(o.executeSettings({}, { expectedPolicyRevision: 1, mode: "every-action" }).state, "applied");
    if (change === "manifest") o.changeManifest();
    if (change === "model") o.expireModel();
    if (change === "plan") assert.equal(o.kernel.execute({ ...command, commandId: randomUUID(), source: "run-start" }).state, "applied");
    o.release();
    assert.deepEqual(await confirming, { state: "unknown", actionId: card.actionId }, change);
    assert.equal(o.database.authority.commandAudits.findByCommand(command.commandId), undefined, `${change}: the assistant command took no effect`);
    assert.equal(o.runCount(), before + (change === "plan" ? 1 : 0), change);
    await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u);
    assert.equal(o.runCount(), before + (change === "plan" ? 1 : 0));
    assert.deepEqual(o.captions(), [ERROR_CATALOG.ASSISTANT_OUTCOME_UNKNOWN.text], change);
  }
});

it("keeps a lost response or an abort after the canonical effect UNKNOWN with exactly one effect and no reapproval", async () => {
  for (const mode of ["lost-after", "hold-after"] as const) {
    const o = await owners(), card = await rerunCard(o, await o.done()), command = o.commandOf(card), controller = new AbortController(), before = o.runCount();
    o.submitMode(mode);
    const confirming = o.decide(card, "confirm", controller.signal);
    if (mode === "hold-after") {
      await vi.waitFor(() => assert.equal(o.runCount(), before + 1), { timeout: 5_000, interval: 10 });
      controller.abort(); o.release();
    }
    assert.deepEqual(await confirming, { state: "unknown", actionId: card.actionId }, mode);
    assert.equal(o.runCount(), before + 1, `${mode}: exactly one canonical effect`);
    assert.equal(o.database.authority.commandAudits.findByCommand(command?.commandId ?? "")?.result.state, "applied");
    assert.notEqual(o.database.authority.assistantAuthorization.action(card.actionId)?.state, "prepared");
    await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u);
    assert.equal(o.runCount(), before + 1, `${mode}: no retry`);
    assert.deepEqual(o.captions(), [ERROR_CATALOG.ASSISTANT_OUTCOME_UNKNOWN.text], mode);
    assert.deepEqual(o.database.authority.assistantHistory.replay(o.context.conversationId, Number.MAX_SAFE_INTEGER).map(row => row.modelText), [`Outcome unknown: ${card.label}. Do not retry.`], mode);
  }
});

it("shows Separations document identities from the real planned canonical inputs", () => {
  const descriptor = DESCRIPTORS.find(candidate => candidate.id === "separations"); assert.ok(descriptor?.surfaces.inputRun);
  const planning = workflowPlanning(descriptor), schemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  const rows = parseInputRunText(descriptor.surfaces.inputRun.parser, "4502; 4510").map(entry => {
    const submission = { ...(toRawSubmission(entry) as Record<string, unknown>), timekeeperName: "Synthetic Timekeeper" };
    return plannedRowDisplay("separations", { schemaHash, value: planning.parseCanonicalInput(planning.parseInput(submission).input) });
  });
  assert.deepEqual(rows, [{ kind: "document", documentNumber: "4502" }, { kind: "document", documentNumber: "4510" }]);
  assert.deepEqual(plannedRowDisplay("separations", { value: { documentNumber: "4502" } }), { kind: "request" });
});

it("shows an Emergency Contact PDF start row as its registered source file, never as a person", () => {
  const descriptor = DESCRIPTORS.find(candidate => candidate.id === "emergency-contact"); assert.ok(descriptor);
  const planning = workflowPlanning(descriptor), schemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  const document = { id: randomUUID(), sha256: "c".repeat(64), bytes: 21, mediaType: "application/pdf" };
  const input = { schemaHash, value: planning.parseCanonicalInput(planning.parseInput({ document, readingId: randomUUID(), roster: null, reading: { kind: "subscription" } }).input) };
  assert.deepEqual(plannedRowDisplay("emergency-contact", input, id => id === document.id ? "contact.pdf" : undefined), { kind: "file", fileName: "contact.pdf", formType: "emergency-contact" });
  assert.deepEqual(plannedRowDisplay("emergency-contact", input), { kind: "request" }, "an unregistered source shows no file name");
});

/** A library workbook with one worksheet and a second type, both issued as references. */
function seedWorkbook(o: Owners) {
  const created = o.library.create(EditableWorkbookSchema.parse({ name: "Roster", themes: [], hasFormulas: false,
    sheets: [{ id: randomUUID(), name: "Sheet1", width: 1, hidden: [], headerRow: 1, rows: [{ id: randomUUID(), cells: [{ value: "Name" }] }, { id: randomUUID(), cells: [{ value: "A" }] }] }] }));
  const type = o.library.putType({ id: randomUUID(), name: "Staff", keyFieldId: null, fields: ["roster.Name"], defaultWorkbookId: null, fieldLabels: { "roster.Name": "Name" } });
  const typeId = (type as { id: string }).id;
  return { libraryId: created.libraryId, sheet: o.references.issue("S", created.libraryId, "Roster"), type: o.references.issue("T", typeId, "Staff"), typeId,
    entry: () => { const entry = o.library.catalog().find(candidate => candidate.libraryId === created.libraryId); assert.ok(entry); return entry; } };
}
const sheetCard = (o: Owners, change: Record<string, unknown>) => o.tool("propose_spreadsheet_change").propose({ change }, o.context);

it("imports an attached spreadsheet under the typed name only on Confirm, once, as an untyped workbook", async () => {
  const o = await owners(), file = o.attach("roster.csv", "text/csv", "Name,Dept\nAda,HR\nBo,IT\n"), before = o.library.catalog().length;
  await assert.rejects(sheetCard(o, { action: "import", file, name: "Q3 roster" }), refusedWith("ASSISTANT_INVALID"), "a name the operator did not type refuses");
  o.context.operatorText = "Import this as Q3 roster please";
  await assert.rejects(sheetCard(o, { action: "import", file, name: "Q3 roster", type: "x" }), /ZodError|Unrecognized/u, "extra fields refuse");
  const card = await sheetCard(o, { action: "import", file, name: "Q3 roster" });
  assert.ok(card.effect === "spreadsheet" && card.action === "import");
  assert.deepEqual(card.facts, [{ label: "File", value: "roster.csv" }, { label: "Name", value: "Q3 roster" }, { label: "Worksheets", value: "1" }, { label: "Rows", value: "2" }]);
  assert.equal(o.library.catalog().length, before, "nothing is written before Confirm");
  await assert.rejects(o.decide(card, "confirm", undefined, "f".repeat(64)), /assistant-reviewed-proposal-mismatch/u);
  assert.deepEqual(await o.decide(card, "confirm"), { state: "applied", actionId: card.actionId });
  const imported = o.library.catalog().filter(entry => entry.name === "Q3 roster");
  assert.equal(imported.length, 1);
  await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u);
  assert.equal(o.library.catalog().filter(entry => entry.name === "Q3 roster").length, 1, "a duplicate Confirm writes nothing");
  assert.deepEqual(o.captions(), ["Done: Import spreadsheet."]);
});

it("pins set-type with the current SharePoint link and settles a stale version as a refused receipt", async () => {
  const o = await owners(), seed = seedWorkbook(o);
  const card = await sheetCard(o, { action: "set-type", sheet: seed.sheet, type: seed.type });
  assert.ok(card.effect === "spreadsheet");
  assert.deepEqual(card.facts.at(-1), { label: "Type", value: `${seed.entry().type.name} → Staff` });
  assert.deepEqual(await o.decide(card, "confirm"), { state: "applied", actionId: card.actionId });
  assert.deepEqual(seed.entry().metadata, { typeId: seed.typeId, sharePoint: null });
  const stale = await sheetCard(o, { action: "set-type", sheet: seed.sheet, type: seed.type });
  const current = o.library.read(seed.libraryId);
  o.library.save(seed.libraryId, current.version, { ...current.workbook });
  assert.deepEqual(await o.decide(stale, "confirm"), { state: "refused", code: "ASSISTANT_SPREADSHEET_REFUSED" });
  assert.equal(o.library.journal(seed.libraryId).at(-1)?.state, "refused");
});

it("settles a stale library action refused, refuses foreign versions before a card, and binds every change to the attachment", async () => {
  const o = await owners(), seed = seedWorkbook(o), other = seedWorkbook(o);
  o.context.operatorText = "rename it to Payroll";
  const card = await sheetCard(o, { action: "rename", sheet: seed.sheet, name: "Payroll" });
  assert.deepEqual(card.effect === "spreadsheet" ? card.facts : [], [{ label: "Name", value: "Roster → Payroll" }]);
  const entry = seed.entry();
  await o.library.libraryAction(seed.libraryId, { operationId: randomUUID(), expectedRevision: entry.state.revision, expectedVersion: entry.version, change: { kind: "rename", name: "Elsewhere" } }, new AbortController().signal);
  assert.deepEqual(await o.decide(card, "confirm"), { state: "refused", code: "ASSISTANT_SPREADSHEET_REFUSED" });
  assert.equal(seed.entry().name, "Elsewhere");
  const foreign = o.references.issue("V", `${other.libraryId}:${other.entry().state.selectedVersionId}`, "v");
  await assert.rejects(sheetCard(o, { action: "use-version", sheet: seed.sheet, version: foreign }), refusedWith("ASSISTANT_READ_STALE"));
  const file = o.attach("next.csv", "text/csv", "Name\nCy\n");
  const next = await sheetCard(o, { action: "new-version", sheet: seed.sheet, file });
  o.replaceAttachment(file);
  const version = seed.entry().version;
  assert.deepEqual(await o.decide(next, "confirm"), { state: "refused", code: "ASSISTANT_ATTACHMENT_UNAVAILABLE" });
  assert.equal(seed.entry().version, version, "a changed attachment writes nothing");
});

it("refuses with zero writes when the model verification expires while a SharePoint download is held", async () => {
  const o = await owners(), seed = seedWorkbook(o);
  o.context.operatorText = "link https://contoso.sharepoint.com/sites/hr/roster.xlsx";
  const link = await sheetCard(o, { action: "link", sheet: seed.sheet, url: "https://contoso.sharepoint.com/sites/hr/roster.xlsx" });
  assert.deepEqual(await o.decide(link, "confirm"), { state: "applied", actionId: link.actionId });
  let release: () => void = () => {}, entered: () => void = () => {};
  const held = new Promise<void>(resolve => { entered = resolve; });
  o.sync.download = async (_command, use) => { entered(); await new Promise<void>(resolve => { release = resolve; }); return use({ name: "roster.csv", bytes: new TextEncoder().encode("Name\nZed\n").buffer }, { signal: new AbortController().signal, assertCurrent() {} }); };
  const card = await sheetCard(o, { action: "sync", sheet: seed.sheet });
  const revision = seed.entry().state.revision, decided = o.decide(card, "confirm");
  await held; o.expireModel(); release();
  assert.deepEqual(await decided, { state: "refused", code: "ASSISTANT_CONTEXT_STALE" });
  assert.equal(seed.entry().state.revision, revision, "no library write");
});

it("refuses with zero writes when the card expires while a SharePoint download is held", async () => {
  const o = await owners(), seed = seedWorkbook(o);
  o.context.operatorText = "link https://contoso.sharepoint.com/sites/hr/roster.xlsx";
  const link = await sheetCard(o, { action: "link", sheet: seed.sheet, url: "https://contoso.sharepoint.com/sites/hr/roster.xlsx" });
  assert.deepEqual(await o.decide(link, "confirm"), { state: "applied", actionId: link.actionId });
  let release: () => void = () => {}, entered: () => void = () => {};
  const held = new Promise<void>(resolve => { entered = resolve; });
  o.sync.download = async (_command, use) => { entered(); await new Promise<void>(resolve => { release = resolve; }); return use({ name: "roster.csv", bytes: new TextEncoder().encode("Name\nZed\n").buffer }, { signal: new AbortController().signal, assertCurrent() {} }); };
  const card = await sheetCard(o, { action: "sync", sheet: seed.sheet });
  const revision = seed.entry().state.revision, decided = o.decide(card, "confirm");
  await held; o.clock.advanceWall(Date.parse(card.expiresAt) - o.clock.nowMs() + 1); release();
  assert.deepEqual(await decided, { state: "refused", code: "ASSISTANT_CONTEXT_STALE" });
  assert.equal(seed.entry().state.revision, revision, "no library write");
});

it("reads a lost library-action response back from its operation record and keeps a lost import UNKNOWN", async () => {
  const o = await owners(), seed = seedWorkbook(o);
  const real = o.library;
  o.workbookOwner.library = { ...real, async libraryAction(...args: Parameters<typeof real.libraryAction>) { await real.libraryAction(...args); throw new Error("synthetic lost response"); },
    create(value: unknown) { real.create(value); throw new Error("synthetic lost response"); } };
  o.context.operatorText = "rename to Kept, import as Lost";
  const rename = await sheetCard(o, { action: "rename", sheet: seed.sheet, name: "Kept" });
  assert.deepEqual(await o.decide(rename, "confirm"), { state: "applied", actionId: rename.actionId });
  assert.equal(seed.entry().name, "Kept");
  const file = o.attach("lost.csv", "text/csv", "Name\nA\n");
  const card = await sheetCard(o, { action: "import", file, name: "Lost" });
  assert.deepEqual(await o.decide(card, "confirm"), { state: "unknown", actionId: card.actionId });
  assert.ok(o.captions().at(-1)?.includes("Check the Spreadsheets library for Lost."));
  await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u, "UNKNOWN is never retried");
});
