import assert from "node:assert/strict";
import { it } from "vitest";
import { DebugEventSchema } from "../../../src/models/events/timeline.js";
import { aggregateAssistantUsage } from "../../../src/models/dashboard/assistant-usage.js";

it("admits only numeric/closed turn accounting in the dedicated assistant usage field", () => {
  const event = { category: "http", phase: "settled", area: "assistant-usage", reason: "accepted-turn",
    correlationId: "11111111-1111-4111-8111-111111111111", build: "test", pid: 1 };
  const usage = aggregateAssistantUsage([{ state: "measured", inputTokens: 2, outputTokens: 1, totalTokens: 3 }, undefined]);
  assert.deepEqual(DebugEventSchema.parse({ ...event, assistantUsage: usage }).assistantUsage, usage);
  for (const extra of [{ prompt: "PRIVATE" }, { model: "PRIVATE" }, { responseId: "PRIVATE" }, { subject: "PRIVATE" }])
    assert.equal(DebugEventSchema.safeParse({ ...event, assistantUsage: { ...usage, ...extra } }).success, false);
  assert.equal(DebugEventSchema.safeParse({ ...event, assistantUsage: { state: "pending" } }).success, false);
});
