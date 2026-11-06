import configuredSources from "../../../config/dashboard-workflow-sources.json";
import { z } from "zod";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { generateAssistantKnowledge } from "../../../scripts/build/generate-assistant-knowledge.js";
import { ASSISTANT_WORKFLOW_FACTS_PATH, assistantWorkflowFacts, loadAssistantWorkflowFacts } from "../../../src/backend/assistant/plugins/workflows/facts.js";

const served = () => {
  const sources = z.record(z.string(), z.enum(["mock", "served"])).parse(configuredSources);
  return DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served");
};

it("generates the pinned served workflow facts and refuses missing, stale or substituted output", () => {
  const root = mkdtempSync(join(tmpdir(), "assistant-facts-")), path = join(root, ASSISTANT_WORKFLOW_FACTS_PATH);
  try {
    mkdirSync(dirname(path), { recursive: true });
    assert.throws(() => generateAssistantKnowledge(root, true));
    assert.throws(() => loadAssistantWorkflowFacts(root, served()));
    generateAssistantKnowledge(root, false);
    generateAssistantKnowledge(root, true);
    const facts = assistantWorkflowFacts(served());
    assert.equal(readFileSync(path, "utf8"), `${facts.bytes}\n`);
    assert.equal(loadAssistantWorkflowFacts(root, served()).sha256, facts.sha256);
    writeFileSync(path, `${facts.bytes} \n`);
    assert.throws(() => generateAssistantKnowledge(root, true), /assistant-knowledge-stale/u);
    assert.throws(() => loadAssistantWorkflowFacts(root, served()), /assistant-workflow-facts-stale/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("derives every served workflow's facts from its registered definition", () => {
  const descriptors = served(), facts = assistantWorkflowFacts(descriptors);
  assert.deepEqual(facts.facts.map(entry => entry.id), descriptors.map(descriptor => descriptor.id).toSorted());
  for (const descriptor of descriptors) {
    const entry = facts.facts.find(candidate => candidate.id === descriptor.id); assert.ok(entry);
    assert.equal(entry.label, descriptor.label);
    assert.deepEqual(entry.steps.map(step => step.label), descriptor.timeline.map(step => step.label));
    assert.equal(entry.input?.placeholder, descriptor.surfaces.inputRun?.placeholder);
  }
  assert.notEqual(assistantWorkflowFacts(descriptors.slice(1)).sha256, facts.sha256);
});
