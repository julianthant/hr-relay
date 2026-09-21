import { z } from "zod";
import { FingerprintSchema, IsoInstantSchema, NonNegativeIntSchema } from "../ids.js";
import { ActivityReportWireSchema } from "./activity.js";

export const ActivitySnapshotTokenSchema = z.string().regex(/^as1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u).max(4096);
export const ActivitySnapshotIdentitySchema = z.strictObject({
  from: z.iso.date(), to: z.iso.date(), generatedAt: IsoInstantSchema, expiresAt: IsoInstantSchema,
  sourceIdentity: FingerprintSchema, authorityGeneration: NonNegativeIntSchema, reportDigest: FingerprintSchema,
});
export const ActivityReportSelectionSchema = ActivityReportWireSchema.safeExtend({
  snapshot: ActivitySnapshotIdentitySchema.safeExtend({token:ActivitySnapshotTokenSchema}),
}).superRefine((report, context) => {
  if (report.from !== report.snapshot.from || report.to !== report.snapshot.to || report.generatedAt !== report.snapshot.generatedAt)
    context.addIssue({code:"custom",message:"Activity report must belong to its exact snapshot"});
});
export type ActivityReportSelection = z.infer<typeof ActivityReportSelectionSchema>;
