import { z } from "zod";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema, NonNegativeIntSchema, PositiveIntSchema, ErrorCodeSchema, RunIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
import { SearchMetadataSchema, CrossDateSearchStateFacetSchema, CrossDateSearchShapeFacetSchema, CrossDateSearchSystemFacetSchema } from "./search.js";

/** Public declared projection addresses; no source values or value-derived identities. */
export const RunSearchDeclarationSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  version: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  subjectProjection: z.strictObject({ nodeId: z.string().min(1), fieldPath: z.string().min(1) }).nullable(),
});
export const RunSearchIndexRecordSchema = z.strictObject({
  runId: RunIdSchema,
  sourceVersion: PositiveIntSchema,
  metadata: SearchMetadataSchema,
});
export const RunSearchPublicationSchema = z.strictObject({
  state: z.enum(["published", "building", "invalid"]),
  sourceGeneration: NonNegativeIntSchema,
  afterRun: RunIdSchema.nullable(),
  rowCount: NonNegativeIntSchema,
});
export const RunSearchGramSchema = z.strictObject({ token: z.string().min(1).max(3), runId: RunIdSchema });
export const RunSearchActorLinkSchema = z.strictObject({ runId: RunIdSchema, actor: ActorIdSchema, sourceId: z.string().min(1) });
export const RunSearchRebuildRequestSchema = z.strictObject({ restart: z.boolean().default(false), limit: z.number().int().min(1).max(500).default(100) });
export const RunSearchReadRequestSchema = z.strictObject({
  q: z.string().trim().max(160).transform(value => value.toLowerCase()),
  scope: z.enum(["all", "run", "trace", "workflow", "subject", "actor"]),
  facets: z.strictObject({
    workflow: WorkflowIdSchema.optional(),
    day: z.strictObject({ startsAt: IsoInstantSchema, endsBefore: IsoInstantSchema }).optional(),
    from: z.iso.date().optional(), to: z.iso.date().optional(),
    state: CrossDateSearchStateFacetSchema.optional(), shape: CrossDateSearchShapeFacetSchema.optional(), dryRun: z.boolean().optional(),
    system: CrossDateSearchSystemFacetSchema.optional(), subject: z.string().trim().min(1).max(160).optional(),
    actor: ActorIdSchema.optional(), version: PositiveIntSchema.optional(), failure: ErrorCodeSchema.optional(),
    evidence: z.enum(["receipt", "failure", "diagnostic", "none"]).optional(),
  }),
  limit: z.number().int().min(1).max(51),
  after: z.strictObject({ matchRank: NonNegativeIntSchema, enqueuedAt: IsoInstantSchema, runId: RunIdSchema }).optional(),
});
