import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import configuredSources from "../../../config/dashboard-workflow-sources.json";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { ASSISTANT_WORKFLOW_FACTS_PATH, AssistantWorkflowFactsError, assistantWorkflowFacts, loadAssistantWorkflowFacts } from "../../../src/backend/assistant/plugins/workflows/facts.js";

const served = () => {
  const sources = z.record(z.string(), z.enum(["mock", "served", "hidden"])).parse(configuredSources);
  return DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served");
};

it("loads the committed workflow facts for every served workflow", () => {
  assert.equal(loadAssistantWorkflowFacts(resolve(import.meta.dirname, "../../.."), served()).sha256, assistantWorkflowFacts(served()).sha256);
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
