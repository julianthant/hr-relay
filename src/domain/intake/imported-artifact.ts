import { z } from "zod";
import { FingerprintSchema, IsoInstantSchema, WorkflowIdSchema } from "../ids.js";
import { IntakeSessionSchema } from "./session.js";
import { IntakePlanManifestSchema } from "./manifest.js";

/** Historical JSON is retained verbatim; old identifiers are lookup keys on this one import. */
export const ImportedArtifactSchema = z.strictObject({
  format: z.literal(1),
  importId: z.uuid(),
  sessionId: z.uuid().nullable(),
  manifestId: z.uuid().nullable(),
  workflow: WorkflowIdSchema,
  sourceSha256: FingerprintSchema,
  preparationJson: z.string().nullable(),
  submittedJson: z.string().nullable(),
  createdAt: IsoInstantSchema,
}).superRefine((record, context) => {
  try { validateImportedArtifact(record); }
  catch { context.addIssue({ code: "custom", message: "imported-artifact-linkage-invalid" }); }
});
export type ImportedArtifact = z.infer<typeof ImportedArtifactSchema>;

function validateImportedArtifact(record: ImportedArtifact): void {
  const session = record.preparationJson === null ? null : IntakeSessionSchema.parse(JSON.parse(record.preparationJson));
  const manifest = record.submittedJson === null ? null : IntakePlanManifestSchema.parse(JSON.parse(record.submittedJson));
  if (session === null && manifest === null) throw new Error("empty import");
  if (record.sessionId !== (session?.intakeSessionId ?? null)
    || record.manifestId !== (manifest?.manifestId ?? session?.reservedManifestId ?? null)
    || record.importId !== (session?.intakeSessionId ?? manifest?.manifestId)
    || record.workflow !== (session?.workflow ?? manifest?.workflow)
    || record.sourceSha256 !== (session?.artifact.sha256 ?? manifest?.source.sha256)) throw new Error("identity mismatch");
  if (session !== null && manifest !== null && (session.workflow !== manifest.workflow
    || session.artifact.sha256 !== manifest.source.sha256
    || session.artifact.id !== manifest.source.artifactId
    || (session.reservedManifestId ?? session.intakeManifestId) !== manifest.manifestId)) throw new Error("conflicting import halves");
  if (session?.state === "enqueued" && manifest === null) throw new Error("missing submitted manifest");
}

export function importedArtifact(preparationJson: string | null, submittedJson: string | null): ImportedArtifact {
  const session = preparationJson === null ? null : IntakeSessionSchema.parse(JSON.parse(preparationJson));
  const manifest = submittedJson === null ? null : IntakePlanManifestSchema.parse(JSON.parse(submittedJson));
  return ImportedArtifactSchema.parse({ format: 1,
    importId: session?.intakeSessionId ?? manifest?.manifestId,
    sessionId: session?.intakeSessionId ?? null,
    manifestId: manifest?.manifestId ?? session?.reservedManifestId ?? null,
    workflow: session?.workflow ?? manifest?.workflow,
    sourceSha256: session?.artifact.sha256 ?? manifest?.source.sha256,
    preparationJson, submittedJson, createdAt: session?.createdAt ?? manifest?.createdAt,
  });
}
