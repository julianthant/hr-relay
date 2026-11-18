import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import configuredSources from "../../../../../config/dashboard-workflow-sources.json";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { ASSISTANT_WORKFLOW_FACTS_PATH, AssistantWorkflowFactsError, assistantWorkflowFacts, loadAssistantWorkflowFacts } from "../../../../../src/backend/assistant/plugins/workflows/facts.js";
import { workflowsPlugin } from "../../../../../src/backend/assistant/plugins/workflows/index.js";
import { createAssistantReferenceTable } from "../../../../../src/backend/assistant/references.js";

const served = () => {
  const sources = z.record(z.string(), z.enum(["mock", "served", "hidden"])).parse(configuredSources);
  return DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served");
};

it("loads the committed workflow facts for every served workflow", () => {
  assert.equal(loadAssistantWorkflowFacts(resolve(import.meta.dirname, "../../../../.."), served()).sha256, assistantWorkflowFacts(served()).sha256);
});

it.each([
  ["i9-check-start", "dashboard-upload", "unavailable"],
  ["emergency-contact", "dashboard-upload", "unavailable"],
  ["onboarding", "dashboard-input", "unavailable"],
  ["work-study", "dashboard-input", "check-run"],
  ["person-lookup", "live-read", "check-run"],
  ["separations", "dry-run", "check-run"],
])("describes %s fresh-start and rerun capability for chat", async (workflow, start, rerun) => {
  const facts = assistantWorkflowFacts(served());
  const [describe] = workflowsPlugin(() => facts).tools;
  assert.ok(describe?.kind === "read");
  const result = z.object({ start: z.unknown(), rerun: z.unknown() }).parse(await describe.invoke({ workflow }, {
    signal: new AbortController().signal, references: createAssistantReferenceTable(1), actorId: "local-operator", conversationId: "chat",
    operatorText: "", assertCurrent() {}, assertRetainedCurrent() {},
  }));
  assert.deepEqual(result, { start, rerun });
});

it("names the served workflow whose committed facts are stale", () => {
  const root = mkdtempSync(join(tmpdir(), "assistant-facts-")), path = join(root, ASSISTANT_WORKFLOW_FACTS_PATH);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const current = assistantWorkflowFacts(served()), stale = structuredClone(current.facts);
    const changed = stale.find(entry => entry.steps.length > 1);
    assert.ok(changed);
    changed.steps.pop();
    writeFileSync(path, `${JSON.stringify({ format: 1, workflows: stale })}\n`);
    assert.throws(() => loadAssistantWorkflowFacts(root, served()), (error: unknown) =>
      error instanceof AssistantWorkflowFactsError && error.code === "ASSISTANT_WORKFLOW_FACTS_STALE" && error.workflowId === changed.id);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("reports a stored row no served workflow has without repeating its id", () => {
  const root = mkdtempSync(join(tmpdir(), "assistant-facts-")), path = join(root, ASSISTANT_WORKFLOW_FACTS_PATH);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const current = assistantWorkflowFacts(served());
    writeFileSync(path, `${JSON.stringify({ format: 1, workflows: [...current.facts, { id: "PRIVATE_CANARY" }] })}\n`);
    assert.throws(() => loadAssistantWorkflowFacts(root, served()), (error: unknown) =>
      error instanceof AssistantWorkflowFactsError && error.code === "ASSISTANT_WORKFLOW_FACTS_STALE" && error.workflowId === undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
