import { z } from "zod";
import { ERROR_CATALOG } from "../failures/error-catalog.js";
import { IsoInstantSchema, RunIdSchema, WorkflowIdSchema, DateOnlySchema, CommandIdSchema } from "../../rules/identity/ids.js";
import { WorkbookIdSchema, WorkbookRevisionSchema, WorkbookMetadataSchema, WorkbookTypeSchema, EditableWorkbookWireSchema, WorkbookLinkSchema } from "./workbooks.js";
import { SPREADSHEET_FIELDS } from "../fields/workbook-fields.js";

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

const KnownWorkbookFieldSchema = z.string().refine(value => SPREADSHEET_FIELDS.some(field => field.id === value),
  { message: "unknown workbook field" });
export const WorkbookFieldRequirementSchema = z.strictObject({
  id: WorkbookIdSchema, keyFieldId: KnownWorkbookFieldSchema, mode: z.enum(["keys", "all"]),
  writableFields: z.array(KnownWorkbookFieldSchema).refine(fields => new Set(fields).size === fields.length),
});
export const WorkbookRequirementDeclarationSchema = z.strictObject({
  requiredWorkbookFields: z.array(KnownWorkbookFieldSchema).refine(fields => new Set(fields).size === fields.length),
  workbookReference: WorkbookFieldRequirementSchema.optional(),
}).superRefine((workflow, context) => {
  const reference = workflow.workbookReference;
  if (workflow.requiredWorkbookFields.length === 0 ? reference !== undefined : reference === undefined
    || reference !== undefined && (!workflow.requiredWorkbookFields.includes(reference.keyFieldId)
      || reference.writableFields.some(field => !workflow.requiredWorkbookFields.includes(field)))) {
    context.addIssue({ code: "custom", message: "workbook reference key and writable fields must belong to required fields" });
  }
});
export const WorkflowWorkbookRequirementSchema = WorkbookRequirementDeclarationSchema.safeExtend({
  id: WorkflowIdSchema, label: z.string().min(1),
});
export type WorkflowWorkbookRequirement = z.infer<typeof WorkflowWorkbookRequirementSchema>;
export interface WorkflowWorkbookRequirementInput {
  readonly id: string;
  readonly label: string;
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: Readonly<{ id: string; keyFieldId: string; mode: 'keys' | 'all'; writableFields: readonly string[] }>;
}
export interface WorkflowWorkbookSelectionInput {
  readonly workflowId: string;
  readonly revision: number;
  readonly acceptedCommandId: string;
  readonly usedAt: string;
  readonly sources: readonly Readonly<{ libraryId: string; sheetId: string }>[];
}

const WorkbookCoverageSchema = z.strictObject({
  workflowId: WorkflowIdSchema, status: z.enum(["compatible", "missing-fields", "duplicate-fields"]),
  reasonCode: z.enum(["WORKBOOK_FIELDS_MISSING", "WORKBOOK_FIELDS_DUPLICATE"]).nullable(),
  missingFields: z.array(KnownWorkbookFieldSchema), duplicateFields: z.array(KnownWorkbookFieldSchema),
});
export const WorkbookMappedFieldSchema = z.strictObject({ fieldId: z.string().min(1),
  column: z.number().int().nonnegative(), basis: z.enum(["header", "values", "manual"]) });
