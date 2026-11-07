import { z } from "zod";
import { ActivityReportSelectionSchema, ActivitySnapshotIdentitySchema, ActivitySnapshotTokenSchema } from "./activity-selection.js";
import { QueueStatusSchema } from "./projection.js";
import { FingerprintSchema, RunIdSchema } from "../../rules/identity/ids.js";

export const ActivityPopulationRangeSchema = z.strictObject({ from: z.iso.date(), to: z.iso.date() }).refine(range => range.from <= range.to);
export const ActivityPopulationRunSchema = z.strictObject({
  runId: RunIdSchema, workflowId: z.string().min(1), title: z.string().min(1), attempt: z.number().int().positive(),
  parentRunId: RunIdSchema.nullable(), shape: z.enum(["single", "preview", "operation"]),
  day: z.iso.date(), status: QueueStatusSchema, terminal: z.boolean(), durationMs: z.number().nonnegative().nullable(),
  readback: z.boolean().nullable(), receiptResult: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial"]).nullable(), warningCount: z.number().int().nonnegative().nullable(),
});
export const ActivitySuccessfulTimingSchema = z.strictObject({ workflowId: z.string().min(1), totalMs: z.number().nonnegative().nullable(), measured: z.number().int().nonnegative(), unmeasured: z.number().int().nonnegative() });
export const ActivityPopulationTokenSchema = z.string().regex(/^ap1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u).max(4096);
export const ActivityPopulationIdentitySchema = ActivitySnapshotIdentitySchema.extend({ reportToken: ActivitySnapshotTokenSchema, populationDigest: FingerprintSchema });
export const ActivityPopulationSelectionSchema = z.strictObject({
  report: ActivityReportSelectionSchema, population: z.array(ActivityPopulationRunSchema), successfulTiming: z.array(ActivitySuccessfulTimingSchema),
  snapshot: ActivityPopulationIdentitySchema.extend({ token: ActivityPopulationTokenSchema }),
}).superRefine((selection, context) => {
  const { token, ...reportIdentity } = selection.report.snapshot;
  if (token !== selection.snapshot.reportToken || Object.entries(reportIdentity).some(([key, value]) => selection.snapshot[key as keyof typeof reportIdentity] !== value))
    context.addIssue({ code: "custom", message: "Analytics population must belong to its exact report snapshot" });
  if (selection.population.length !== selection.report.totalRuns || new Set(selection.population.map(row => row.runId)).size !== selection.population.length)
    context.addIssue({ code: "custom", message: "Analytics population must contain every selected run exactly once" });
});
export const ActivityPopulationBrowseSchema = z.strictObject({
  metric: z.enum(["completed", "outstanding", "failed", "timed"]), workflow: z.string().min(1).optional(),
  query: z.string().optional(), sort: z.strictObject({ column: z.enum(["name", "duration"]), direction: z.enum(["ascending", "descending"]) }).optional(),
  page: z.number().int().nonnegative(), run: RunIdSchema.optional(),
});
export const ActivityPopulationBrowseResultSchema = z.strictObject({
  identity: z.strictObject({ from: z.iso.date(), to: z.iso.date(), token: ActivityPopulationTokenSchema, browse: ActivityPopulationBrowseSchema, digest: FingerprintSchema }),
  total: z.number().int().nonnegative(), totalMatches: z.number().int().nonnegative(), start: z.number().int().nonnegative(),
  rows: z.array(ActivityPopulationRunSchema), run: ActivityPopulationRunSchema.nullable(),
});
export const ActivityPopulationSelectedRequestSchema = ActivityPopulationRangeSchema.safeExtend({
  snapshot: ActivityPopulationTokenSchema, browse: ActivityPopulationBrowseSchema.optional(),
});
export const ActivityPopulationSelectedReadSchema = z.strictObject({ selection: ActivityPopulationSelectionSchema, browse: ActivityPopulationBrowseResultSchema.nullable() });
export const ActivityPopulationExportSchema = z.strictObject({ selection: ActivityPopulationSelectionSchema, filename: z.string(), mediaType: z.literal("text/csv; charset=utf-8"), csv: z.string() });

export type ActivityPopulationRange = z.infer<typeof ActivityPopulationRangeSchema>;
export type ActivityPopulationRun = z.infer<typeof ActivityPopulationRunSchema>;
export type ActivityPopulationSelection = z.infer<typeof ActivityPopulationSelectionSchema>;
export type ActivityPopulationBrowse = z.infer<typeof ActivityPopulationBrowseSchema>;
export type ActivityPopulationBrowseResult = z.infer<typeof ActivityPopulationBrowseResultSchema>;
export type ActivityPopulationSelectedRead = z.infer<typeof ActivityPopulationSelectedReadSchema>;
export type ActivityPopulationExport = z.infer<typeof ActivityPopulationExportSchema>;
export type ActivitySuccessfulTiming = z.infer<typeof ActivitySuccessfulTimingSchema>;
