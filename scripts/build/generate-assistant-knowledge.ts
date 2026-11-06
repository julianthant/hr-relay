import { z } from "zod";
import configuredSources from "../../config/dashboard-workflow-sources.json";
import { DESCRIPTORS } from "../../src/backend/app/registries/workflow-registry.js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSISTANT_WORKFLOW_FACTS_PATH, assistantWorkflowFacts } from "../../src/backend/assistant/plugins/workflows/facts.js";

/** Writes (or with `check`, verifies) the hash-pinned assistant workflow facts for the served workflows. */
export function generateAssistantKnowledge(repoRoot: string, check: boolean): void {
  const target = resolve(repoRoot, ASSISTANT_WORKFLOW_FACTS_PATH);
  const sources = z.record(z.string(), z.enum(["mock", "served"])).parse(configuredSources);
  const bytes = `${assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served")).bytes}\n`;
  if (check) { if (readFileSync(target, "utf8") !== bytes) throw new Error("assistant-knowledge-stale"); }
  else writeFileSync(target, bytes, { encoding: "utf8", mode: 0o644 });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateAssistantKnowledge(resolve(import.meta.dirname, "../.."), process.argv.includes("--check"));
}
