import { RunResultRecordSchema } from "./result.js";
import { RunEvidenceReceiptSchema } from "../trust/evidence.js";
import { FailureRecordSchema } from "../trust/failure.js";
import { FailureResolutionSchema } from "../trust/failure-resolution.js";
import { z } from "zod";
import { RunIdSchema, IsoInstantSchema, FingerprintSchema } from "../../rules/identity/ids.js";
import { RunRecordSchema, RunLifecycleSchema } from "./record.js";

/** Server-internal row. Public Activity must select aggregates, never identity. */
export const RunSummarySchema = z.strictObject({
  runId: RunIdSchema, workflow: z.string().min(1), itemId: z.string().min(1),
  descriptorVersion: z.number().int().positive(), contractFingerprint: FingerprintSchema,
  title: z.string().min(1), localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  enqueuedAt: IsoInstantSchema, startedAt: IsoInstantSchema.nullable(), endedAt: IsoInstantSchema.nullable(),
  durationMs: z.number().nonnegative().nullable(), sourceCursor: z.number().int().nonnegative(),
  sessionId: z.string().nullable(), children: z.array(z.strictObject({runId:RunIdSchema,state:z.string(),outcome:z.string().nullable()})),
  dependencyRunIds:z.array(RunIdSchema), completionClass:z.string().nullable(), failureTransient:z.boolean().nullable(),
  createdAt: IsoInstantSchema, updatedAt: IsoInstantSchema, lifecycle: RunLifecycleSchema,
  priority: z.enum(["interactive", "bulk"]), shape: z.enum(["single", "preview", "operation", "operation-member"]),
  parentRunId: RunIdSchema.nullable(), attempt: z.number().int().positive(),
  sourceGeneration: z.number().int().nonnegative(), sourceDigest: FingerprintSchema,
  warningCount: z.number().int().nonnegative().nullable(),
  receiptResult: RunEvidenceReceiptSchema.shape.result.nullable(),
  failureCode: z.string().nullable(), resolution: FailureResolutionSchema.nullable(),
  person: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), identity: z.string().min(1) }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
  ]),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;
export const SummaryPublicationSchema = z.strictObject({
  state: z.enum(["absent", "building", "published"]), generation: z.number().int().nonnegative(),
  sourceGeneration: z.number().int().nonnegative(), rowCount: z.number().int().nonnegative(),
});

export const RunSummarySourceSchema = z.strictObject({
  run: RunRecordSchema, result: RunResultRecordSchema.nullable(), receipt: RunEvidenceReceiptSchema.nullable(),
  failure: FailureRecordSchema.nullable(), resolution: FailureResolutionSchema.nullable(),
  cursor:z.number().int().nonnegative(), startedAt:IsoInstantSchema.nullable(), queueTitle:z.string().nullable(),
  children:RunSummarySchema.shape.children,dependencyRunIds:z.array(RunIdSchema),
});
export type RunSummarySource = z.infer<typeof RunSummarySourceSchema>;

/** Internal partitioned cursor. Q owns public filtering/aggregation policy. */
export const SummaryQuerySchema=z.strictObject({
  workflow:z.string().min(1),fromDay:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  toDay:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),state:z.string().min(1).optional(),
  parentRunId:RunIdSchema.nullable().optional(),limit:z.number().int().min(1).max(500),
  after:z.strictObject({localDay:z.string(),runId:RunIdSchema}).optional(),
});
export type SummaryQuery=z.infer<typeof SummaryQuerySchema>;
