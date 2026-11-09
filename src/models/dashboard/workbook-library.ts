import { z } from "zod";
import { IsoInstantSchema, RunIdSchema, WorkflowIdSchema, DateOnlySchema, CommandIdSchema } from "../../rules/identity/ids.js";
import { WorkbookIdSchema, WorkbookRevisionSchema, WorkbookMetadataSchema, WorkbookTypeSchema, EditableWorkbookWireSchema, WorkbookLinkSchema } from "./workbooks.js";

export const WorkbookSourceSelectionSchema = z.strictObject({
  libraryId: WorkbookIdSchema, sheetId: WorkbookIdSchema,
});
const WorkbookSourceSelectionsSchema = z.array(WorkbookSourceSelectionSchema).min(1)
  .refine(sources => new Set(sources.map(source => JSON.stringify([source.libraryId, source.sheetId]))).size === sources.length,
    { message: "workbook source selections must have unique library/sheet pairs" });
export const WorkflowWorkbookSelectionRecordSchema = z.strictObject({
  workflowId: WorkflowIdSchema, revision: z.number().int().positive(),
  acceptedCommandId: CommandIdSchema, usedAt: IsoInstantSchema, sources: WorkbookSourceSelectionsSchema,
});
export const WorkflowWorkbookSelectionInputSchema = WorkflowWorkbookSelectionRecordSchema.omit({ revision: true });
export type WorkflowWorkbookSelectionRecord = z.infer<typeof WorkflowWorkbookSelectionRecordSchema>;

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
  /** Saved time of the selected content, unaffected by metadata or version-label changes. */
  updatedAt: IsoInstantSchema,
  worksheets: z.array(z.strictObject({ id: WorkbookIdSchema, name: z.string().min(1) })).min(1),
  rowCount: z.number().int().nonnegative(), metadata: WorkbookMetadataSchema, type: WorkbookTypeSchema,
  state: WorkbookLibraryStateSchema,
}).refine(entry => entry.libraryId === entry.state.libraryId && entry.metadata.typeId === entry.type.id
  && entry.updatedAt === entry.state.versions.find(version => version.id === entry.state.selectedVersionId)?.savedAt);
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

export const WorkbookReferenceSlotSchema = z.strictObject({
  workflowId: WorkflowIdSchema, workflowLabel: NameSchema, typeId: WorkbookIdSchema,
  type: WorkbookTypeSchema.nullable(),
  status: z.enum(["bound", "missing", "unavailable"]),
  reasonCode: z.enum(["WORKBOOK_REFERENCE_MISSING", "WORKBOOK_TYPE_UNAVAILABLE", "WORKBOOK_BINDING_UNAVAILABLE"]).nullable(),
  current: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("missing") }),
    z.strictObject({ state: z.literal("unavailable"), code: z.enum(["WORKBOOK_TYPE_UNAVAILABLE", "WORKBOOK_BINDING_UNAVAILABLE"]) }),
    z.strictObject({ state: z.literal("bound"), entry: WorkbookLibraryEntrySchema,
      columns: z.array(z.strictObject({ sheetId: WorkbookIdSchema, sheetName: NameSchema,
        eid: z.array(z.strictObject({ column: z.number().int().nonnegative(), fieldId: z.literal("eid"), basis: z.enum(["header", "values", "manual"]) })),
        name: z.array(z.strictObject({ column: z.number().int().nonnegative(), fieldId: z.enum(["fullName", "firstName", "lastName", "middleName", "livedName"]), basis: z.enum(["header", "values", "manual"]) })),
      })),
    }),
  ]),
}).superRefine((slot, ctx) => {
  if (slot.status !== slot.current.state
    || slot.reasonCode !== (slot.current.state === "bound" ? null : slot.current.state === "missing" ? "WORKBOOK_REFERENCE_MISSING" : slot.current.code)
    || slot.current.state === "missing" && slot.type?.defaultWorkbookId !== null
    || slot.current.state === "unavailable" && (slot.current.code === "WORKBOOK_TYPE_UNAVAILABLE" ? slot.type !== null : slot.type === null || slot.type.defaultWorkbookId === null)
    || slot.type !== null && slot.type.id !== slot.typeId
    || slot.current.state === "bound" && (slot.type === null || slot.type.defaultWorkbookId !== slot.current.entry.libraryId || slot.current.entry.metadata.typeId !== slot.typeId))
    ctx.addIssue({ code: "custom", message: "reference slot binding identity mismatch" });
});
export const WorkbookReferenceSlotsSchema = z.array(WorkbookReferenceSlotSchema)
  .refine(slots => new Set(slots.map(slot => JSON.stringify([slot.workflowId, slot.typeId]))).size === slots.length);
export const WorkbookResultsSchema = z.strictObject({
  workflows: z.array(z.strictObject({ workflowId: WorkflowIdSchema, workflowLabel: NameSchema,
    runs: z.array(z.strictObject({ runId: RunIdSchema, partitionDay: DateOnlySchema,
      enqueuedAt: IsoInstantSchema.nullable(), entries: z.array(WorkbookLibraryEntrySchema).min(1),
    })).min(1),
  })),
  unavailable: z.array(WorkbookLibraryEntrySchema),
}).superRefine((results, ctx) => {
  const runs = results.workflows.flatMap(workflow => workflow.runs.map(run => run.runId));
  const entries = [...results.workflows.flatMap(workflow => workflow.runs.flatMap(run => run.entries)), ...results.unavailable];
  if (new Set(results.workflows.map(workflow => workflow.workflowId)).size !== results.workflows.length || new Set(runs).size !== runs.length
    || new Set(entries.map(entry => entry.libraryId)).size !== entries.length || results.unavailable.some(entry => entry.state.origin.kind !== "unavailable")
    || results.workflows.some(workflow => workflow.runs.some(run => run.entries.some(entry => {
      const origin = entry.state.origin;
      return origin.kind !== "workflow" || origin.workflowId !== workflow.workflowId
        || origin.runId !== run.runId || origin.partitionDay !== run.partitionDay;
    })))) ctx.addIssue({ code: "custom", message: "workbook result group identity mismatch" });
});
export type WorkbookReferenceSlot = z.infer<typeof WorkbookReferenceSlotSchema>;
