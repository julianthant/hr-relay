/** Presentation authority shared by the command executor and SQLite adapter. */
import { z } from "zod";
import { FingerprintSchema } from "../ids.js";
import { ExplorerOverrideDocumentSchema } from "./explorer.js";
import { canonicalJsonStringify } from "../canonical-json.js";
import { sha256Hex } from "../sha256.js";
import { ExplorerEditApplyRequestSchema, type ExplorerEditApplyRequest, type ExplorerWorkflowOverride } from "./explorer.js";

export interface ExplorerOverrideReader {
  read(workflowId: string): ExplorerWorkflowOverride | undefined;
  readAll(): readonly ExplorerWorkflowOverride[];
}

export interface ExplorerOverrideRepository extends ExplorerOverrideReader {
  /** Only inside the command owner's authority transaction, before its audit. */
  replace(command: ExplorerEditApplyRequest, override: ExplorerWorkflowOverride): ExplorerWorkflowOverride;
}

export class ExplorerOverrideConflictError extends Error {
  constructor(workflowId: string, expectedRevision: number, readonly currentRevision: number) {
    super(`Explorer override ${workflowId} is revision ${String(currentRevision)}, not expected revision ${String(expectedRevision)}`);
    this.name = "ExplorerOverrideConflictError";
  }
}

/** Preserve the released complete-envelope fingerprint, including actor and reason. */
export function explorerEditCommandFingerprint(command: ExplorerEditApplyRequest): string {
  return sha256Hex(`hrauto:explorer-edit-command:v2\0${canonicalJsonStringify(ExplorerEditApplyRequestSchema.parse(command))}`);
}

/** Reconstruct only the closed hot-apply subset; source-only edits cannot become overrides. */
export function applyExplorerPresentationChanges(
  previous: ExplorerWorkflowOverride["presentation"], command: ExplorerEditApplyRequest,
): ExplorerWorkflowOverride["presentation"] {
  const presentation = { ...previous };
  for (const change of command.payload.changes) {
    switch (change.kind) {
      case "workflow-label": presentation.label = change.value; break;
      case "workflow-icon": presentation.icon = change.value; break;
      case "workflow-category": presentation.category = change.value; break;
      default: throw new Error(`explorer-override-non-presentation-command: ${change.kind}`);
    }
  }
  return presentation;
}

/** The committed receipt retains source values and raw identity for recovery. */
export const ExplorerOverrideImportSourceSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("present"), sha256: FingerprintSchema,
    byteLength: z.number().int().nonnegative(), document: ExplorerOverrideDocumentSchema }),
]);
export type ExplorerOverrideImportSource = z.infer<typeof ExplorerOverrideImportSourceSchema>;
export const ExplorerOverrideImportReceiptSchema = z.strictObject({
  format: z.literal(1), sourceDatabaseIdentity: FingerprintSchema,
  backupSha256: z.union([z.literal("fresh"), FingerprintSchema]),
  source: ExplorerOverrideImportSourceSchema,
});
