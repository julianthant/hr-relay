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

it("lists only today's operator edits, with opaque local labels, and requires an explicit selection among matches", async () => {
  const rows = [
    makeRow("2026-11-06T08:00:00.000Z", "Changed Synthetic private setting"),
    makeRow("2026-11-06T08:00:00.000Z", "Changed another private setting"),
    makeRow("2026-11-06T08:00:00.000Z", "Changed another operator's setting", ActorIdSchema.parse("another-operator")),
    makeRow("2026-11-06T07:59:59.999Z", "Changed yesterday's setting"),
  ];
  const unused = () => assert.fail("read or authorization used a write owner");
  const plugin = undoPlugin({ edits: { apply: unused, notification: unused, workbooks: unused }, settingsRecord: unused, workbooks: unused,
    appliedEdits: { clock: { now: () => new Date(acceptedAt) }, list: () => rows } });
  const [list, undo] = plugin.tools;
  assert.ok(list?.kind === "read" && undo?.kind === "change");
  const context = { signal: new AbortController().signal, references: createAssistantReferenceTable(1),
    actorId, conversationId, operatorText: "Undo the setting change.", assertCurrent() {}, assertRetainedCurrent() {},
    acceptedTurn: turn(), editReads: new Map<string, string>() };
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
  const choice = { ...context, operatorText: "Undo edit 2.", acceptedTurn: turn(), editReads: new Map<string, string>() };
  assert.deepEqual(await list.invoke({}, choice), { items: [{ edit: "[[U2.g1]]", label: "Setting edit" }] });
  await assert.rejects(undo.change({ edit: "[[U1.g1]]" }, choice), AssistantToolRefusal);
  assert.equal(typeof await undo.change({ edit: "[[U2.g1]]" }, choice), "function");
});
