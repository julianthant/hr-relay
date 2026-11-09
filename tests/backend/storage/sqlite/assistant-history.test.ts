import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { assistantMessageFromRow, convertAssistantHistoryPayloadToM1 } from "../../../../src/backend/storage/sqlite/assistant-history.js";
import { ASSISTANT_HISTORY_METADATA_MAX_UNITS, assistantReplyDisplayUnits } from "../../../../src/models/dashboard/assistant.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

it("converts exact predecessor display text to inert history without interpreting it or mutating the input", () => {
  for (const text of ["", " \t\r\n", "**Filed by you**\n[[P1.g1]]\nhttps://example.invalid", "😀é\u0301", "x".repeat(8000)]) {
    const input = Object.freeze({ text }), converted = convertAssistantHistoryPayloadToM1(input);
    assert.deepEqual(converted, { parts: text === "" ? [] : [{ kind: "text", runs: [{ kind: "plain", text }] }], recording: { kind: "unrecorded", usage: { state: "unrecorded" } } });
    assert.equal(assistantReplyDisplayUnits(converted.parts), text.length);
    assert.deepEqual(input, { text });
  }
  for (const input of [undefined, null, {}, { text: null }, { text: 1 }, { text: "x".repeat(8001) }, { text: "", parts: [] }, { text: "", recording: { kind: "accepted-turn" } }])
    assert.throws(() => convertAssistantHistoryPayloadToM1(input));
});

it("converts payloads from all five current message kinds without activating a new row reader", () => {
  for (const kind of ["turn", "answer", "proposal", "decision", "inert"] as const) for (const text of ["", "Exact\r\ncaption [[R1.g1]]"]) {
    const row = { id: randomUUID(), conversation_id: randomUUID(), ordinal: 1, role: kind === "turn" ? "operator" : "assistant", kind,
      model_text: kind === "inert" ? null : "Replay [[R1.g1]]", subject_ref: null,
      action_id: kind === "proposal" || kind === "decision" ? randomUUID() : null,
      delivery: kind === "turn" ? "sending" : "settled", code: null,
      payload_json: canonicalJsonStringify({ text }), created_at: "2026-11-08T12:00:00.000Z", updated_at: "2026-11-08T12:00:00.000Z" };
    const before = assistantMessageFromRow(row), converted = convertAssistantHistoryPayloadToM1(JSON.parse(row.payload_json));
    assert.equal(before.kind, kind); assert.equal(before.text, text);
    assert.equal(assistantReplyDisplayUnits(converted.parts), before.text.length);
    assert.throws(() => assistantMessageFromRow({ ...row, payload_json: canonicalJsonStringify(converted) }), "next payload is not activated as a current reader or fallback");
  }
});

it("preserves the visible-text profile boundary without charging historical JSON framing or unknown metadata", () => {
  const titles = "AB", rows = Array.from({ length: 250 }, (_, index) => ({ text: "x".repeat(index === 249 ? 7998 : 8000) }));
  const oldUnits = titles.length + rows.reduce((units, row) => units + row.text.length, 0);
  const nextUnits = titles.length + rows.reduce((units, row) => units + assistantReplyDisplayUnits(convertAssistantHistoryPayloadToM1(row).parts), 0);
  assert.equal(oldUnits, ASSISTANT_HISTORY_METADATA_MAX_UNITS); assert.equal(nextUnits, oldUnits);
  const over = nextUnits + assistantReplyDisplayUnits(convertAssistantHistoryPayloadToM1({ text: "x" }).parts);
  assert.equal(over, ASSISTANT_HISTORY_METADATA_MAX_UNITS + 1);
  assert.ok(over > ASSISTANT_HISTORY_METADATA_MAX_UNITS, "the counter does not grant a new quota or grace unit");
});
