import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { settingsPlugin } from "../../../../../src/backend/assistant/plugins/settings/index.js";
import { createAssistantReferenceTable } from "../../../../../src/backend/assistant/references.js";
import { AssistantAcceptedTurnSchema } from "../../../../../src/models/dashboard/assistant.js";
import { AssistantToolRefusal } from "../../../../../src/backend/assistant/plugins/plugin.js";
import { z } from "zod";

it("lists and reads the operator's Full access status", async () => {
  const key = "preferences.assistantFullAccess";
  const read = settingsPlugin({ settings: () => ({ preferences: { assistantFullAccess: true } }) }).tools.find(tool => tool.name === "read_settings");
  assert.ok(read?.kind === "read");
  const context = { signal: new AbortController().signal, references: createAssistantReferenceTable(1),
    actorId: "local-operator", conversationId: randomUUID(), operatorText: "Is Full access enabled?", assertCurrent() {}, assertRetainedCurrent() {} };
  const output = z.object({ settings: z.array(z.object({ key: z.string(), value: z.unknown() })) });
  assert.deepEqual(output.parse(await read.invoke({ key }, context)).settings, [{ key, value: true }]);
  const listed = output.parse(await read.invoke({ key: null }, context)).settings;
  assert.deepEqual(listed.find(setting => setting.key === key), { key, value: true });
});

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
