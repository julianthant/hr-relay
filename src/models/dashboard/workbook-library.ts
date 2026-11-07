import { z } from "zod";
import { IsoInstantSchema, RunIdSchema, WorkflowIdSchema, DateOnlySchema } from "../../rules/identity/ids.js";
import { WorkbookIdSchema, WorkbookRevisionSchema, WorkbookMetadataSchema, WorkbookTypeSchema, EditableWorkbookWireSchema, WorkbookLinkSchema } from "./workbooks.js";

const NameSchema = z.string().refine(value => value.trim().length > 0);
export const WorkbookLibraryOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local") }),
  z.strictObject({ kind: z.literal("workflow"), runId: RunIdSchema, partitionDay: DateOnlySchema, workflowId: WorkflowIdSchema, workflowLabel: NameSchema,
    rowCount: z.number().int().nonnegative(), rowSubject: z.enum(["person", "record"]) }),
  z.strictObject({ kind: z.literal("unavailable"), code: z.literal("WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE") }),
]);
export const WorkbookLibraryVersionSchema = z.strictObject({
  id: WorkbookIdSchema, name: NameSchema, version: WorkbookRevisionSchema,
  snapshotId: WorkbookIdSchema,
  savedAt: IsoInstantSchema, source: z.enum(["import", "operator", "sharepoint", "retained", "workflow"]),
});
export const WorkbookLibrarySnapshotSchema = z.strictObject({
  id: WorkbookIdSchema, libraryId: WorkbookIdSchema, workbook: EditableWorkbookWireSchema,
}).refine(snapshot => snapshot.workbook.libraryId === snapshot.libraryId);
export const WorkbookLibraryVersionViewSchema = z.strictObject({
  libraryId: WorkbookIdSchema, version: WorkbookLibraryVersionSchema, workbook: EditableWorkbookWireSchema,
}).refine(view => view.libraryId === view.workbook.libraryId);
export const WorkbookLibraryStateSchema = z.strictObject({
  libraryId: WorkbookIdSchema, revision: WorkbookRevisionSchema, selectedVersionId: WorkbookIdSchema,
  origin: WorkbookLibraryOriginSchema,
  removed: z.boolean(), versions: z.array(WorkbookLibraryVersionSchema).min(1),
}).superRefine((state, context) => {
  if (new Set(state.versions.map(version => version.id)).size !== state.versions.length
    || !state.versions.some(version => version.id === state.selectedVersionId)) {
    context.addIssue({ code: "custom", message: "library versions must have unique identities and retain the version in use" });
  }
});
export const WorkbookLibraryEntrySchema = z.strictObject({
  libraryId: WorkbookIdSchema, version: WorkbookRevisionSchema, name: NameSchema,
  worksheets: z.array(z.strictObject({ id: WorkbookIdSchema, name: z.string().min(1) })).min(1),
  rowCount: z.number().int().nonnegative(), metadata: WorkbookMetadataSchema, type: WorkbookTypeSchema,
  state: WorkbookLibraryStateSchema,
}).refine(entry => entry.libraryId === entry.state.libraryId && entry.metadata.typeId === entry.type.id);
export const WorkbookLibraryCatalogSchema = z.array(WorkbookLibraryEntrySchema)
  .refine(entries => new Set(entries.map(entry => entry.libraryId)).size === entries.length);
export const WorkbookLibraryChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("sync") }),
  z.strictObject({ kind: z.literal("link"), url: WorkbookLinkSchema.shape.url }),
  z.strictObject({ kind: z.literal("unlink") }),
  z.strictObject({ kind: z.literal("merge"), name: NameSchema, duplicates: z.enum(["keep-newer", "keep-both"]),
    sources: z.array(z.strictObject({ libraryId: WorkbookIdSchema, expectedVersion: WorkbookRevisionSchema, expectedRevision: WorkbookRevisionSchema })).min(1)
      .refine(sources => new Set(sources.map(source => source.libraryId)).size === sources.length) }),
  z.strictObject({ kind: z.literal("rename"), name: NameSchema }),
  z.strictObject({ kind: z.literal("metadata"), metadata: WorkbookMetadataSchema }),
  z.strictObject({ kind: z.literal("create-version"), name: NameSchema,
    from: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("version"), versionId: WorkbookIdSchema }),
      z.strictObject({ kind: z.literal("sharepoint") }),
      z.strictObject({ kind: z.literal("values"), workbook: EditableWorkbookWireSchema }),
    ]), useNow: z.boolean() }).refine(change => change.from.kind !== 'values' || !change.useNow,
      { message: 'Values-only versions leave the original version in use' }),
  z.strictObject({ kind: z.literal("rename-version"), versionId: WorkbookIdSchema, name: NameSchema }),
  z.strictObject({ kind: z.literal("delete-version"), versionId: WorkbookIdSchema }),
  z.strictObject({ kind: z.literal("use-version"), versionId: WorkbookIdSchema }),
  z.strictObject({ kind: z.literal("remove") }),
]);
export const WorkbookLibraryActionSchema = z.strictObject({
  operationId: WorkbookIdSchema, expectedRevision: WorkbookRevisionSchema,
  expectedVersion: WorkbookRevisionSchema, change: WorkbookLibraryChangeSchema,
});
export const WorkbookLibraryActionRecordSchema = z.strictObject({
  libraryId: WorkbookIdSchema, action: WorkbookLibraryActionSchema, at: IsoInstantSchema,
  result: WorkbookLibraryStateSchema,
}).refine(record => record.libraryId === record.result.libraryId
  && record.result.revision === record.action.expectedRevision + 1);
export const WorkbookLibraryActionStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("recorded"), record: WorkbookLibraryActionRecordSchema }),
]);

export type WorkbookLibraryState = z.infer<typeof WorkbookLibraryStateSchema>;
export type WorkbookLibraryEntry = z.infer<typeof WorkbookLibraryEntrySchema>;
export type WorkbookLibraryVersion = z.infer<typeof WorkbookLibraryVersionSchema>;
export type WorkbookLibraryAction = z.infer<typeof WorkbookLibraryActionSchema>;
export type WorkbookLibraryActionRecord = z.infer<typeof WorkbookLibraryActionRecordSchema>;