export function workbookFieldCoverage(requiredFields: readonly string[], mappedFields: readonly string[]) {
  const missingFields = requiredFields.filter(field => !mappedFields.includes(field));
  const duplicateFields = requiredFields.filter(field => mappedFields.filter(mapped => mapped === field).length > 1);
  return { status: missingFields.length > 0 ? "missing-fields" as const
    : duplicateFields.length > 0 ? "duplicate-fields" as const : "compatible" as const,
    reasonCode: missingFields.length > 0 ? "WORKBOOK_FIELDS_MISSING" as const
      : duplicateFields.length > 0 ? "WORKBOOK_FIELDS_DUPLICATE" as const : null,
    missingFields, duplicateFields };
}
export const WorkbookCompatibilitySchema = z.strictObject({
  workflows: z.array(z.strictObject({ workflowId: WorkflowIdSchema, requiredWorkbookFields: z.array(KnownWorkbookFieldSchema),
    workbookReference: WorkbookFieldRequirementSchema.optional(),
    lastUsed: WorkflowWorkbookSelectionRecordSchema.nullable(),
    selectionState: z.enum(["none", "available", "stale"]),
    staleSources: z.array(WorkbookSourceSelectionSchema.extend({
      reasonCode: z.enum(["SOURCE_MISSING", "SOURCE_REMOVED", "MAPPING_CHANGED"]),
    })),
    sources: z.array(z.strictObject({ libraryId: WorkbookIdSchema, versionId: WorkbookIdSchema,
      sheetId: WorkbookIdSchema, sheetName: z.string().min(1) })),
  })),
  libraries: z.array(z.strictObject({ libraryId: WorkbookIdSchema, versionId: WorkbookIdSchema,
    sheets: z.array(z.strictObject({ sheetId: WorkbookIdSchema, sheetName: z.string().min(1),
      mappings: z.array(WorkbookMappedFieldSchema),
      workflows: z.array(WorkbookCoverageSchema) })),
  })),
}).superRefine((report, context) => {
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  if (!unique(report.workflows.map(workflow => workflow.workflowId))
    || !unique(report.libraries.map(library => library.libraryId))
    || report.libraries.some(library => !unique(library.sheets.map(sheet => sheet.sheetId)))) {
    context.addIssue({ code: "custom", message: "duplicate workbook compatibility identity" });
  }
  for (const workflow of report.workflows) {
    const eligible = new Set(workflow.sources.map(source => JSON.stringify([source.libraryId, source.sheetId])));
    const expectedStale = workflow.lastUsed?.sources.filter(source => !eligible.has(JSON.stringify([source.libraryId, source.sheetId]))) ?? [];
    const expectedState = workflow.lastUsed === null ? "none" : expectedStale.length === 0 ? "available" : "stale";
    if (workflow.lastUsed !== null && workflow.lastUsed.workflowId !== workflow.workflowId
      || !unique(workflow.sources.map(source => JSON.stringify([source.libraryId, source.sheetId])))
      || !unique(workflow.staleSources.map(source => JSON.stringify([source.libraryId, source.sheetId])))
      || workflow.selectionState !== expectedState
      || JSON.stringify(workflow.staleSources.map(source => [source.libraryId, source.sheetId]))
        !== JSON.stringify(expectedStale.map(source => [source.libraryId, source.sheetId]))) {
      context.addIssue({ code: "custom", message: "workbook compatibility selection identity mismatch" });
    }
    const compatible = report.libraries.flatMap(library => library.sheets.flatMap(sheet =>
      sheet.workflows.some(coverage => coverage.workflowId === workflow.workflowId && coverage.status === "compatible")
        ? [JSON.stringify([library.libraryId, library.versionId, sheet.sheetId, sheet.sheetName])] : []));
    if (!unique(compatible) || workflow.sources.length !== compatible.length
      || workflow.sources.some(source => !compatible.includes(JSON.stringify([source.libraryId, source.versionId, source.sheetId, source.sheetName])))) {
      context.addIssue({ code: "custom", message: "workbook compatibility directions disagree" });
    }
  }
  for (const library of report.libraries) for (const sheet of library.sheets) for (const coverage of sheet.workflows) {
    const workflow = report.workflows.find(candidate => candidate.workflowId === coverage.workflowId);
    const expected = workflow === undefined ? undefined : workbookFieldCoverage(workflow.requiredWorkbookFields,
      sheet.mappings.map(mapping => mapping.fieldId));
    if (workflow === undefined || expected === undefined || coverage.status !== expected.status
      || coverage.reasonCode !== expected.reasonCode
      || JSON.stringify(coverage.missingFields) !== JSON.stringify(expected.missingFields)
      || JSON.stringify(coverage.duplicateFields) !== JSON.stringify(expected.duplicateFields)) {
      context.addIssue({ code: "custom", message: "workbook coverage facts disagree with worksheet mappings" });
    }
  }
});
export type WorkbookCompatibility = z.infer<typeof WorkbookCompatibilitySchema>;

