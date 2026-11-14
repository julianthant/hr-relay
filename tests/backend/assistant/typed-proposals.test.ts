import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createAssistantReferenceTable } from "../../../src/backend/assistant/references.js";
import { assistantProposalParts, isTypedYes } from "../../../src/backend/assistant/typed-proposals.js";
import type { AssistantProposalDraft, AssistantToolContext } from "../../../src/backend/assistant/plugins/plugin.js";
import { AssistantAcceptedTurnSchema, AssistantM2ProposalOperationSchema, type AssistantReplyPart } from "../../../src/models/dashboard/assistant.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { assistantM1HistoryFixture } from "../../support/helpers/assistant-m1-history-fixture.js";
import { typedProposalFixture } from "../../support/helpers/assistant-typed-proposals.js";

const T = "2026-11-09T12:00:00.000Z";
const usage = { state: "measured", callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
const entries = (n: number) => Array.from({ length: n }, (_, index) => String(10000001 + index));

function world() {
  const storage = assistantM1HistoryFixture({ now: T, acceptedAt: T }), f = typedProposalFixture(storage, T), chat = storage.create(), table = createAssistantReferenceTable(1);
  const context = (): AssistantToolContext => ({ signal: new AbortController().signal, references: table, actorId: "local-operator", conversationId: chat, operatorText: "x",
    assertCurrent() {}, assertRetainedCurrent() {} });
  const tool = (name: string) => { const found = f.owner.plugin.tools.find(entry => entry.name === name); assert.ok(found?.kind === "typed-proposal"); return found; };
  const accept = (proposalAnswer: unknown = null) => {
    const accepted = storage.history.accept({ ...storage.input(chat), proposalAnswer: AssistantAcceptedTurnSchema.shape.proposalAnswer.parse(proposalAnswer) });
    assert.ok(accepted.state === "accepted"); return accepted;
  };
  const settle = (accepted: ReturnType<typeof accept>, parts: AssistantReplyPart[] = [{ kind: "text", runs: [{ kind: "plain", text: "Done" }] }]) => {
    const id = randomUUID();
    assert.ok(storage.history.settle(accepted, { delivery: "answered", usage, reply: { id, kind: "answer", parts, modelText: "x" } }, T));
    return id;
  };
  /** A proposing turn: the tool's draft, rendered in the turn's reply and issued against it. */
  const propose = async (name: string, args: unknown) => {
    const source = accept(), draft = await tool(name).prepare(args, context()), renderedMessageId = settle(source, assistantProposalParts(draft));
    return { draft, record: f.owner.issue(draft, { conversationId: chat, renderedMessageId, sourceMessageId: source.acceptedTurn.messageId, revision: storage.revision(chat) }) };
  };
  const yes = (record: Awaited<ReturnType<typeof propose>>["record"]) => accept({ proposalId: record.snapshot.id, proposalRevision: record.snapshot.revision,
    renderedMessageId: record.snapshot.renderedMessageId, renderedDigest: record.snapshot.renderedDigest });
  const answer = (attempt: ReturnType<typeof accept>, check = () => {}) => f.owner.answer(attempt, new AbortController().signal, check);
  const states = (id: string) => f.ports.store.read(id)?.rows.map(row => row.result.state);
  return { storage, f, chat, table, tool, context, accept, settle, propose, yes, answer, states };
}

it("recognises only the closed typed-yes list, ignoring case, spacing and . , !", () => {
  for (const text of ["yes", "Yes!", "  YES. ", "yes file it", "Yes, file it.", "approve", "Go ahead!", "do it"]) assert.equal(isTypedYes(text), true, text);
  for (const text of ["yes, but use the dry run", "yes please", "yes?", "ok", "sure", "no", "y", "do it now", "approved"]) assert.equal(isTypedYes(text), false, text);
});

it("proposes 1 to 20 rows from per-row fresh plans with the reviewed options and refuses 21 or a repeated entry", async () => {
  const w = world();
  for (const n of [1, 20]) {
    const draft: AssistantProposalDraft = await w.tool("propose_workflow_start").prepare({ workflow: "person-lookup", entries: entries(n), dryRun: false }, w.context());
    assert.equal(draft.rows.length, n);
    assert.deepEqual(draft.options, { browserMode: "headless", captureBrowserScreenshots: true, priority: "interactive" });
    assert.equal(new Set(draft.rows.map(row => row.operation.kind === "workflow-start" ? row.operation.reviewed : "")).size, n);
  }
  await assert.rejects(w.tool("propose_workflow_start").prepare({ workflow: "person-lookup", entries: entries(21), dryRun: false }, w.context()));
  await assert.rejects(w.tool("propose_workflow_start").prepare({ workflow: "person-lookup", entries: ["10000001", "10000001"], dryRun: false }, w.context()), /ASSISTANT_PROPOSAL_REFUSED/u);
  await assert.rejects(w.tool("propose_workflow_start").prepare({ workflow: "person-lookup", entries: ["10000001"], dryRun: true }, w.context()), /ASSISTANT_PROPOSAL_REFUSED/u);
  assert.equal(w.f.submitted.length, 0);
});

it("runs each reviewed row under its own claim and command after the typed yes, once, even hours after the proposal", async () => {
  const w = world(), { record } = await w.propose("propose_workflow_start", { workflow: "person-lookup", entries: entries(2), dryRun: false });
  w.f.clock.advanceWall(3 * 3_600_000);
  const attempt = w.yes(record), reply = await w.answer(attempt);
  assert.equal(w.f.submitted.length, 2);
  assert.deepEqual(w.f.submitted.map(entry => entry.attribution), record.snapshot.rows.map(row => ({ kind: "assistant", requestedBy: "local-operator", profileId: w.storage.profileId(),
    conversationId: w.chat, acceptedMessageId: attempt.acceptedTurn.messageId, binding: { kind: "proposal", proposalId: record.snapshot.id, rowId: row.id } })));
  assert.equal(new Set(w.f.submitted.map(entry => entry.command.commandId)).size, 2);
  assert.deepEqual(w.states(record.snapshot.id), ["applied", "applied"]);
  assert.deepEqual(reply.parts.map(part => part.kind), ["answered", "session", "session"]);
  await assert.rejects(w.answer(attempt), /ASSISTANT_PROPOSAL_REFUSED/u);
  assert.equal(w.f.submitted.length, 2);
  const [first] = w.f.submitted;
  assert.ok(first);
  assert.throws(() => w.f.owner.assertEffect(first.command.commandId, first.command), /custody-unproved/u);
});

it("refuses a row whose fresh plan no longer matches what was reviewed while the others still run", async () => {
  const w = world(), { record } = await w.propose("propose_workflow_start", { workflow: "person-lookup", entries: entries(3), dryRun: false });
  let plans = 0;
  const plan = w.f.ports.plans.plan.bind(w.f.ports.plans);
  w.f.ports.plans.plan = input => { w.f.knobs.workbookVersion = ++plans === 2 ? 2 : 1; return plan(input); };
  const reply = await w.answer(w.yes(record));
  assert.deepEqual(w.states(record.snapshot.id), ["applied", "refused", "applied"]);
  assert.equal(w.f.submitted.length, 2);
  assert.deepEqual(reply.parts.map(part => part.kind), ["answered", "session", "text", "session"]);
  assert.deepEqual(reply.parts[2], { kind: "text", runs: [{ kind: "plain", text: "Not done: " }, { kind: "value", value: record.snapshot.rows[1]?.title }, { kind: "plain", text: " — " },
    { kind: "failure", code: "ASSISTANT_PROPOSAL_CHANGED", text: "Failed" }, { kind: "plain", text: `: ${ERROR_CATALOG.ASSISTANT_PROPOSAL_CHANGED.text}` }] });
  assert.match(reply.modelText, /Row 2: not done \(ASSISTANT_PROPOSAL_CHANGED\)\./u);
  assert.doesNotMatch(reply.modelText, /Lookup \d/u);
});

it("reruns an unchanged reviewed run and refuses one whose config or workbooks changed, with no command", async () => {
  for (const drift of ["none", "config", "workbook"] as const) {
    const w = world(), run = w.f.run(), token = w.table.issue("R", run.envelope.runId, "Lookup", run.envelope.runId, run.version);
    const { record } = await w.propose("propose_rerun", { run: token, dryRun: false });
    const [row] = record.snapshot.rows;
    assert.ok(row?.operation.kind === "rerun" && /^[0-9a-f]{64}$/u.test(row.operation.reviewed));
    w.f.clock.advanceWall(3_600_000);
    if (drift === "config") w.f.knobs.configFingerprint = "f".repeat(64);
    if (drift === "workbook") w.f.knobs.workbookVersion = 2;
    const reply = await w.answer(w.yes(record));
    assert.deepEqual(w.states(record.snapshot.id), [drift === "none" ? "applied" : "refused"], drift);
    assert.equal(w.f.submitted.length, drift === "none" ? 1 : 0, drift);
    if (drift !== "none") assert.ok(reply.parts.some(part => part.kind === "text" && part.runs.some(item => item.kind === "failure" && item.code === "ASSISTANT_PROPOSAL_CHANGED")), drift);
  }
});

it("keeps each refused command's own category and shows its fixed reason, never the kernel message", async () => {
  const w = world(), { record } = await w.propose("propose_workflow_start", { workflow: "person-lookup", entries: entries(5), dryRun: false });
  const scripted = [{ state: "conflict", currentVersion: 2 }, { state: "rejected", code: "invalid-state" }, { state: "rejected", code: "policy-refused" },
    { state: "rejected", code: "RUN_CONTINUATION_REFUSED" }];
  w.f.knobs.submit = command => { const next = scripted[w.f.submitted.length - 1]; return next === undefined ? undefined : { ...next, commandId: command.commandId, message: "kernel detail" }; };
  const reply = await w.answer(w.yes(record));
  assert.deepEqual(w.states(record.snapshot.id), ["refused", "refused", "refused", "refused", "applied"]);
  const codes = ["ASSISTANT_READ_STALE", "ASSISTANT_ROW_INVALID_STATE", "ASSISTANT_ROW_POLICY_REFUSED", "RUN_CONTINUATION_REFUSED"] as const;
  assert.deepEqual(w.f.ports.store.read(record.snapshot.id)?.rows.slice(0, 4).map(row => row.result.state === "refused" ? row.result.code : row.result.state), [...codes]);
  const lines = reply.parts.flatMap(part => part.kind === "text" && part.runs.some(item => item.kind === "failure") ? [part.runs] : []);
  assert.deepEqual(lines.map(runs => runs.flatMap(item => item.kind === "failure" ? [item.code] : [])), codes.map(code => [code]));
  assert.deepEqual(lines.map(runs => runs.at(-1)), codes.map(code => ({ kind: "plain", text: `: ${ERROR_CATALOG[code].text}` })));
  assert.doesNotMatch(JSON.stringify(reply), /kernel detail/u);
});

it("renders the files, people and EIDs Relay resolved, and the reviewed run options", () => {
  const operation = AssistantM2ProposalOperationSchema.parse({ kind: "run-action", runId: randomUUID(), expectedVersion: 1, action: "pause" });
  const parts = assistantProposalParts({ label: "Start Emergency Contact", dryRun: true, options: { browserMode: "headed", captureBrowserScreenshots: false, priority: "interactive" }, rows: [
    { title: "Emergency Contact PDF", display: { kind: "file", fileName: "first.pdf", formType: "emergency-contact" }, operation },
    { title: "Emergency Contact PDF", display: { kind: "file", fileName: "second.pdf", formType: "emergency-contact" }, operation },
    { title: "Avery Example", display: { kind: "person", name: "Example, Avery", employeeId: "10000001" }, operation },
  ] });
  assert.deepEqual(parts[1], { kind: "bullets", items: [[{ kind: "value", value: "first.pdf" }], [{ kind: "value", value: "second.pdf" }],
    [{ kind: "value", value: "Example, Avery" }, { kind: "plain", text: " · EID " }, { kind: "value", value: "10000001" }]] });
  assert.deepEqual(parts[2], { kind: "text", runs: [{ kind: "plain", text: "Runs in a visible browser, screenshots off." }] });
  assert.deepEqual(parts[0], { kind: "text", runs: [{ kind: "bold", text: "Start Emergency Contact (dry run)" }] });
});

it("keeps a row whose submit failed UNKNOWN, never reclaims it and runs the next row", async () => {
  const w = world(), { record } = await w.propose("propose_workflow_start", { workflow: "person-lookup", entries: entries(2), dryRun: false });
  let calls = 0;
  w.f.knobs.submit = () => { if (++calls === 1) throw new Error("lost"); return undefined; };
  await w.answer(w.yes(record));
  assert.deepEqual(w.states(record.snapshot.id), ["unknown", "applied"]);
  const [row] = record.snapshot.rows;
  assert.ok(row);
  assert.equal(w.f.ports.store.claimRow(record.snapshot.id, row.id, randomUUID()), false);
});

it("stops issuing commands once the accepted turn is retired", async () => {
  const w = world(), { record } = await w.propose("propose_workflow_start", { workflow: "person-lookup", entries: entries(3), dryRun: false });
  let retired = false;
  w.f.knobs.submit = () => { retired = true; return undefined; };
  await w.answer(w.yes(record), () => { if (retired) throw new Error("assistant-turn-retired"); });
  assert.deepEqual(w.states(record.snapshot.id), ["applied", "refused", "refused"]);
  assert.equal(w.f.submitted.length, 1);
});

it("refuses a changed command at the effect hook and a stale run at yes for run actions", async () => {
  const w = world(), run = w.f.run(), token = w.table.issue("R", run.envelope.runId, "Lookup", run.envelope.runId, run.version);
  const { record } = await w.propose("propose_run_action", { run: token, action: "pause" });
  assert.equal(record.snapshot.options, null);
  w.f.knobs.submit = command => {
    assert.throws(() => w.f.owner.assertEffect(command.commandId, CommandRequestSchema.parse({ ...command, requestedAt: "2026-11-09T12:00:01.000Z" })), /binding-mismatch/u);
    assert.doesNotThrow(() => w.f.owner.assertEffect(randomUUID()));
    return undefined;
  };
  const attempt = w.yes(record);
  await w.answer(attempt); w.settle(attempt);
  assert.equal(w.f.submitted[0]?.command.family, "run");
  assert.deepEqual(w.f.submitted[0]?.command.target, { runId: run.envelope.runId, expectedVersion: run.version });
  assert.deepEqual(w.states(record.snapshot.id), ["applied"]);

  const { record: later } = await w.propose("propose_run_action", { run: token, action: "cancel" });
  w.f.ports.runs.read = runId => { const read = w.f.run(); return { state: "present", run: RunRecordSchema.parse({ ...read, envelope: { ...read.envelope, runId }, version: read.version + 1 }), disposition: "live" }; };
  await w.answer(w.yes(later));
  assert.deepEqual(w.states(later.snapshot.id), ["refused"]);
  assert.equal(w.f.submitted.length, 1);
});
