import { z } from "zod";
import { ArtifactRefSchema, NamedArtifactFileNameSchema } from "../../artifacts/artifacts.js";
import { OnboardingRosterSnapshotRowSchema } from "../onboarding/roster.js";
import { CrmDocumentIdentitySchema } from "../../systems/crm/read-idocs.js";

export const CrmWorksheetPersonSchema = z.strictObject({
  identity: CrmDocumentIdentitySchema,
  reference: z.strictObject({ worksheetId: z.string().min(1), worksheetName: NamedArtifactFileNameSchema, rowId: z.string().min(1),
    names: OnboardingRosterSnapshotRowSchema.shape.references }),
  documents: z.array(z.strictObject({ index: z.number().int().nonnegative(), fileName: NamedArtifactFileNameSchema, artifact: ArtifactRefSchema })).min(1),
});
export type CrmWorksheetPerson = z.infer<typeof CrmWorksheetPersonSchema>;
