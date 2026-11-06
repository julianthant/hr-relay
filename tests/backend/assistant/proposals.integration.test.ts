import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
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
import { CommandRequestSchema, type CommandResult } from "../../../src/rules/commands/commands.js";
import { workflowPlanning } from "../../../src/workflow-kit/workflow.js";
import { assistantProposalDigest } from "../../../src/dashboard/surfaces/assistant/assistant-controller-model.js";
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { makeWorld, type DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";
import { rerunValuesHarness } from "../../support/fixtures/rerun-values-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

async function owners() {
  const h = await rerunValuesHarness(profiles.create), w: DashboardWorld = await makeWorld({ profileFixture: profiles.create });
  disposers.push(async () => { await h.dispose(); }, async () => { await w.dispose(); });
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
  const kernel = createCommandKernel({ lifecycle: h.lifecycle, appVersion: "0.1.0", authority: database, clock, ids: { uuid: randomUUID }, descriptors: { resolve: () => h.descriptor },
    configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: { recheck: unused, resolveAbsent: unused },
    workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } },
    assistantRevalidate: command => { if (database.authority.assistantAuthorization.actionByCommand(command.commandId) !== undefined) owner.authorization?.assertEffect(command.commandId, command); } });
  const authorization = owner.authorization = createAssistantAuthorization({ database, kernel, clock, current: () => ({ profileId, epoch: 1 }) });
  const data = composeDataQueries({ stateRoot: w.stateRoot, timeline: w.timeline, projection: w.projection, authority: w.authority, descriptors: { resolve: () => undefined },
    runReader: h.lifecycle, canonical: { reader: h.lifecycle, database, descriptors: { resolve: () => h.descriptor } } });
  const submitted: CommandResult[] = [];
  let gate: Promise<void> | undefined, failSubmit = false;
  const proposals = createAssistantProposals({ database, authorization, plans: h.planner, runs: h.lifecycle, descriptors: { resolve: () => h.descriptor },
    rerunValues: request => data.rerunValues(request), served: () => true, actorId: "local-operator", clock, assertCurrent() {},
    commands: { publish() {}, async submit(command) { await gate; if (failSubmit) throw new Error("synthetic lost submit"); const result = kernel.execute(command); submitted.push(result); return result; } } });
  let modelCurrent = true;
  const references = createAssistantReferenceTable(1);
  const context = { signal: new AbortController().signal, references, actorId: "local-operator", assertCurrent() {},
    assertRetainedCurrent() { if (!modelCurrent) throw new Error("model verification expired"); } };
  const tool = (name: string) => { const found = proposals.plugin.tools.find(candidate => candidate.name === name); assert.ok(found?.kind === "proposal"); return found; };
  const decide = async (proposal: AssistantActionProposal, decision: "confirm" | "cancel", signal = new AbortController().signal, digest?: string) =>
    proposals.decideAction(AssistantActionDecisionSchema.parse({ chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision, decision,
      ...(decision === "confirm" ? { reviewedDigest: digest ?? await assistantProposalDigest(proposal) } : {}) }), signal);
  const done = async () => { const queued = h.start(h.proposal()); assert.equal((await h.execute(queued)).state, "done"); return h.fresh(queued); };
  const runs = () => database.authority.runs.listByWorkflow(h.descriptor.id).length;
  return { h, database, clock, proposals, tool, decide, done, runs, submitted, references, context, executeSettings,
    hold() { let release!: () => void; gate = new Promise(resolve => { release = resolve; }); return () => { gate = undefined; release(); }; },
    failSubmit() { failSubmit = true; }, expireModel() { modelCurrent = false; } };
}

