import { z } from "zod";
import { ArtifactRefSchema, ArtifactRelativePathSchema, CollectionArtifactOutputSchema, NamedArtifactFileNameSchema } from "../../artifacts/artifacts.js";
import { CrmRetainedDocumentSchema, CrmDocumentIdentitySchema } from "../../systems/crm/documents.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";

export const CRM_DOCUMENT_ROSTER_FIELDS = ["email", "firstName", "lastName", "middleName",
  "roster.livedFirstName", "roster.livedLastName", "roster.livedMiddleName"] as const;

const namePart = z.string().min(1).refine(value => value.trim() === value);
const CrmRosterPersonNameSchema = z.strictObject({
  firstName: namePart, lastName: namePart, middleName: z.string().refine(value => value.trim() === value),
});
export const CrmRosterNamesSchema = z.strictObject({ legalName: CrmRosterPersonNameSchema, livedName: CrmRosterPersonNameSchema.nullable() });

export const CrmWorksheetPersonSchema = z.strictObject({
  identity: CrmDocumentIdentitySchema,
  reference: z.strictObject({
    referenceDigest: FingerprintSchema, worksheetId: z.string().min(1), worksheetName: NamedArtifactFileNameSchema, rowId: z.string().min(1),
    names: CrmRosterNamesSchema }),
  documents: CrmRetainedDocumentSchema.array().min(1),
});
export type CrmWorksheetPerson = z.infer<typeof CrmWorksheetPersonSchema>;

const worksheetArchivePath = (worksheetName: string) => `${worksheetName}/${worksheetName}.zip`;

export const CrmWorksheetArchiveSchema = z.strictObject({
  relativePath: ArtifactRelativePathSchema, artifact: ArtifactRefSchema, referenceDigest: FingerprintSchema,
  worksheetId: z.string().min(1), worksheetName: NamedArtifactFileNameSchema,
  people: z.array(z.strictObject({ identity: CrmDocumentIdentitySchema, rowId: z.string().min(1),
    folderName: NamedArtifactFileNameSchema, documentCount: z.number().int().positive() })).min(1),
}).refine(worksheet => worksheet.artifact.mediaType === "application/zip"
  && (worksheet.relativePath === worksheetArchivePath(worksheet.worksheetName)
    || worksheet.relativePath === `${worksheet.referenceDigest}/${worksheetArchivePath(worksheet.worksheetName)}`),
  "worksheet archive must retain its exact destination");

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
