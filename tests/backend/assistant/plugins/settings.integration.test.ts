import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { settingsPlugin } from "../../../../src/backend/assistant/plugins/settings/index.js";
import { createAssistantReferenceTable } from "../../../../src/backend/assistant/references.js";
import { AssistantToolRefusal } from "../../../../src/backend/assistant/plugins/plugin.js";

it("refuses a setting value with no source in the operator's request", async () => {
  const plugin = settingsPlugin({
    settings: () => ({ browser: { headless: false } }),
    settingsRecord: () => { throw new Error("an unsourced edit read settings"); },
    edits: { apply: () => { throw new Error("an unsourced edit reached the owner"); },
      notification: () => undefined, workbooks: () => { throw new Error("workbook owner unused"); } },
  });
  const change = plugin.tools.find(tool => tool.name === "change_settings");
  assert.equal(change?.kind, "change");
  if (change?.kind !== "change") throw new Error("settings change tool unavailable");
  const conversationId = randomUUID();
  await assert.rejects(change.change({ key: "browser.headless", operation: "enable", source: null }, {
    signal: new AbortController().signal, references: createAssistantReferenceTable(1),
    actorId: "local-operator", operatorText: "Set headless mode appropriately.", conversationId,
    assertCurrent() {}, assertRetainedCurrent() {},
    acceptedTurn: { conversationId, messageId: randomUUID(), profileId: randomUUID(), epoch: 1,
      acceptedAt: "2026-10-12T12:00:00.000Z", ordinal: 1, acceptedRevision: 2, proposalAnswer: null },
    editReads: new Map(),
  }), (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_VALUE_NEEDS_SOURCE");
});
