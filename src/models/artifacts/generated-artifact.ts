import { sha256Hex } from "../../rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { z } from "zod";
import { ArtifactRefSchema } from "./artifacts.js";
import { ActorIdSchema, ArtifactIdSchema, FingerprintSchema, IsoInstantSchema, NodeIdSchema, OutboxIdSchema, PositiveIntSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { ArtifactProjectionKeyValueSchema } from "../workflow/artifact-projection.js";
import { SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import { OperatorXlsxExportEvidenceSchema, OperatorXlsxExportIdSchema, OperatorXlsxExportRequestSchema } from "../dashboard/xlsx-export.js";
import { HistoricalOperatorXlsxExportRequestSchema } from "../dashboard/xlsx-export-history.js";
export const ArtifactOutboxStorageRecordSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  artifactId: ArtifactIdSchema,
  projectionId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  stableKeyFingerprint: FingerprintSchema,
  /** Ordered declared-key pairs, never an open map (ref data-intake-and-edit-data §2's own rule). */
  keyValues: ArtifactProjectionKeyValueSchema.array().min(1),
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sourceRunId: RunIdSchema,
  sourceNodeId: NodeIdSchema,
  state: z.enum(["pending", "projected"]),
  payload: SchemaBoundCanonicalValueSchema,
  createdAt: IsoInstantSchema,
  projectedAt: IsoInstantSchema.optional(),
});

/**
 * Ref data-intake-and-edit-data §4.1's sink head: the last content hash this projector recorded for
 * a sink's workbook. One row per sink, updated with `generation + 1` under a
 * CAS — the same one-row-updated discipline notifications follow (v10's
 * lesson). A workbook whose bytes do not hash to `contentSha256` was changed
 * by someone else, and the projector parks rather than overwriting them.
 */
export const ArtifactSinkHeadRecordSchema = z.strictObject({
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  contentSha256: FingerprintSchema,
  generation: PositiveIntSchema,
  lastOutboxId: OutboxIdSchema,
  projectedAt: IsoInstantSchema,
});

/** The repository ack: CAS `pending → projected`, stamping the instant. */
export const ArtifactOutboxAckRequestSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  projectedAt: IsoInstantSchema,
});

/** The repository head upsert; `generation` is assigned by the repository. */
export const ArtifactSinkHeadRecordRequestSchema = z.strictObject({
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  contentSha256: FingerprintSchema,
  lastOutboxId: OutboxIdSchema,
  projectedAt: IsoInstantSchema,
});


export const GeneratedArtifactVersionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("verified"), artifact: ArtifactRefSchema }),
  z.strictObject({ state: z.literal("unavailable"), sha256: FingerprintSchema, reason: z.enum(["historical-bytes-unavailable", "missing-bytes"]) }),
]);
export const GeneratedArtifactSchema = z.strictObject({
  format: z.literal(1),
  fileId: z.string().min(1).max(256),
  sinkId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  exportId: OperatorXlsxExportIdSchema.nullable(),
  exportRequest: z.union([OperatorXlsxExportRequestSchema, HistoricalOperatorXlsxExportRequestSchema]).nullable(),
  registration: z.strictObject({requestedBy:ActorIdSchema,requestedAt:IsoInstantSchema}).nullable(),
  exportEvidenceJson: z.string().nullable(),
  exportEvidenceFingerprint: FingerprintSchema.nullable(),
  mediaType: ArtifactRefSchema.shape.mediaType,
  state: z.enum(["pending", "writing", "ready", "failed", "conflict", "unavailable"]),
  historyCoverage: z.enum(["complete", "historical-gaps"]),
  version: PositiveIntSchema,
  head: ArtifactSinkHeadRecordSchema.nullable(),
  updates: z.array(z.strictObject({ sequence: PositiveIntSchema, record: ArtifactOutboxStorageRecordSchema })).max(10000),
  versions: z.array(GeneratedArtifactVersionSchema).max(10000),
  prepared: z.strictObject({ updateId: OutboxIdSchema, expectedGeneration: z.number().int().nonnegative(), artifact: ArtifactRefSchema }).nullable(),
  createdAt: IsoInstantSchema,
}).superRefine((file, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if ((file.sinkId === null) === (file.exportId === null)) issue("generated artifact has one sink or export identity");
  if (file.fileId !== (file.sinkId === null ? `export:${String(file.exportId)}` : `sink:${file.sinkId}`)) issue("generated artifact identity mismatch");
  const identities = new Set<string>();
  for (const [index, update] of file.updates.entries()) {
    if (update.sequence !== index + 1 || identities.has(update.record.outboxId) || update.record.sinkId !== file.sinkId) issue("generated artifact update order/identity mismatch");
    identities.add(update.record.outboxId);
    if ((update.record.state === "projected") !== (update.record.projectedAt !== undefined)) issue("generated artifact acknowledgement mismatch");
  }
  if (file.head !== null && (file.head.sinkId !== file.sinkId || !identities.has(file.head.lastOutboxId))) issue("generated artifact head has no owned update");
  if (file.state === "ready" && (file.updates.some((u) => u.record.state === "pending") || file.versions.at(-1)?.state !== "verified")) issue("ready artifact requires verified bytes and settled work");
  const lastVersion = file.versions.at(-1);
  if(file.head!==null && lastVersion?.state === "verified" && lastVersion.artifact.sha256!==file.head.contentSha256)issue("generated head version mismatch");
  if((file.registration===null)!==(file.exportRequest===null))issue("generated export registration incomplete");
  if(file.sinkId!==null&&(file.exportRequest!==null||file.registration!==null))issue("managed sink cannot carry export registration");
  if((file.exportEvidenceJson===null)!==(file.exportEvidenceFingerprint===null))issue("generated export evidence fingerprint missing");
  if (file.exportEvidenceJson !== null) {
    if(sha256Hex(file.exportEvidenceJson)!==file.exportEvidenceFingerprint)issue("generated export evidence fingerprint mismatch");
    try {
      const evidence = OperatorXlsxExportEvidenceSchema.parse(JSON.parse(file.exportEvidenceJson));
      if(file.mediaType!==evidence.artifact.mediaType || (file.registration===null&&file.createdAt!==evidence.createdAt))issue("generated export metadata mismatch");
      if(lastVersion?.state==="verified"&&canonicalJsonStringify(lastVersion.artifact)!==canonicalJsonStringify(evidence.artifact))issue("generated export artifact version mismatch");
      if(lastVersion?.state==="unavailable"&&lastVersion.sha256!==evidence.artifact.sha256)issue("generated export unavailable digest mismatch");
      if (evidence.exportId !== file.exportId || file.sinkId !== null || file.updates.length !== 0) issue("generated export identity mismatch");
    } catch { issue("generated export evidence invalid"); }
  }
});
export type GeneratedArtifact = z.infer<typeof GeneratedArtifactSchema>;
export const GENERATED_ARTIFACT_METADATA_LIMIT = 8 * 1024 * 1024;