it("issues and confirms an eligible rerun once, and refuses a cancelled source without a card", async () => {
  const o = await owners(), source = await o.done();
  const run = o.references.issue("R", source.envelope.runId, "run", source.envelope.runId, source.version);
  const before = o.runs();
  const card = await o.tool("propose_rerun").propose({ run }, o.context);
  assert.ok(card.effect === "workflow-start" && card.source === "rerun" && card.startPlan.planned.length === 1);
  assert.equal(o.runs(), before, "no dispatch without Confirm");
  assert.deepEqual(await o.decide(card, "confirm"), { state: "applied", actionId: card.actionId });
  assert.equal(o.runs(), before + 1);
  await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u);
  assert.equal(o.runs(), before + 1);
  const queued = o.h.start(o.h.proposal());
  assert.equal(o.h.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: o.clock.now().toISOString(), requestedBy: "local-operator", source: "queue-row",
    family: "run", type: "cancel", target: { runId: queued.envelope.runId, expectedVersion: queued.version } })).state, "applied");
  const cancelled = o.h.fresh(queued);
  await assert.rejects(o.tool("propose_rerun").propose({ run: o.references.issue("R", cancelled.envelope.runId, "run", cancelled.envelope.runId) }, o.context),
    (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_PROPOSAL_REFUSED");
  const moved = o.references.issue("R", source.envelope.runId, "the selected run", source.envelope.runId, source.version + 1);
  await assert.rejects(o.tool("propose_rerun").propose({ run: moved }, o.context), (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_READ_STALE");
});

it("lets exactly one of a concurrent Confirm and Cancel win and binds Confirm to the exact rendered card", async () => {
  const o = await owners(), source = await o.done(), run = o.references.issue("R", source.envelope.runId, "run", source.envelope.runId);
  const card = await o.tool("propose_rerun").propose({ run }, o.context), before = o.runs();
  assert.ok(card.effect === "workflow-start");
  const row = card.startPlan.planned[0]; assert.ok(row);
  for (const changed of [{ ...card, targetLabel: `${card.targetLabel} ` }, { ...card, label: "Rerun Ｗorkflow" },
    { ...card, startPlan: { ...card.startPlan, planned: [{ ...row, title: `${row.title}́` }] } }, { ...card, startPlan: { ...card.startPlan, planned: [row, row] } }]) {
    await assert.rejects(o.decide(card, "confirm", undefined, await assistantProposalDigest(changed)), /assistant-reviewed-proposal-mismatch/u);
  }
  assert.equal(o.runs(), before);
  const outcomes = await Promise.allSettled([o.decide(card, "confirm"), o.decide(card, "cancel")]);
  const settled = outcomes.flatMap(outcome => outcome.status === "fulfilled" ? [outcome.value.state] : []);
  assert.equal(settled.length, 1, JSON.stringify(outcomes));
  assert.equal(o.runs(), before + (settled[0] === "applied" ? 1 : 0));
});

it("keeps a held start's post-claim abort, invalidation and lost submit UNKNOWN with zero stale effects and no retry", async () => {
  const cases = ["abort", "settings", "grant", "model", "lost"] as const;
  for (const change of cases) {
    const o = await owners(), source = await o.done(), run = o.references.issue("R", source.envelope.runId, "run", source.envelope.runId);
    const card = await o.tool("propose_rerun").propose({ run }, o.context), before = o.runs(), controller = new AbortController();
    const release = o.hold();
    if (change === "lost") o.failSubmit();
    const confirming = o.decide(card, "confirm", controller.signal);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(o.database.authority.assistantAuthorization.action(card.actionId)?.state, "claimed", change);
    if (change === "abort") controller.abort();
    if (change === "settings") assert.equal(o.executeSettings({ "browser.headless": { set: false } }).state, "applied");
    if (change === "grant") assert.equal(o.executeSettings({}, { expectedPolicyRevision: 1, mode: "every-action" }).state, "applied");
    if (change === "model") o.expireModel();
    release();
    assert.deepEqual(await confirming, { state: "unknown", actionId: card.actionId }, change);
    assert.equal(o.runs(), before, `${change}: no stale effect`);
    await assert.rejects(o.decide(card, "confirm"), /assistant-action-not-current/u);
    assert.equal(o.runs(), before);
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