export const WorkbookActiveSelectionSchema = z.strictObject({
  entry: z.number().int().positive(), libraryId: WorkbookIdSchema, versionId: WorkbookIdSchema,
  sheetId: WorkbookIdSchema, expectedVersion: WorkbookRevisionSchema,
  selectedRow: z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema }).optional(),
}).superRefine((selection, context) => {
  if (selection.selectedRow !== undefined && selection.selectedRow.sheetId !== selection.sheetId) {
    context.addIssue({ code: "custom", message: "selected row must belong to selected worksheet" });
  }
});
export const WorkbookActiveSnapshotRequestSchema = z.strictObject({
  kind: z.literal("selected-source"), typeId: WorkbookIdSchema, keyFieldId: KnownWorkbookFieldSchema,
  fields: z.array(KnownWorkbookFieldSchema).min(1),
  writableFields: z.array(KnownWorkbookFieldSchema),
  mode: z.enum(["keys", "all"]), keys: z.array(z.string().min(1)),
  libraryId: WorkbookIdSchema, versionId: WorkbookIdSchema, sheetId: WorkbookIdSchema,
  expectedVersion: WorkbookRevisionSchema,
  selectedRow: z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema }).optional(),
}).superRefine((request, context) => {
  if (new Set(request.fields).size !== request.fields.length || !request.fields.includes(request.keyFieldId)
    || new Set(request.writableFields).size !== request.writableFields.length
    || request.writableFields.some(field => !request.fields.includes(field))
    || request.mode === "all" && request.keys.length !== 0
    || request.selectedRow !== undefined && (request.mode !== "keys" || request.selectedRow.sheetId !== request.sheetId)) {
    context.addIssue({ code: "custom", message: "invalid selected workbook source request" });
  }
});

export interface WorkbookCompatibilitySource {
  readonly libraryId: string;
  readonly versionId: string;
  readonly origin: Readonly<{ kind: "local" | "workflow" | "unavailable" }>;
  readonly removed: boolean;
  readonly sheets: readonly Readonly<{ id: string; name: string; mappings: readonly z.infer<typeof WorkbookMappedFieldSchema>[] }>[];
}

export function projectWorkbookCompatibility(workflowsInput: readonly WorkflowWorkbookRequirementInput[],
  sources: readonly WorkbookCompatibilitySource[], lastUsedInput: readonly WorkflowWorkbookSelectionInput[] = []): WorkbookCompatibility {
  const workflows = workflowsInput.map(workflow => WorkflowWorkbookRequirementSchema.parse({
    id: workflow.id, label: workflow.label, requiredWorkbookFields: workflow.requiredWorkbookFields,
    ...(workflow.workbookReference === undefined ? {} : { workbookReference: workflow.workbookReference }),
  }));
  const lastUsed = lastUsedInput.map(record => WorkflowWorkbookSelectionRecordSchema.parse(record));
  const libraries = sources.filter(source => source.origin.kind === "local" && !source.removed).map(source => ({
    libraryId: source.libraryId, versionId: source.versionId,
    sheets: source.sheets.map(sheet => ({ sheetId: sheet.id, sheetName: sheet.name, mappings: sheet.mappings,
      workflows: workflows.filter(workflow => workflow.workbookReference !== undefined).map(workflow => {
        return { workflowId: workflow.id, ...workbookFieldCoverage(workflow.requiredWorkbookFields,
          sheet.mappings.map(mapping => mapping.fieldId)) };
      }) })),
  }));
  return WorkbookCompatibilitySchema.parse({ libraries, workflows: workflows.map(workflow => {
    const saved = lastUsed.find(record => record.workflowId === workflow.id) ?? null;
    const compatible = libraries.flatMap(library => library.sheets.flatMap(sheet =>
      sheet.workflows.some(coverage => coverage.workflowId === workflow.id && coverage.status === "compatible")
        ? [{ libraryId: library.libraryId, versionId: library.versionId, sheetId: sheet.sheetId, sheetName: sheet.sheetName }] : []));
    return {
    workflowId: workflow.id, requiredWorkbookFields: workflow.requiredWorkbookFields,
    ...(workflow.workbookReference === undefined ? {} : { workbookReference: workflow.workbookReference }),
    lastUsed: saved,
    selectionState: saved === null ? "none" : saved.sources.every(source => compatible.some(candidate =>
      candidate.libraryId === source.libraryId && candidate.sheetId === source.sheetId)) ? "available" : "stale",
    sources: compatible,
    staleSources: saved?.sources.flatMap(source => {
      if (compatible.some(candidate => candidate.libraryId === source.libraryId && candidate.sheetId === source.sheetId)) return [];
      const prior = sources.find(candidate => candidate.libraryId === source.libraryId);
      const reasonCode = prior === undefined || prior.origin.kind !== "local" ? "SOURCE_MISSING" as const
        : prior.removed ? "SOURCE_REMOVED" as const : "MAPPING_CHANGED" as const;
      return [{ ...source, reasonCode }];
    }) ?? [],
  }; }) });
}


