import { z } from "zod";
import configuredSources from "../../config/dashboard-workflow-sources.json";
import { DESCRIPTORS } from "../../src/backend/app/registries/workflow-registry.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSISTANT_KNOWLEDGE_PATH, assistantKnowledgeArtifact } from "../../src/backend/assistant/context.js";

export function generateAssistantKnowledge(repoRoot: string, check: boolean): void {
  const target = resolve(repoRoot, ASSISTANT_KNOWLEDGE_PATH);
  const sources = z.record(z.string(), z.enum(["mock", "served"])).parse(configuredSources);
  const artifact = assistantKnowledgeArtifact(DESCRIPTORS.filter(descriptor => sources[descriptor.id] === "served").map(descriptor => ({ id: descriptor.id, label: descriptor.label })));
  const document = resolve(repoRoot, artifact.reference.files[0].path);
  const bytes = `${artifact.bytes}\n`, documentBytes = `${artifact.reference.files[0].text}\n`;
  if (check) {
    if (readFileSync(target, "utf8") !== bytes || readFileSync(document, "utf8") !== documentBytes) throw new Error("assistant-knowledge-stale");
  } else {
    mkdirSync(dirname(document), { recursive: true });
    writeFileSync(document, documentBytes, { encoding: "utf8", mode: 0o644 });
    writeFileSync(target, bytes, { encoding: "utf8", mode: 0o644 });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateAssistantKnowledge(resolve(import.meta.dirname, "../.."), process.argv.includes("--check"));
}
