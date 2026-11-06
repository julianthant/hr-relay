import assert from "node:assert/strict";
import { it } from "vitest";
import { ASSISTANT_EFFORT_LABELS, assistantModelLabel } from "../../../src/models/config/assistant-model-preference.js";

it("shows model slugs and efforts by their display names", () => {
  assert.equal(assistantModelLabel("gpt-6.1-sol"), "GPT-6.1 Sol");
  assert.equal(assistantModelLabel("gpt-5.6-terra"), "GPT-5.6 Terra");
  assert.equal(assistantModelLabel("gpt-6"), "GPT-6");
  assert.deepEqual(Object.values(ASSISTANT_EFFORT_LABELS), ["Low", "Medium", "High"]);
});