const NameSchema = z.string().refine(value => value.trim().length > 0);
/** Tags the operator typed; workflow-derived tags come from `origin` and are never stored here. */
export const WorkbookLibraryTagsSchema = z.array(z.string().min(1).max(40).refine(tag => tag.trim() === tag, { message: "tags are trimmed" })).max(20)
  .refine(tags => new Set(tags.map(tag => tag.toLowerCase())).size === tags.length, { message: "tags must be unique" });
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
  removed: z.boolean(), pinned: z.boolean(), tags: WorkbookLibraryTagsSchema, versions: z.array(WorkbookLibraryVersionSchema).min(1),
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
const CurrentWorkbookLibraryChanges = [
  z.strictObject({ kind: z.literal("sync") }),
  z.strictObject({ kind: z.literal("link"), url: WorkbookLinkSchema.shape.url }),
  z.strictObject({ kind: z.literal("unlink") }),
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
  z.strictObject({ kind: z.literal("pin") }),
  z.strictObject({ kind: z.literal("unpin") }),
  z.strictObject({ kind: z.literal("set-tags"), tags: WorkbookLibraryTagsSchema }),
] as const;
export const WorkbookLibraryChangeSchema = z.discriminatedUnion("kind", CurrentWorkbookLibraryChanges);
const RetainedWorkbookLibraryChangeSchema = z.discriminatedUnion("kind", [
  ...CurrentWorkbookLibraryChanges,
  z.strictObject({ kind: z.literal("merge"), name: NameSchema, duplicates: z.enum(["keep-newer", "keep-both"]),
    sources: z.array(z.strictObject({ libraryId: WorkbookIdSchema, expectedVersion: WorkbookRevisionSchema, expectedRevision: WorkbookRevisionSchema })).min(1)
      .refine(sources => new Set(sources.map(source => source.libraryId)).size === sources.length) }),
]);
export const WorkbookLibraryActionSchema = z.strictObject({
  operationId: WorkbookIdSchema, expectedRevision: WorkbookRevisionSchema,
  expectedVersion: WorkbookRevisionSchema, change: WorkbookLibraryChangeSchema,
});
const RetainedWorkbookLibraryActionSchema = WorkbookLibraryActionSchema.extend({ change: RetainedWorkbookLibraryChangeSchema });
const ActionRecordFields = { libraryId: WorkbookIdSchema, at: IsoInstantSchema, result: WorkbookLibraryStateSchema };
const actionRecordIdentity = (record: { libraryId: string; action: { expectedRevision: number }; result: { libraryId: string; revision: number } }) =>
  record.libraryId === record.result.libraryId && record.result.revision === record.action.expectedRevision + 1;
export const WorkbookLibraryActionRecordSchema = z.strictObject({
  ...ActionRecordFields, action: RetainedWorkbookLibraryActionSchema,
}).refine(actionRecordIdentity);
export const WorkbookLibraryActionResultSchema = z.strictObject({
  ...ActionRecordFields, action: WorkbookLibraryActionSchema,
}).refine(actionRecordIdentity);

export const WorkbookLibraryActionStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("retired"), code: z.literal("WORKBOOK_ACTION_RETIRED"), message: z.literal(ERROR_CATALOG.WORKBOOK_ACTION_RETIRED.text) }),
  z.strictObject({ state: z.literal("recorded"), record: WorkbookLibraryActionResultSchema }),
]);

export type WorkbookLibraryState = z.infer<typeof WorkbookLibraryStateSchema>;
export type WorkbookLibraryEntry = z.infer<typeof WorkbookLibraryEntrySchema>;
export type WorkbookLibraryVersion = z.infer<typeof WorkbookLibraryVersionSchema>;
export type WorkbookLibraryAction = z.infer<typeof WorkbookLibraryActionSchema>;
export type WorkbookLibraryActionResult = z.infer<typeof WorkbookLibraryActionResultSchema>;
export type WorkbookLibraryActionRecord = z.infer<typeof WorkbookLibraryActionRecordSchema>;

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
