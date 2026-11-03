import { z } from "zod";
import { NamedArtifactFileNameSchema } from "../../artifacts/artifacts.js";
import { CrmRetainedDocumentSchema } from "../../systems/crm/document-tasks.js";
import { OnboardingRosterSnapshotRowSchema } from "../onboarding/roster.js";
import { CrmDocumentIdentitySchema } from "../../systems/crm/read-idocs.js";

export const CrmWorksheetPersonSchema = z.strictObject({
  identity: CrmDocumentIdentitySchema,
  reference: z.strictObject({ worksheetId: z.string().min(1), worksheetName: NamedArtifactFileNameSchema, rowId: z.string().min(1),
    names: OnboardingRosterSnapshotRowSchema.shape.references }),
  documents: CrmRetainedDocumentSchema.array().min(1),
});
export type CrmWorksheetPerson = z.infer<typeof CrmWorksheetPersonSchema>;
