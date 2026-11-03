import { z } from "zod";
import { EidSchema } from "../../../rules/identity/ids.js";
import { NamedArtifactFileNameSchema } from "../../artifacts/artifacts.js";

export const CrmDocumentSubjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("eid"), value: EidSchema }),
  z.strictObject({ kind: z.literal("email"), value: z.email() }),
]);
export const CrmIdocsReadInputSchema = z.strictObject({
  recordId: z.string().min(1), subject: CrmDocumentSubjectSchema,
  docIndices: z.array(z.number().int().nonnegative()).min(1).optional(),
});
export const CrmDocumentIdentitySchema = z.strictObject({
  recordId: z.string().min(1), eid: EidSchema.nullable(), workEmail: z.email().nullable(), personalEmail: z.email().nullable(),
});
export const CrmIdocsBytesSchema = z.strictObject({
  identity: CrmDocumentIdentitySchema,
  totalDocuments: z.number().int().positive(),
  documents: z.array(z.strictObject({ index: z.number().int().nonnegative(), fileName: NamedArtifactFileNameSchema, bytes: z.instanceof(Uint8Array) })).min(1),
});
