import assert from "node:assert/strict";
import { it } from "vitest";
import { assistantSurfaceCoverage, localAssistantIntent } from "../../../src/backend/assistant/tools.js";
import { SETTINGS_CATALOG } from "../../../src/models/config/catalog.js";
import { assistantKnowledgeArtifact, ASSISTANT_SAFE_KNOWLEDGE } from "../../../src/backend/assistant/context.js";
import { AssistantLocalIntentError } from "../../../src/backend/assistant/service.js";

it("accepts only finite local intents without forwarding arbitrary text or selected subjects", () => {
  assert.deepEqual(localAssistantIntent({ message: " HELP permissions " }), { kind: "help", topic: "permissions" });
  assert.deepEqual(localAssistantIntent({ message: "mark notifications read" }), { kind: "notification", action: "notification-read-all" });
  for (const message of ["", "help unknown", "help permissions then submit", "run person lookup", "private arbitrary request", "mark notifications read for someone"]) {
    assert.throws(() => localAssistantIntent({ message }), AssistantLocalIntentError);
  }
  assert.throws(() => localAssistantIntent({ message: "help permissions", subjectRef: "selected-object" }), AssistantLocalIntentError);
});

it("accounts for every actual registered route as a handoff without promoting route registration to tool authority", () => {
  const coverage = assistantSurfaceCoverage([{ method: "ALL", path: "/api/*" }, { method: "POST", path: "/api/v1/profile/sign-in" },
    { method: "GET", path: "/api/v1/data" }, { method: "POST", path: "/api/v1/profile/sign-in" }]);
  assert.equal(coverage.length, 2);
  assert.equal(coverage.every(entry => entry.availability === "handoff" && entry.reason === "operator-interface-required"), true);
  assert.deepEqual(coverage.map(entry => entry.method), ["GET", "POST"]);
});

it("projects only ordinary editable catalog identities into finite setting help without values or deployment metadata", () => {
  const ordinary = SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings" && row.sensitivity === "ordinary" && row.editability === "operator");
  assert.ok(ordinary.length > 0);
  const topics = Object.keys(ASSISTANT_SAFE_KNOWLEDGE).filter(topic => topic.startsWith("setting "));
  assert.deepEqual(topics, ordinary.map(row => `setting ${row.key}`));
  for (const topic of topics) assert.deepEqual(localAssistantIntent({ message: `help ${topic}` }), { kind: "help", topic });
  for (const row of SETTINGS_CATALOG.filter(row => row.sensitivity !== "ordinary")) {
    assert.throws(() => localAssistantIntent({ message: `help setting ${row.key}` }), AssistantLocalIntentError);
  }
  const artifact = assistantKnowledgeArtifact();
  assert.ok(Buffer.byteLength(artifact.bytes) < 100_000);
  assert.equal(artifact.reference.files.length, 1);
  const text = artifact.reference.files[0].text;
  assert.ok(text.length < 40_000);
  assert.equal(text.includes("sourceClass"), false);
  assert.equal(text.includes("consumers"), false);
});
