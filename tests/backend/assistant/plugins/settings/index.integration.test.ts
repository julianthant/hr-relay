import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { settingsPlugin } from "../../../../../src/backend/assistant/plugins/settings/index.js";
import { createAssistantReferenceTable } from "../../../../../src/backend/assistant/references.js";
import { AssistantAcceptedTurnSchema } from "../../../../../src/models/dashboard/assistant.js";
import { AssistantToolRefusal } from "../../../../../src/backend/assistant/plugins/plugin.js";

it.each([
  { name: "a setting value with no source", key: "browser.headless", source: null,
    operatorText: "Set headless mode appropriately.", code: "ASSISTANT_VALUE_NEEDS_SOURCE" },
  { name: "a change to the operator's Full access permission", key: "preferences.assistantFullAccess", source: "enable",
    operatorText: "Please enable Full access.", code: "ASSISTANT_EDIT_REFUSED" },
])("refuses $name", async ({ key, source, operatorText, code }) => {
  const plugin = settingsPlugin({
    settings: () => ({ browser: { headless: false } }),
    settingsRecord: () => { throw new Error("refused edit read settings"); },
    edits: { apply: () => { throw new Error("refused edit reached the owner"); },
      notification: () => undefined, workbooks: () => { throw new Error("workbook owner unused"); } },
  });
  const change = plugin.tools.find(tool => tool.name === "change_settings");
  assert.equal(change?.kind, "change");
  if (change?.kind !== "change") throw new Error("settings change tool unavailable");
  const conversationId = randomUUID();
  await assert.rejects(change.change({ key, operation: "enable", source }, {
    signal: new AbortController().signal, references: createAssistantReferenceTable(1),
    actorId: "local-operator", operatorText, conversationId,
    assertCurrent() {}, assertRetainedCurrent() {},
    acceptedTurn: AssistantAcceptedTurnSchema.parse({ conversationId, messageId: randomUUID(), profileId: randomUUID(), epoch: 1,
      acceptedAt: "2026-10-12T12:00:00.000Z", ordinal: 1, acceptedRevision: 2, proposalAnswer: null }),
    editReads: new Map(),
  }), (error: unknown) => error instanceof AssistantToolRefusal && error.code === code);
});
