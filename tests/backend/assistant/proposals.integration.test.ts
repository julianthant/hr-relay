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
import { AssistantActionDecisionSchema, type AssistantActionProposal } from "../../../src/models/dashboard/assistant.js";
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
  const proposals = createAssistantProposals({ database, authorization, plans: h.planner, runs: h.lifecycle, descriptors: { resolve: () => h.descriptor },
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
  const context = { signal: new AbortController().signal, references, actorId: "local-operator", conversationId, assertCurrent() {},
    assertRetainedCurrent() { if (!modelCurrent) throw new Error("model verification expired"); } };
  const tool = (name: string) => { const found = proposals.plugin.tools.find(candidate => candidate.name === name); assert.ok(found?.kind === "proposal"); return found; };
  const decide = async (proposal: AssistantActionProposal, decision: "confirm" | "cancel", signal = new AbortController().signal, digest?: string) =>
    proposals.decideAction(AssistantActionDecisionSchema.parse({ chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision, decision,
      ...(decision === "confirm" ? { reviewedDigest: digest ?? await assistantProposalDigest(proposal) } : {}) }), signal);
  const done = async (eid?: string) => { const queued = h.start(h.proposal(undefined, undefined, false, eid)); assert.equal((await h.execute(queued)).state, "done"); return h.fresh(queued); };
  const runCount = () => database.authority.runs.listByWorkflow(h.descriptor.id).length;
  const commandOf = (card: AssistantActionProposal) => database.authority.assistantAuthorization.action(card.actionId)?.command;
  return { h, database, clock, kernel, proposals, tool, decide, done, runCount, commandOf, references, context, captions, executeSettings,
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
    assert.deepEqual(o.captions(), [`Outcome unknown: ${card.label}. Do not retry.`], change);
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
    assert.deepEqual(o.captions(), [`Outcome unknown: ${card.label}. Do not retry.`], mode);
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
