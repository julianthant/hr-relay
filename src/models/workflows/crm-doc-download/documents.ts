import { z } from "zod";
import { ArtifactRefSchema, ArtifactRelativePathSchema, CollectionArtifactOutputSchema, NamedArtifactFileNameSchema } from "../../artifacts/artifacts.js";
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

export const CrmWorksheetArchiveSchema = z.strictObject({
  relativePath: ArtifactRelativePathSchema, artifact: ArtifactRefSchema,
  worksheetId: z.string().min(1), worksheetName: NamedArtifactFileNameSchema,
  people: z.array(z.strictObject({ identity: CrmDocumentIdentitySchema, rowId: z.string().min(1),
    folderName: NamedArtifactFileNameSchema, documentCount: z.number().int().positive() })).min(1),
}).refine(worksheet => worksheet.artifact.mediaType === "application/zip"
  && worksheet.relativePath === `${worksheet.worksheetName}/${worksheet.worksheetName}.zip`, "worksheet archive must retain its exact destination");

export const CrmDocumentArchivesSchema = z.strictObject({
  collection: CollectionArtifactOutputSchema, worksheets: CrmWorksheetArchiveSchema.array().min(1),
  worksheetCount: z.number().int().positive(), personCount: z.number().int().positive(), documentCount: z.number().int().positive(),
}).refine(output => output.worksheetCount === output.worksheets.length
  && output.personCount === output.worksheets.reduce((total, sheet) => total + sheet.people.length, 0)
  && output.documentCount === output.worksheets.reduce((total, sheet) => total + sheet.people.reduce((count, person) => count + person.documentCount, 0), 0)
  && output.collection.files.length === output.worksheets.length
  && output.worksheets.every((sheet, index) => {
    const file = output.collection.files[index];
    return file?.relativePath === sheet.relativePath && file.artifact.id === sheet.artifact.id && file.artifact.sha256 === sheet.artifact.sha256
      && file.artifact.bytes === sheet.artifact.bytes && file.artifact.mediaType === sheet.artifact.mediaType;
  }), "archive facts must describe the exact published collection");
