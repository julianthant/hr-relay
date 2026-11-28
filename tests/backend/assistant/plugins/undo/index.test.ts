import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { assistantValueBindings } from "../../../../../src/backend/app/composition/dashboard/assistant.js";
import { AssistantToolRefusal } from "../../../../../src/backend/assistant/plugins/plugin.js";
import { undoPlugin } from "../../../../../src/backend/assistant/plugins/undo/index.js";
import { createAssistantReferenceTable } from "../../../../../src/backend/assistant/references.js";
import { resolveAssistantReply } from "../../../../../src/backend/assistant/replies.js";
import type { AssistantAppliedEdit } from "../../../../../src/backend/storage/sqlite/assistant-applied-edits.js";
import { AssistantAcceptedTurnSchema } from "../../../../../src/models/dashboard/assistant.js";
import { NotificationRecordSchema, type NotificationRecord } from "../../../../../src/models/notifications/notifications.js";
import { ActorIdSchema, IsoInstantSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";

const actorId = ActorIdSchema.parse("local-operator");
const conversationId = randomUUID(), profileId = randomUUID();
const acceptedAt = "2026-11-06T08:01:00.000Z";
const turn = () => AssistantAcceptedTurnSchema.parse({ conversationId, messageId: randomUUID(), profileId, epoch: 1,
  acceptedAt, ordinal: 1, acceptedRevision: 2, proposalAnswer: null });
const makeRow = (committedAt: string, label: string, actor = actorId): AssistantAppliedEdit => ({
  id: randomUUID(), actorId: actor, committedAt: IsoInstantSchema.parse(committedAt), turn: turn(), label,
  details: { kind: "settings", command: "apply-settings", path: "browser.headless", revision: PositiveIntSchema.parse(2),
    prior: { clear: true }, next: { set: false } },
});

const unused = () => assert.fail("unexpected owner operation");
function fixture(rows: readonly AssistantAppliedEdit[], notification: (id: string) => NotificationRecord | undefined = unused) {
  const plugin = undoPlugin({ edits: { apply: unused, notification, workbooks: unused }, settingsRecord: unused, workbooks: unused,
    appliedEdits: { clock: { now: () => new Date(acceptedAt) }, list: () => rows } });
  const [list, undo] = plugin.tools;
  assert.ok(list?.kind === "read" && undo?.kind === "change");
  const references = createAssistantReferenceTable(1);
  const contextFor = (operatorText: string) => ({ signal: new AbortController().signal, references, actorId, conversationId,
    operatorText, assertCurrent() {}, assertRetainedCurrent() {}, acceptedTurn: turn(), editReads: new Map<string, string>() });
  return { list, undo, references, contextFor };
}

it("lists only today's operator edits, with opaque local labels, and requires an explicit selection among matches", async () => {
  const rows = [
    makeRow("2026-11-06T08:00:00.000Z", "Changed Synthetic private setting"),
    makeRow("2026-11-06T08:00:00.000Z", "Changed another private setting"),
    makeRow("2026-11-06T08:00:00.000Z", "Changed another operator's setting", ActorIdSchema.parse("another-operator")),
    makeRow("2026-11-06T07:59:59.999Z", "Changed yesterday's setting"),
  ];
  const { list, undo, contextFor } = fixture(rows);
  const context = contextFor("Undo the setting change.");
  assert.deepEqual(await list.invoke({}, context), { items: [
    { edit: "[[U1.g1]]", label: "Setting edit" }, { edit: "[[U2.g1]]", label: "Setting edit" },
  ] });
  await assert.rejects(undo.change({ edit: "[[U1.g1]]" }, context),
    error => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_EDIT_REFUSED");
  assert.deepEqual(resolveAssistantReply("- [[U1.g1]]\n- [[U2.g1]]\nWhich edit should I undo?", context.references,
    assistantValueBindings(context.references)), [
    { kind: "bullets", items: [[{ kind: "value", value: "Edit 1 — Changed Synthetic private setting" }],
      [{ kind: "value", value: "Edit 2 — Changed another private setting" }]] },
    { kind: "text", runs: [{ kind: "plain", text: "Which edit should I undo?" }] },
  ]);
  const choice = contextFor("Undo edit 2.");
  assert.deepEqual(await list.invoke({}, choice), { items: [{ edit: "[[U2.g1]]", label: "Setting edit" }] });
  await assert.rejects(undo.change({ edit: "[[U1.g1]]" }, choice), AssistantToolRefusal);
  assert.equal(typeof await undo.change({ edit: "[[U2.g1]]" }, choice), "function");
});

it("refuses the latest edit when a newer named-version creation has no inverse", async () => {
  const older = makeRow("2026-11-06T08:00:00.000Z", "Changed Headless browser");
  const newer: AssistantAppliedEdit = { ...makeRow("2026-11-06T08:00:30.000Z", "Named a version of the tracker"),
    details: { kind: "spreadsheets", libraryId: randomUUID(), command: "create-version",
      location: { kind: "version", versionId: randomUUID() },
      ownerRevision: { version: PositiveIntSchema.parse(1), revision: PositiveIntSchema.parse(2) },
      prior: null, next: { name: "Synthetic version" } } };
  const { list, undo, contextFor } = fixture([older, newer]);
  const latest = contextFor("Undo the latest edit.");
  const before = contextFor("Undo the setting change.");
  assert.deepEqual(await list.invoke({}, before), { items: [{ edit: "[[U1.g1]]", label: "Setting edit" }] });
  assert.deepEqual(await list.invoke({}, latest), { items: [], notice: "latest-unsupported" });
  await assert.rejects(undo.change({ edit: "[[U1.g1]]" }, latest),
    error => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_EDIT_REFUSED");
});

it("selects the newest supported edit from the operator's own scoped history", async () => {
  const older = makeRow("2026-11-06T08:00:00.000Z", "Changed Synthetic setting");
  const newer = makeRow("2026-11-06T08:00:30.000Z", "Changed Headless browser");
  const foreign = makeRow("2026-11-06T08:00:45.000Z", "Changed a different setting", ActorIdSchema.parse("another-operator"));
  const { list, undo, contextFor, references } = fixture([older, foreign, newer]);
  const latest = contextFor("Undo the last change.");
  assert.deepEqual(await list.invoke({}, latest), { items: [{ edit: "[[U1.g1]]", label: "Setting edit" }] });
  assert.equal(references.resolve("[[U1.g1]]", ["U"]).target, newer.id);
  assert.equal(typeof await undo.change({ edit: "[[U1.g1]]" }, latest), "function");
});

it("distinguishes notification choices by their local titles without including titles in tool output", async () => {
  const notices = ["Synthetic upload warning", "Synthetic review reminder"].map(title => NotificationRecordSchema.parse({
    notificationId: randomUUID(), actorId, dedupeFingerprint: "a".repeat(64), trigger: "command", channel: "ping",
    status: "read", snooze: { state: "not-snoozed" }, title, summary: "Synthetic summary",
    links: [{ kind: "command-result", commandId: randomUUID() }], count: 1, lastSeenAt: acceptedAt,
    version: 2, createdAt: acceptedAt, updatedAt: acceptedAt,
  }));
  const rows: AssistantAppliedEdit[] = notices.map(notice => ({
    ...makeRow("2026-11-06T08:00:00.000Z", "Changed the notification"),
    details: { kind: "notifications", notificationId: notice.notificationId, command: "notification-read", revision: notice.version,
      prior: { status: "unread", snooze: notice.snooze }, next: { status: "read", snooze: notice.snooze } },
  }));
  const { list, undo, references, contextFor } = fixture(rows, id => notices.find(notice => notice.notificationId === id));
  const context = contextFor("Undo the notification change.");
  assert.deepEqual(await list.invoke({}, context), { items: [
    { edit: "[[U1.g1]]", label: "Notification edit" }, { edit: "[[U2.g1]]", label: "Notification edit" },
  ] });
  assert.deepEqual(resolveAssistantReply("- [[U1.g1]]\n- [[U2.g1]]\nWhich edit should I undo?", references, assistantValueBindings(references)), [
    { kind: "bullets", items: [[{ kind: "value", value: "Edit 1 — Changed the notification — Synthetic upload warning" }],
      [{ kind: "value", value: "Edit 2 — Changed the notification — Synthetic review reminder" }]] },
    { kind: "text", runs: [{ kind: "plain", text: "Which edit should I undo?" }] },
  ]);
  const narrowed = contextFor("Undo notification Synthetic review reminder.");
  assert.deepEqual(await list.invoke({}, narrowed), { items: [{ edit: "[[U2.g1]]", label: "Notification edit" }] });
  assert.equal(typeof await undo.change({ edit: "[[U2.g1]]" }, narrowed), "function");
});

it("bounds 21 matching choices and lets the operator name an edit beyond the initial list", async () => {
  const rows = Array.from({ length: 21 }, (_, index) =>
    makeRow("2026-11-06T08:00:00.000Z", index === 20 ? "Changed Headless browser" : `Changed Synthetic setting ${String(index + 1)}`));
  const { list, undo, contextFor, references } = fixture(rows);
  const broad = contextFor("Undo the setting change.");
  assert.deepEqual(await list.invoke({}, broad), { notice: "more-matches",
    items: Array.from({ length: 20 }, (_, index) => ({ edit: `[[U${String(index + 1)}.g1]]`, label: "Setting edit" })) });
  assert.equal(references.issued().length, 20);
  await assert.rejects(undo.change({ edit: "[[U1.g1]]" }, broad), AssistantToolRefusal);
  const narrowed = contextFor("Undo the change to Headless browser.");
  assert.deepEqual(await list.invoke({}, narrowed), { items: [{ edit: "[[U21.g1]]", label: "Setting edit" }] });
  assert.equal(typeof await undo.change({ edit: "[[U21.g1]]" }, narrowed), "function");
});
