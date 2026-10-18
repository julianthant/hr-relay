import { createHash } from "node:crypto";
import { z } from "zod";
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
