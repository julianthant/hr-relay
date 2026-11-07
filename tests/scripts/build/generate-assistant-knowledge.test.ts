import configuredSources from "../../../config/dashboard-workflow-sources.json";
import { z } from "zod";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { generateAssistantKnowledge } from "../../../scripts/build/generate-assistant-knowledge.js";
import { ASSISTANT_KNOWLEDGE_PATH, assistantKnowledgeArtifact, loadProductionAssistantContext } from "../../../src/backend/assistant/context.js";

it("generates only the canonical bounded plain knowledge and rejects missing, stale or substituted output", () => {
  const root = mkdtempSync(join(tmpdir(), "assistant-knowledge-")), path = join(root, ASSISTANT_KNOWLEDGE_PATH);
  try {
    mkdirSync(dirname(path), { recursive: true });
    assert.throws(() => generateAssistantKnowledge(root, true));
    generateAssistantKnowledge(root, false);
    generateAssistantKnowledge(root, true);
    const sources = z.record(z.string(), z.enum(["mock", "served"])).parse(configuredSources);
    const artifact = assistantKnowledgeArtifact(DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served").map(descriptor => ({ id: descriptor.id, label: descriptor.label })));
    assert.equal(readFileSync(path, "utf8"), `${artifact.bytes}\n`);
    const context = loadProductionAssistantContext(root, artifact);
    context.assertRuntime(artifact.policy);
    const file = context.reference.files[0]; assert.ok(file);
    const quote = file.text.split("\n")[0]; assert.ok(quote);
    assert.equal(context.citation({ path: file.path, revision: artifact.policy.revision, startLine: 1, endLine: 1, quote }).quote, quote);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, `${original} `);
    assert.throws(() => generateAssistantKnowledge(root, true), /assistant-knowledge-stale/u);
    assert.throws(() => loadProductionAssistantContext(root, artifact));
    generateAssistantKnowledge(root, false);
    assert.equal(readFileSync(path, "utf8"), original);
    const document = join(root, file.path);
    writeFileSync(document, "Substituted plain knowledge.\n");
    assert.throws(() => generateAssistantKnowledge(root, true), /assistant-knowledge-stale/u);
    assert.throws(() => loadProductionAssistantContext(root, artifact));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
