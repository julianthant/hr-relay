import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, afterEach, expect, it } from "vitest";
import { createAssistantReferenceTable } from "../../../src/backend/assistant/references.js";
import { assistantProposalParts, createAssistantTypedProposals, type PlannedInputs } from "../../../src/backend/assistant/typed-proposals.js";
import { AssistantToolRefusal, type AssistantToolContext } from "../../../src/backend/assistant/plugins/plugin.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { AssistantAcceptedTurnSchema, type AssistantReplyPart } from "../../../src/models/dashboard/assistant.js";
import { CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { assistantM1HistoryFixture } from "../../support/helpers/assistant-m1-history-fixture.js";
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { createCommandKernelTestWorld } from "../../support/helpers/backend/command-kernel-harness.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";

const HOUR = 3_600_000;
const usage = { state: "measured", callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
const fixtureProfiles = createProfileFixtureSet();
const world = createCommandKernelTestWorld(fixtureProfiles.create);
afterAll(() => fixtureProfiles.close());
afterEach(async () => {
  for (const database of world.openDatabases.splice(0).reverse()) database.close();
  for (const profile of world.profiles.splice(0).reverse()) await profile.close();
  for (const root of world.roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true });
});

/** The typed-proposal owner over the real start planner, with `plannedInputs` read from the stored `StartPlanRecord` as composition supplies it. */
async function fixture() {
  const served = DESCRIPTORS.filter(descriptor => descriptor.id === "person-lookup" || descriptor.id === "emergency-contact");
  const resolve = (id: string) => served.find(descriptor => descriptor.id === id);
  const h = await world.createHarness(undefined, { descriptors: served });
  const library = createWorkbookLibraryService({ repository: h.database.authority.workbooks, clock: h.clock, sync: unexpectedWorkbookSync });
  const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
  const planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: h.plannerIds,
    descriptors: { resolve }, workbooks: library, planTtlMs: 600_000,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });

  const T = h.clock.now().toISOString(), storage = assistantM1HistoryFixture({ now: T, acceptedAt: T }), chat = storage.create(), table = createAssistantReferenceTable(1);
  const submitted: CommandRequest[] = [], planIds: string[] = [];
  let uploads = 0;
  const owner = createAssistantTypedProposals({ store: storage.proposals(), descriptors: { resolve }, served: () => true,
    plans: { plan(request) { const wire = planner.plan(request); planIds.push(wire.startPlanId); return wire; } },
    plannedInputs: (id): PlannedInputs | undefined => { const r = h.database.authority.startPlans.get(id);
      return r && { capturedAt: r.plannedAt, runs: r.planned.map(p => ({ input: p.input, rawInput: p.rawInput, workbookReferences: p.workbookReferences })) }; },
    runs: { read: runId => ({ state: "present" as const, run: RunRecordSchema.parse(personLookupQueuedRun({ runId, itemId: randomUUID() })), disposition: "live" as const }) }, rerunValues: () => { throw new Error("unused"); },
    attachment: () => ({ name: "scan.pdf", mediaType: "application/pdf", bytes: new Uint8Array([1]) }) as never,
    ocrSources: () => ({ upload: () => { uploads++; return Promise.reject(new Error("unused")); } }),
    submit(command) {
      owner.assertEffect(command.commandId, command); submitted.push(command);
      return Promise.resolve(CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "run", runId: randomUUID() }] }));
    },
    browserMode: () => "headless", current: () => ({ profileId: storage.profileId(), epoch: storage.epoch() }), clock: h.clock, actorId: "local-operator" });
  const context: AssistantToolContext = { signal: new AbortController().signal, references: table, actorId: "local-operator", conversationId: chat, operatorText: "x",
    assertCurrent() {}, assertRetainedCurrent() {} };
  const tool = owner.plugin.tools.find(entry => entry.name === "propose_workflow_start"); assert.ok(tool?.kind === "typed-proposal");
  const accept = (proposalAnswer: unknown = null) => {
    const accepted = storage.history.accept({ ...storage.input(chat), proposalAnswer: AssistantAcceptedTurnSchema.shape.proposalAnswer.parse(proposalAnswer) });
    assert.ok(accepted.state === "accepted"); return accepted;
  };
  const propose = async () => {
    const source = accept(), draft = await tool.prepare({ workflow: "person-lookup", entries: ["10000001"], dryRun: false }, context), id = randomUUID();
    const parts: AssistantReplyPart[] = assistantProposalParts(draft);
    assert.ok(storage.history.settle(source, { delivery: "answered", usage, reply: { id, kind: "answer", parts, modelText: "x" } }, T));
    return owner.issue(draft, { conversationId: chat, renderedMessageId: id, sourceMessageId: source.acceptedTurn.messageId, revision: storage.revision(chat) });
  };
  const yes = async (record: Awaited<ReturnType<typeof propose>>) => {
    const attempt = accept({ proposalId: record.snapshot.id, proposalRevision: record.snapshot.revision, renderedMessageId: record.snapshot.renderedMessageId, renderedDigest: record.snapshot.renderedDigest });
    await owner.answer(attempt, new AbortController().signal, () => {});
    return storage.proposals().read(record.snapshot.id)?.rows.map(row => row.result);
  };
  const proposePdf = () => tool.prepare({ workflow: "emergency-contact", entries: [table.issue("A", randomUUID(), "scan.pdf")], dryRun: false }, context);
  return { h, propose, proposePdf, yes, submitted, planIds, uploads: () => uploads };
}

it("runs a proposal answered hours later against a fresh real plan whose stored inputs still match the review", async () => {
  const f = await fixture(), record = await f.propose();
  f.h.clock.advanceWall(5 * HOUR);
  const [row] = (await f.yes(record)) ?? [];
  expect(row?.state).toBe("applied");
  expect(f.submitted).toHaveLength(1);
  const [proposed, fresh] = f.planIds; assert.ok(proposed && fresh && proposed !== fresh);
  expect(f.submitted[0]?.target).toMatchObject({ startPlanId: fresh });
});

it("refuses a workflow that needs a reference spreadsheet before any upload or plan", async () => {
  const f = await fixture();
  await assert.rejects(f.proposePdf(), (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_PROPOSAL_REFUSED");
  expect(f.uploads()).toBe(0);
  expect(f.planIds).toHaveLength(0);
});
