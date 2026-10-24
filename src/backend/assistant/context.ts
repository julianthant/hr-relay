import { createHash } from "node:crypto";
import { constants, closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { z } from "zod";
import { SETTINGS_CATALOG } from "../../models/config/catalog.js";
import { AssistantCitationSchema } from "../../models/dashboard/assistant.js";

export const PUBLIC_ASSISTANT_REPOSITORY_ID = "R_kgDOVOf3Cg";
const PathSchema = z.string().max(200).regex(/^(?:src\/(?:models|workflow-kit|workflows)\/|docs\/rebuild\/)[A-Za-z0-9_/-]+\.(?:ts|md)$/u)
  .refine(path => !path.split("/").some(part => part === ".." || part === "." || part === "") && !/(?:credential|secret|private|fixture|artifact)/iu.test(path));
const ExportSchema = z.strictObject({ repositoryId: z.string(), revision: z.string(), files: z.array(z.strictObject({
  path: PathSchema, mode: z.literal("100644"), text: z.string().min(1).max(40_000).refine(text => !Array.from(text).some(char => { const code = char.charCodeAt(0); return code >= 127 && code <= 159 || code < 32 && ![9, 10, 13].includes(code); })),
})).min(1).max(24) });
export interface AssistantContextPolicy { readonly repositoryId: string; readonly revision: string; readonly exportSha256: string }
export class AssistantContextError extends Error {
  constructor(readonly code: "ASSISTANT_CONTEXT_UNAVAILABLE" | "ASSISTANT_CONTEXT_STALE") { super(code); this.name = "AssistantContextError"; }
}
export function createAssistantContext(bytes: Uint8Array, policy: AssistantContextPolicy) {
  const fail = () => new AssistantContextError("ASSISTANT_CONTEXT_UNAVAILABLE");
  if (policy.repositoryId !== PUBLIC_ASSISTANT_REPOSITORY_ID || !/^[a-f0-9]{40}$/u.test(policy.revision)
    || !/^[a-f0-9]{64}$/u.test(policy.exportSha256) || bytes.length > 100_000
    || createHash("sha256").update(bytes).digest("hex") !== policy.exportSha256) throw fail();
  let data: z.infer<typeof ExportSchema>;
  try { data = ExportSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); } catch { throw fail(); }
  if (data.repositoryId !== policy.repositoryId || data.revision !== policy.revision
    || new Set(data.files.map(file => file.path)).size !== data.files.length) throw fail();
  const files = data.files.map(file => Object.freeze({ ...file }));
  const source = Object.freeze({ repositoryId: data.repositoryId, revision: data.revision, files: Object.freeze(files) });
  return Object.freeze({
    assertRuntime(runtime: Readonly<{ repositoryId: string; revision: string }>) {
      if (runtime.repositoryId !== source.repositoryId || runtime.revision !== source.revision) throw new AssistantContextError("ASSISTANT_CONTEXT_STALE");
    },
    reference: source,
    citation(input: unknown) {
      const parsed = AssistantCitationSchema.safeParse(input); if (!parsed.success) throw fail();
      const citation = parsed.data, file = files.find(entry => entry.path === citation.path);
      if (file === undefined || citation.revision !== source.revision || citation.endLine < citation.startLine
        || citation.endLine - citation.startLine >= 40) throw fail();
      const lines = file.text.split("\n");
      if (citation.endLine > lines.length || lines.slice(citation.startLine - 1, citation.endLine).join("\n") !== citation.quote) throw fail();
      return citation;
    },
  });
}
export type AssistantContext = ReturnType<typeof createAssistantContext>;

export const ASSISTANT_INPUT_PROJECTION_VERSION = 1;
export const ASSISTANT_KNOWLEDGE_PATH = "src/backend/assistant/generated-knowledge.json";
const APPLICATION_HELP = {
  permissions: "Assistant actions use the current operator grant. Required confirmation never comes from the model. Authentication and protected values stay in the operator interface.",
  notifications: "Notifications can be marked read, unread, snoozed or unsnoozed through their canonical command owner. Notification text and linked HR records stay local.",
  "dry-run": "A workflow dry run requires the selected subject and a current canonical plan. It stops before the external transaction commit. Workflow actions require the dashboard Run interface.",
  settings: "Ordinary settings use their canonical save command. Protected settings and account authentication require operator entry. Settings changes require the Settings interface.",
} as const;
export const ASSISTANT_SAFE_KNOWLEDGE: Readonly<Record<string, string>> = Object.freeze({
  ...APPLICATION_HELP,
  ...Object.fromEntries(SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings" && row.sensitivity === "ordinary" && row.editability === "operator")
    .map(row => [`setting ${row.key}`, `The ordinary setting ${row.key} is changed through Settings. Its saved value stays local; use the operator interface to inspect or change it.`])),
});

export function assistantKnowledgeArtifact(workflows: readonly Readonly<{ id: string; label: string }>[] = []) {
  const declarations = z.array(z.strictObject({ id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u), label: z.string().min(1).max(160).regex(/^[A-Za-z0-9 ()/—–-]+$/u) })).parse(workflows);
  if (new Set(declarations.map(entry => entry.id)).size !== declarations.length) throw new AssistantContextError("ASSISTANT_CONTEXT_UNAVAILABLE");
  const knowledge = Object.freeze({ ...ASSISTANT_SAFE_KNOWLEDGE, ...Object.fromEntries(declarations.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(entry => [`workflow ${entry.id}`, `${entry.label} is a served workflow. Use dashboard Run with the selected subject and a current plan. Assistant workflow execution is unavailable until subject binding is implemented.`])) });
  const topics = Object.keys(knowledge);
  if (new Set(topics.map(topic => topic.toLowerCase())).size !== topics.length) throw new AssistantContextError("ASSISTANT_CONTEXT_UNAVAILABLE");
  const text = Object.entries(knowledge).map(([topic, body]) => `${topic}: ${body}`).join("\n");
  const revision = createHash("sha256").update(text).digest("hex").slice(0, 40);
  const reference = { repositoryId: PUBLIC_ASSISTANT_REPOSITORY_ID, revision,
    files: [{ path: "docs/rebuild/reference/assistant-knowledge.md", mode: "100644", text }] };
  const bytes = canonicalJsonStringify(reference);
  const policy = { repositoryId: reference.repositoryId, revision, exportSha256: createHash("sha256").update(bytes).digest("hex") };
  return { policy, reference, bytes, topics: knowledge };
}

function readKnowledgeBytes(path: string): string {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(100_001);
    const size = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, size).toString("utf8");
  } finally { closeSync(descriptor); }
}

export function loadProductionAssistantContext(repoRoot: string, expected: ReturnType<typeof assistantKnowledgeArtifact> = assistantKnowledgeArtifact()): AssistantContext {
  if (readKnowledgeBytes(join(repoRoot, ASSISTANT_KNOWLEDGE_PATH)) !== `${expected.bytes}\n`
    || readKnowledgeBytes(join(repoRoot, expected.reference.files[0].path)) !== `${expected.reference.files[0].text}\n`) {
    throw new AssistantContextError("ASSISTANT_CONTEXT_UNAVAILABLE");
  }
  return createAssistantContext(Buffer.from(expected.bytes), expected.policy);
}
