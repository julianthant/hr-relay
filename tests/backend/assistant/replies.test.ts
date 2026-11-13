import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createAssistantReferenceTable } from "../../../src/backend/assistant/references.js";
import { resolveAssistantReply, assistantListParts, assistantProposalParts, assistantFailurePart, assistantAnsweredPart,
  assistantSessionPart, readAssistantSession, assistantPersonBinding, type ServerReplyBinding } from "../../../src/backend/assistant/replies.js";
import { AssistantAcceptedTurnSchema, AssistantReplyPartsSchema } from "../../../src/models/dashboard/assistant.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { searchPartitionDay } from "../../../src/models/dashboard/search-calendar.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { EXECUTOR_EID, personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";

const at = "2026-11-08T12:00:00.000Z";
const run = () => RunRecordSchema.parse(personLookupQueuedRun({ runId: randomUUID(), itemId: randomUUID() }));
const accepted = () => AssistantAcceptedTurnSchema.parse({ profileId: randomUUID(), epoch: 1, conversationId: randomUUID(), messageId: randomUUID(),
  ordinal: 1, acceptedRevision: 2, acceptedAt: at, proposalAnswer: null });
const digest = (value: string) => sha256Hex(canonicalJsonStringify(value));

it("resolves only this context's bound facts, in order, keeping wording literal and repeated handles deterministic", () => {
  const table = createAssistantReferenceTable(4), token = table.issue("V", "field", "new");
  const binding: ServerReplyBinding = { kind: "value-only", reference: token, entry: table.resolve(token, ["V"]), value: "new", previous: "old",
    source: { kind: "operator", profileId: randomUUID(), conversationId: randomUUID(), messageId: randomUUID(), at, valueFingerprint: digest("new") } };
  const parts = resolveAssistantReply(`**literal** https://example.invalid ${token} and ${token}`, table, [binding]);
  assert.deepEqual(parts, [{ kind: "text", runs: [{ kind: "plain", text: "**literal** https://example.invalid " },
    { kind: "value", value: "new", previous: "old", source: binding.source }, { kind: "plain", text: " and " },
    { kind: "value", value: "new", previous: "old", source: binding.source }] }]);
  assert.ok(Object.isFrozen(parts));
  for (const text of ["[[V1.g3]]", "[[V9.g4]]", "[[X1.g4]]"]) assert.throws(() => resolveAssistantReply(text, table, [binding]));
  assert.throws(() => resolveAssistantReply(token, table, []));
  const foreign = createAssistantReferenceTable(4), foreignToken = foreign.issue("V", "other", "other");
  assert.throws(() => resolveAssistantReply(token, table, [{ ...binding, entry: foreign.resolve(foreignToken, ["V"]) }]));
  assert.throws(() => resolveAssistantReply(token, table, [binding, { ...binding, value: "forged" }]));
  assert.throws(() => resolveAssistantReply(token, table, [{ ...binding, value: "forged" }]));
  assert.throws(() => resolveAssistantReply(token, table, [{ ...binding, source: { kind: "operator", profileId: randomUUID(), conversationId: randomUUID(), messageId: randomUUID(), at, valueFingerprint: "0".repeat(64) } }]));
});

it("proves a person target from actual canonical input and refuses failed target admission instead of downgrading", () => {
  const row = run(), table = createAssistantReferenceTable(5), token = table.issue("E", EXECUTOR_EID, EXECUTOR_EID);
  const binding = assistantPersonBinding(table, token, row);
  const parts = resolveAssistantReply(token, table, [binding]);
  assert.ok(parts[0]?.kind === "text" && parts[0].runs[0]?.kind === "link");
  const target = parts[0].runs[0].target; assert.equal(target.kind, "person");
  assert.equal(JSON.stringify(target).includes("[["), false);
  const wrong = table.issue("E", "10000001", "10000001");
  assert.throws(() => assistantPersonBinding(table, wrong, row));
  const malformed = RunRecordSchema.parse({ ...row, input: { ...row.input, parsed: { ...row.input.parsed, schemaHash: "0".repeat(64) } } });
  assert.throws(() => assistantPersonBinding(table, token, malformed));
  assert.throws(() => resolveAssistantReply(token, table, [{ ...binding, run: RunRecordSchema.parse({ ...row, version: row.version + 1 }) }]));
  const valueOnly: ServerReplyBinding = { kind: "value-only", reference: token, entry: table.resolve(token, ["E"]), value: EXECUTOR_EID };
  assert.deepEqual(resolveAssistantReply(token, table, [valueOnly]), [{ kind: "text", runs: [{ kind: "value", value: EXECUTOR_EID }] }]);
});

it("refuses protected person extraction before malformed canonical parsing while retaining a safe generic run link", () => {
  const row = RunRecordSchema.parse(personLookupQueuedRun({ protectedBindings: [{ kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: randomUUID() }] }));
  const table = createAssistantReferenceTable(6), person = table.issue("E", EXECUTOR_EID, EXECUTOR_EID);
  const malformed = RunRecordSchema.parse({ ...row, input: { ...row.input, parsed: { ...row.input.parsed, schemaHash: "0".repeat(64) } } });
  assert.throws(() => assistantPersonBinding(table, person, malformed), (error: unknown) => error instanceof Error && !error.message.includes(EXECUTOR_EID));
  const token = table.issue("R", row.envelope.runId, EXECUTOR_EID, row.envelope.runId, row.version);
  const binding: ServerReplyBinding = { kind: "target", reference: token, entry: table.resolve(token, ["R"]), value: EXECUTOR_EID, run: row,
    target: { kind: "run", runId: row.envelope.runId, day: searchPartitionDay(new Date(row.envelope.enqueuedAt)), section: "logs" } };
  const parts = resolveAssistantReply(token, table, [binding]);
  assert.equal(JSON.stringify(parts).includes(EXECUTOR_EID), false);
  assert.equal(JSON.stringify(parts).includes("Protected test subject"), true);
});

it("collapses complete ordinary lists above eight, never truncates proposals, and refuses unprovable counts", () => {
  const rows = Array.from({ length: 9 }, (_, i) => [{ kind: "value" as const, value: String(i) }]);
  assert.deepEqual(assistantListParts(rows.slice(0, 8)), [{ kind: "bullets", items: rows.slice(0, 8) }]);
  const target = { kind: "queue" as const, query: { q: "", scope: "all" as const, facets: {} } };
  assert.deepEqual(assistantListParts(rows, { complete: true, total: 9, target }), [{ kind: "text", runs: [
    { kind: "plain", text: "9 results. " }, { kind: "link", label: "Show in Queue", target }] }]);
  for (const proof of [undefined, { complete: false, total: 9, target }, { complete: true, total: 8, target }]) assert.throws(() => assistantListParts(rows, proof));
  assert.deepEqual(assistantProposalParts(rows), [{ kind: "bullets", items: rows }]);
  assert.equal(assistantProposalParts(Array.from({ length: 20 }, () => rows[0]))[0]?.kind, "bullets");
  assert.throws(() => assistantProposalParts(Array.from({ length: 21 }, () => rows[0])));
});

it("constructs failure text and answered identity/time on the server without converting restored prose into authority", () => {
  assert.deepEqual(assistantFailurePart("ASSISTANT_READ_STALE"), { kind: "text", runs: [{ kind: "failure", code: "ASSISTANT_READ_STALE", text: "Failed" }, { kind: "plain", text: `: ${ERROR_CATALOG.ASSISTANT_READ_STALE.text}` }] });
  const turn = accepted(), command = { commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant" };
  const proposalId = randomUUID(), answered = AssistantAcceptedTurnSchema.parse({ ...turn, proposalAnswer: { proposalId, proposalRevision: 1, renderedMessageId: randomUUID(), renderedDigest: "0".repeat(64) } });
  const part = assistantAnsweredPart(answered, command, { kind: "proposal", proposalId, rowId: randomUUID() }, at);
  assert.throws(() => assistantAnsweredPart(turn, command, { kind: "proposal", proposalId, rowId: randomUUID() }, at));
  assert.throws(() => assistantAnsweredPart(answered, command, { kind: "proposal", proposalId: randomUUID(), rowId: randomUUID() }, at));
  assert.equal(part.kind, "answered"); assert.ok(part.kind === "answered" && part.attribution.kind === "assistant");
  assert.equal(part.attribution.requestedBy, "local-operator"); assert.equal(part.attribution.acceptedMessageId, turn.messageId);
  assert.deepEqual(resolveAssistantReply("Started session. Filed by you.", createAssistantReferenceTable(7), []), [{ kind: "text", runs: [{ kind: "plain", text: "Started session. Filed by you." }] }]);
  assert.equal(AssistantReplyPartsSchema.safeParse([{ ...assistantSessionPart(run(), "Lookup"), stop: { command: "cancel" } }]).success, false);
});

it("rereads canonical session membership and revision each time and reuses only its exact eligible Cancel descriptor", () => {
  const row = run(), part = assistantSessionPart(row, "Lookup");
  const fixture = FIXTURE_DAY_WIRE.queueSurfaces.find(value => value.status === "queued" && value.surfaceKind === "single"); assert.ok(fixture);
  const base = { ...fixture, itemId: row.envelope.itemId, workflowId: row.envelope.workflow, traceId: row.envelope.traceId };
  const cancel = { kind: "command" as const, key: "cancel", command: "cancel" as const, label: "Cancel run", expectedVersion: row.version,
    intent: "destructive" as const, placement: ["footer" as const] };
  let current = { run: row, surface: QueueSurfaceWireSchema.parse({ ...base, runId: row.envelope.runId, rowRevision: row.version, actions: [cancel] }) }, reads = 0;
  const read = () => { reads++; return current; };
  const first = readAssistantSession(part, read); assert.deepEqual(first.stop, { runId: row.envelope.runId, descriptor: cancel });
  current = { run: RunRecordSchema.parse({ ...row, version: row.version + 1 }), surface: QueueSurfaceWireSchema.parse({ ...current.surface, rowRevision: row.version + 1, actions: [] }) };
  assert.equal(readAssistantSession(part, read).stop, null); assert.equal(reads, 2);
  assert.throws(() => readAssistantSession(part, () => ({ ...current, run: row })));
  assert.throws(() => readAssistantSession(part, () => undefined));
  assert.throws(() => readAssistantSession(part, () => ({ ...current, surface: QueueSurfaceWireSchema.parse({ ...current.surface, itemId: randomUUID() }) })));
  const cancelling = { ...row, cancelRequested: true as const };
  assert.equal(readAssistantSession(part, () => ({ run: cancelling, surface: QueueSurfaceWireSchema.parse({ ...base, runId: row.envelope.runId, rowRevision: row.version, status: "cancelling", actions: [cancel] }) })).stop, null);
  const terminal = RunRecordSchema.parse({ ...row, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: at } });
  const finished = QueueSurfaceWireSchema.parse({ ...base, runId: row.envelope.runId, rowRevision: row.version, status: "cancelled", endedAt: { state: "present", value: at }, actions: [] });
  assert.equal(readAssistantSession(part, () => ({ run: terminal, surface: finished })).stop, null);
  assert.throws(() => readAssistantSession(part, () => ({ ...current, run: RunRecordSchema.parse({ ...current.run, envelope: { ...row.envelope, runId: randomUUID() } }) })));
});


it("keeps workbook and attachment links bound to the exact source revision, coordinates and digest", () => {
  const table = createAssistantReferenceTable(9), token = table.issue("S", "book", "Saved value"), value = "Saved value";
  const binding: ServerReplyBinding = { kind: "target", reference: token, entry: table.resolve(token, ["S"]), value,
    source: { kind: "workbook", libraryId: "book", revision: 2, sheetId: "s", rowId: "r", fieldId: "name", valueFingerprint: digest(value) },
    target: { kind: "workbook", libraryId: "book", revision: 2, location: { kind: "cell", sheetId: "s", rowId: "r", fieldId: "name" } } };
  assert.equal(resolveAssistantReply(token, table, [binding])[0]?.kind, "text");
  const pinned = table.issue("S", "book", value, value, 1);
  assert.throws(() => resolveAssistantReply(pinned, table, [{ ...binding, reference: pinned, entry: table.resolve(pinned, ["S"]) }]));
  const wrongKind = table.issue("N", "book", value);
  assert.throws(() => resolveAssistantReply(wrongKind, table, [{ ...binding, reference: wrongKind, entry: table.resolve(wrongKind, ["N"]) }]));
  assert.throws(() => resolveAssistantReply(token, table, [{ ...binding, target: { kind: "workbook", libraryId: "book", revision: 3, location: { kind: "master" } } }]));
  assert.throws(() => resolveAssistantReply(token, table, [{ ...binding, target: { kind: "workbook", libraryId: "book", revision: 2, location: { kind: "cell", sheetId: "s", rowId: "other", fieldId: "name" } } }]));
  const id = randomUUID(), file = table.issue("A", id, "PDF page"), sha256 = "1".repeat(64);
  const attachment: ServerReplyBinding = { kind: "target", reference: file, entry: table.resolve(file, ["A"]), value: "PDF page",
    source: { kind: "attachment", attachmentId: id, sha256, page: 2, valueFingerprint: digest("PDF page") }, target: { kind: "attachment", attachmentId: id, sha256, page: 2 } };
  assert.equal(resolveAssistantReply(file, table, [attachment])[0]?.kind, "text");
  assert.throws(() => resolveAssistantReply(file, table, [{ ...attachment, target: { kind: "attachment", attachmentId: id, sha256: "0".repeat(64), page: 2 } }]));
});
