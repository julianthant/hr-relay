import { deriveSchemaHash, schemaBoundValueSchema, type SchemaBoundCanonicalValue } from "../validation/schema-bound-value.js";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { z } from "zod";
import { CANONICAL_FIELD_IDS } from "../fields/registry.js";
import { IsoInstantSchema, WorkflowIdSchema, LOCAL_OPERATOR_ACTOR_ID, FingerprintSchema } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { IntakeSessionWireSchema } from "../intake/wire.js";
import { IntakeCommandRequestSchema, CommandResultSchema } from "../../rules/commands/commands.js";
import { populatedSpreadsheetValue, workbookSizeIssue } from "../../rules/spreadsheets/workbook-size.js";

export const WorkbookIdSchema = z.string().min(1);
export const WorkbookRevisionSchema = z.number().int().positive();
const NameSchema = z.string().refine(value => value.trim().length > 0);
const IndexSchema = z.number().int().nonnegative();
const ColorSchema = z.strictObject({ argb: z.string().regex(/^(?:[a-f\d]{6}|[a-f\d]{8})$/iu).optional(), theme: IndexSchema.optional(), indexed: IndexSchema.optional(), tint: z.number().min(-1).max(1).optional() });
const FontSchema = z.strictObject({ name: z.string().optional(), size: z.number().finite().optional(), family: z.number().finite().optional(), scheme: z.enum(['minor', 'major', 'none']).optional(), charset: z.number().finite().optional(), color: ColorSchema.optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.union([z.boolean(), z.enum(['none', 'single', 'double', 'singleAccounting', 'doubleAccounting'])]).optional(), vertAlign: z.enum(['superscript', 'subscript']).optional(), strike: z.boolean().optional(), outline: z.boolean().optional() });
const RichTextSchema = z.array(z.strictObject({ text: z.string(), font: FontSchema.optional() }));
const StopsSchema = z.array(z.strictObject({ position: z.number().min(0).max(1), color: ColorSchema })).min(2);
const FillSchema = z.union([
  z.strictObject({ type: z.literal("pattern"), pattern: z.enum(["none", "solid", "darkVertical", "darkHorizontal", "darkGrid", "darkTrellis", "darkDown", "darkUp", "lightVertical", "lightHorizontal", "lightGrid", "lightTrellis", "lightDown", "lightUp", "darkGray", "mediumGray", "lightGray", "gray125", "gray0625"]), fgColor: ColorSchema.optional(), bgColor: ColorSchema.optional() }),
  z.strictObject({ type: z.literal("gradient"), gradient: z.literal("angle"), degree: z.number().finite(), stops: StopsSchema }),
  z.strictObject({ type: z.literal("gradient"), gradient: z.literal("path"), center: z.strictObject({ left: z.number().min(0).max(1), top: z.number().min(0).max(1) }), stops: StopsSchema }),
]);
const FieldSchema = z.string().refine(value => CANONICAL_FIELD_IDS.some(id => id === value) || /^roster\.[a-zA-Z][a-zA-Z\d]*$/u.test(value));
const BindingSchema = z.strictObject({ id: WorkbookIdSchema, sourceColumn: IndexSchema.nullable(), sourceHeader: z.string(), fieldId: FieldSchema.nullable(), basis: z.enum(["header", "values", "manual", "unmapped"]) });
const PrimitiveCellSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const DateCellWireSchema = z.strictObject({ type: z.literal("date"), value: IsoInstantSchema });
function workbookSchema<Value extends z.ZodType>(value: Value) {
  const CellSchema = z.strictObject({ value, fill: FillSchema.optional(), background: z.string().optional(), numFmt: z.string().optional(), richText: RichTextSchema.optional(), hyperlink: z.string().optional(), tooltip: z.string().optional() }).superRefine((cell, ctx) => {
    const original = Reflect.get(cell, 'value');
    if ((cell.richText !== undefined && (cell.richText.map(run => run.text).join('') !== original || cell.hyperlink !== undefined))
      || (cell.hyperlink !== undefined && typeof original !== 'string')
      || (cell.tooltip !== undefined && cell.hyperlink === undefined)) ctx.addIssue({ code: 'custom', message: 'invalid original cell metadata' });
  });
  const SheetSchema = z.strictObject({ id: WorkbookIdSchema, name: NameSchema, rows: z.array(z.strictObject({ id: WorkbookIdSchema, sourceRow: z.number().int().positive().optional(), cells: z.array(CellSchema) })).min(1), width: z.number().int().positive(), hidden: z.array(IndexSchema), headerRow: z.number().int().positive().optional(), sourceHeaderRow: z.number().int().positive().optional(), columnBindings: z.array(BindingSchema).optional() });
  const ThemesSchema = z.union([z.array(z.string()), z.record(z.string().regex(/^[a-zA-Z0-9]+$/u), z.string())]);
  function unique(values: readonly (string | number)[]): boolean { return new Set(values).size === values.length; }
  return z.strictObject({ name: NameSchema, libraryId: WorkbookIdSchema.optional(), sheets: z.array(SheetSchema).min(1), themes: ThemesSchema, hasFormulas: z.boolean(), unsupportedMetadata: z.boolean().optional() }).superRefine((workbook, ctx) => {
    let cells = 0, populatedCells = 0;
    if (!unique(workbook.sheets.map(sheet => sheet.id)) || !unique(workbook.sheets.map(sheet => sheet.name.toLowerCase()))) ctx.addIssue({ code: "custom", message: "duplicate sheets" });
    for (const sheet of workbook.sheets) {
      cells += sheet.rows.length * sheet.width;
      for (const row of sheet.rows) for (const cell of row.cells) if (populatedSpreadsheetValue(Reflect.get(cell, 'value'))) populatedCells++;
      if (!unique(sheet.rows.map(row => row.id)) || sheet.rows.some(row => row.cells.length !== sheet.width)
        || !unique(sheet.hidden) || sheet.hidden.some(column => column >= sheet.width)
        || (sheet.headerRow !== undefined && sheet.headerRow > sheet.rows.length)) ctx.addIssue({ code: "custom", message: "invalid sheet dimensions or identity" });
      if (sheet.columnBindings !== undefined && (sheet.columnBindings.length !== sheet.width
        || !unique(sheet.columnBindings.map(binding => binding.id))
        || !unique(sheet.columnBindings.flatMap(binding => binding.fieldId === null ? [] : [binding.fieldId]))
        || sheet.columnBindings.some(binding => binding.basis === "unmapped" && binding.fieldId !== null))) ctx.addIssue({ code: "custom", message: "invalid column bindings" });
    }
    const sizeIssue = workbookSizeIssue(populatedCells, cells);
    if (sizeIssue) ctx.addIssue({ code: "custom", message: sizeIssue });
  });
}
export const EditableWorkbookSchema = workbookSchema(z.union([PrimitiveCellSchema, z.date()]));
export const EditableWorkbookWireSchema = workbookSchema(z.union([PrimitiveCellSchema, DateCellWireSchema]));
export type EditableWorkbook = z.infer<typeof EditableWorkbookSchema>;
export type EditableWorkbookWire = z.infer<typeof EditableWorkbookWireSchema>;
export const SavedWorkbookSchema = z.strictObject({ libraryId: WorkbookIdSchema, version: z.number().int().positive(), createdAt: IsoInstantSchema, savedAt: IsoInstantSchema, workbook: EditableWorkbookSchema }).refine(record => record.workbook.libraryId === record.libraryId && Date.parse(record.savedAt) >= Date.parse(record.createdAt));
export type SavedWorkbook = z.infer<typeof SavedWorkbookSchema>;
export const SavedWorkbookWireSchema = z.strictObject({ libraryId: WorkbookIdSchema, version: z.number().int().positive(), createdAt: IsoInstantSchema, savedAt: IsoInstantSchema, workbook: EditableWorkbookWireSchema }).refine(record => record.workbook.libraryId === record.libraryId && Date.parse(record.savedAt) >= Date.parse(record.createdAt));
export type SavedWorkbookWire = z.infer<typeof SavedWorkbookWireSchema>;

export function encodeEditableWorkbook(value: unknown): EditableWorkbookWire {
  const workbook = EditableWorkbookSchema.parse(value);
  return EditableWorkbookWireSchema.parse({ ...workbook, sheets: workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, value: cell.value instanceof Date ? { type: "date", value: cell.value.toISOString() } : cell.value })) })) })) });
}
export function decodeEditableWorkbook(value: unknown): EditableWorkbook {
  const workbook = EditableWorkbookWireSchema.parse(value);
  return deepFreeze(EditableWorkbookSchema.parse({ ...workbook, sheets: workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, value: typeof cell.value === "object" && cell.value !== null ? new Date(cell.value.value) : cell.value })) })) })) }));
}
export function encodeSavedWorkbook(value: unknown): SavedWorkbookWire {
  const record = SavedWorkbookSchema.parse(value);
  return SavedWorkbookWireSchema.parse({ ...record, workbook: encodeEditableWorkbook(record.workbook) });
}
export function decodeSavedWorkbook(value: unknown): SavedWorkbook {
  const record = SavedWorkbookWireSchema.parse(value);
  return deepFreeze(SavedWorkbookSchema.parse({ ...record, workbook: decodeEditableWorkbook(record.workbook) }));
}
export const WorkbookListWireSchema = z.array(SavedWorkbookWireSchema);
export const WorkbookHistoryWireSchema = z.array(SavedWorkbookWireSchema);
export const WorkbookCreateRequestSchema = z.strictObject({ workbook: EditableWorkbookWireSchema });
export const WorkbookImportPurposeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-reference"), workflowId: WorkflowIdSchema, typeId: WorkbookIdSchema }),
  z.strictObject({ kind: z.literal("other") }),
]);
export const WorkbookImportRequestSchema = z.strictObject({ workbook: EditableWorkbookWireSchema, purpose: WorkbookImportPurposeSchema });
export const WorkbookImportResultSchema = z.strictObject({ workbook: SavedWorkbookWireSchema, purpose: WorkbookImportPurposeSchema,
  reference: z.strictObject({ workflowId: WorkflowIdSchema, typeId: WorkbookIdSchema, libraryId: WorkbookIdSchema }).nullable(),
}).superRefine((result, ctx) => {
  if (result.purpose.kind === "other" ? result.reference !== null
    : result.reference === null || result.reference.workflowId !== result.purpose.workflowId || result.reference.typeId !== result.purpose.typeId || result.reference.libraryId !== result.workbook.libraryId)
    ctx.addIssue({ code: "custom", message: "import purpose and reference binding differ" });
});
export const WorkbookSaveRequestSchema = z.strictObject({ expectedVersion: z.number().int().positive(), workbook: EditableWorkbookWireSchema });
export const WorkbookIntakeRequestSchema = z.strictObject({ expectedVersion: z.number().int().positive(), workflowId: WorkflowIdSchema });
export const WorkbookIntakeResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.enum(["created", "joined"]), session: IntakeSessionWireSchema }),
  z.strictObject({ state: z.literal("refused"), code: z.string().min(1), message: z.string().min(1) }),
]);
export const IntakeCommandResultWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({ state: z.literal("recorded"), request: IntakeCommandRequestSchema, result: CommandResultSchema }).superRefine((record, context) => {
    if (record.request.commandId !== record.result.commandId || record.request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID
      || record.result.state === "pending"
      || ((record.result.state === "applied" || record.result.state === "already-applied") && (record.result.affectedTargets.filter(target => target.family === "intake").length !== 1 || record.result.affectedTargets.some(target => target.family === "intake" && target.intakeSessionId !== record.request.target.intakeSessionId)))) context.addIssue({ code: "custom", message: "intake command result identity mismatch" });
  }),
]);
export type IntakeCommandResultWire = z.infer<typeof IntakeCommandResultWireSchema>;

const WorkbookReferenceTypeSchema = z.strictObject({
  id: WorkbookIdSchema, name: NameSchema, keyFieldId: FieldSchema.nullable(),
  fields: z.array(FieldSchema), defaultWorkbookId: WorkbookIdSchema.nullable(),
}).superRefine((type, ctx) => {
  if ((type.keyFieldId !== null && !type.fields.includes(type.keyFieldId)) || new Set(type.fields).size !== type.fields.length)
    ctx.addIssue({ code: 'custom', message: 'invalid workbook type fields' });
});
export const WorkbookTypeSchema = WorkbookReferenceTypeSchema.safeExtend({
  fieldLabels: z.record(FieldSchema, NameSchema).optional(), requiredFields: z.array(FieldSchema).optional(),
}).superRefine((type, ctx) => {
  const labels = type.fields.map(field => (type.fieldLabels?.[field] ?? field).trim().toLowerCase());
  if (Object.keys(type.fieldLabels ?? {}).some(field => !type.fields.includes(field)) || new Set(labels).size !== labels.length
    || new Set(type.requiredFields).size !== (type.requiredFields?.length ?? 0)
    || type.requiredFields?.some(field => !type.fields.includes(field))) ctx.addIssue({ code: 'custom', message: 'invalid workbook type column names or required fields' });
});
export const WorkbookLinkSchema = z.strictObject({ url: z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash
    && (url.hostname.endsWith('.sharepoint.com') || url.hostname === 'sharepoint.com');
}), verifiedAt: IsoInstantSchema });
export const WorkbookMetadataSchema = z.strictObject({ typeId: WorkbookIdSchema, sharePoint: WorkbookLinkSchema.nullable() });
const WorkbookCellValueWireSchema = z.union([PrimitiveCellSchema, DateCellWireSchema]);
export const WorkbookCellValuesSchema = z.record(FieldSchema, WorkbookCellValueWireSchema);
export const WorkbookWriteSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('operator') }),
  z.strictObject({ kind: z.literal('run'), runId: z.string().min(1), referenceDigest: FingerprintSchema.optional() }),
  z.strictObject({ kind: z.literal('sync'), syncId: z.string().min(1) }),
]);
export const WorkbookOperationSchema = z.strictObject({
  operationId: WorkbookIdSchema, source: WorkbookWriteSourceSchema, at: IsoInstantSchema,
  change: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('save'), expectedVersion: z.number().int().positive(), workbook: EditableWorkbookWireSchema }),
    z.strictObject({ kind: z.literal('patch'), key: z.string().min(1), values: WorkbookCellValuesSchema,
      expectedVersion: WorkbookRevisionSchema.optional(),
      resolves: z.strictObject({ operationId: WorkbookIdSchema, receiptDigest: z.string().regex(/^[a-f\d]{64}$/u) }).optional(),
      selection: z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema, expectedVersion: z.number().int().positive() }).optional() }),
    z.strictObject({ kind: z.literal('add'), sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema, key: z.string().min(1), values: z.record(FieldSchema, WorkbookCellValueWireSchema) }),
    z.strictObject({ kind: z.literal('sync'), expectedVersion: z.number().int().positive(), workbook: EditableWorkbookWireSchema }),
    z.strictObject({ kind: z.literal('version'), expectedVersion: z.number().int().positive(), name: NameSchema }),
    z.strictObject({ kind: z.literal('metadata'), expectedVersion: z.number().int().positive(), metadata: WorkbookMetadataSchema }),
  ]),
}).superRefine((op, ctx) => {
  if ((['save', 'version', 'metadata'].includes(op.change.kind) && op.source.kind !== 'operator')
    || (op.change.kind === 'sync' && op.source.kind !== 'sync')
    || (['patch', 'add'].includes(op.change.kind) && op.source.kind !== 'run'))
    ctx.addIssue({ code: 'custom', message: 'workbook operation source mismatch' });
});
export const WorkbookCellChangeSchema = z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema,
  fieldId: z.string(), key: z.string().optional(), oldValue: WorkbookCellValueWireSchema, newValue: WorkbookCellValueWireSchema });
export const WorkbookOperationReceiptSchema = z.strictObject({
  operationId: WorkbookIdSchema, sequence: z.number().int().positive(), libraryId: WorkbookIdSchema,
  key: z.string().optional(), state: z.enum(['applied', 'resolve-required', 'refused']), version: z.number().int().positive(),
  reason: z.enum(['missing-key', 'duplicate-key', 'operator-edited', 'stale-selection', 'version-conflict', 'invalid', 'sync-ambiguous', 'metadata-unsupported']).optional(),
  candidates: z.array(z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema })),
  changes: z.array(WorkbookCellChangeSchema), source: WorkbookWriteSourceSchema, at: IsoInstantSchema,
}).superRefine((receipt, ctx) => {
  if ((receipt.state === 'applied') !== (receipt.reason === undefined) || (receipt.state !== 'applied' && receipt.changes.length !== 0))
    ctx.addIssue({ code: 'custom', message: 'invalid workbook receipt state' });
});
export const WorkbookOperatorOperationRequestSchema = WorkbookOperationSchema.shape.change;
export const WorkbookOperationRecordSchema = z.strictObject({ libraryId: WorkbookIdSchema, operation: WorkbookOperationSchema, receipt: WorkbookOperationReceiptSchema });
export type WorkbookOperationRecord = z.infer<typeof WorkbookOperationRecordSchema>;
export const WorkbookNamedVersionSchema = z.strictObject({ name: NameSchema, provenance: z.enum(['operator', 'migration']), snapshot: SavedWorkbookWireSchema });
export const WorkbookReferenceRequestSchema = z.strictObject({ typeId: WorkbookIdSchema, libraryId: WorkbookIdSchema.optional(),
  keys: z.array(z.string().min(1)), fields: z.array(FieldSchema) });
export const WorkbookAllRowsRequestSchema = z.strictObject({ mode: z.literal("all"), typeId: WorkbookIdSchema,
  libraryId: WorkbookIdSchema, expectedVersion: WorkbookRevisionSchema, fields: z.array(FieldSchema) });
export const WorkbookNamedReferenceRequestSchema = WorkbookReferenceRequestSchema.extend({ versionId: WorkbookIdSchema.optional() });
export const WorkbookNamedAllRowsRequestSchema = WorkbookAllRowsRequestSchema.extend({ versionId: WorkbookIdSchema.optional() });
const WorkbookSelectedRowReferenceRequestBaseSchema = z.strictObject({ typeId: WorkbookIdSchema, libraryId: WorkbookIdSchema.optional(),
  versionId: WorkbookIdSchema.optional(), selectedRow: z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema }).optional(),
  keys: z.array(z.string().min(1)), fields: z.array(FieldSchema) });
export const WorkbookSelectedRowReferenceRequestSchema = WorkbookSelectedRowReferenceRequestBaseSchema.refine(request => request.selectedRow === undefined
  || (request.libraryId !== undefined && request.versionId !== undefined && request.keys.length === 1),
{ message: 'selected workbook rows require an explicit library, version and one lookup key' });
export const WorkbookSelectedRowReferenceSnapshotSchema = z.strictObject({ libraryId: WorkbookIdSchema, version: z.number().int().positive(),
  versionId: WorkbookIdSchema.optional(), versionName: NameSchema.optional(),
  worksheets: z.array(z.strictObject({ sheetId: WorkbookIdSchema, name: NameSchema })).min(1),
  type: WorkbookReferenceTypeSchema, rows: z.array(z.strictObject({ key: z.string(), state: z.enum(['matched', 'missing', 'ambiguous']),
    matches: z.array(z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema, values: z.record(FieldSchema, WorkbookCellValueWireSchema) })) })) });
export const RunWorkbookSelectedRowReferenceSchema = z.strictObject({ request: WorkbookSelectedRowReferenceRequestSchema, snapshot: WorkbookSelectedRowReferenceSnapshotSchema }).superRefine((reference, ctx) => {
  const { request, snapshot } = reference;
  const sheets = new Set(snapshot.worksheets.map(sheet => sheet.sheetId));
  if (request.typeId !== snapshot.type.id || request.libraryId !== undefined && request.libraryId !== snapshot.libraryId
    || request.versionId !== undefined && request.versionId !== snapshot.versionId
    || (snapshot.versionId === undefined) !== (snapshot.versionName === undefined)
    || (request.selectedRow !== undefined && snapshot.rows.flatMap(row => row.matches).filter(match =>
      match.sheetId === request.selectedRow?.sheetId && match.rowId === request.selectedRow?.rowId).length !== 1)
    || new Set(request.keys).size !== request.keys.length || new Set(request.fields).size !== request.fields.length
    || sheets.size !== snapshot.worksheets.length || request.keys.length !== snapshot.rows.length
    || snapshot.rows.some((row, index) => row.key !== request.keys[index]
      || row.state !== (row.matches.length === 0 ? 'missing' : row.matches.length === 1 ? 'matched' : 'ambiguous')
      || row.matches.some(match => !sheets.has(match.sheetId)
        || Object.keys(match.values).length !== request.fields.length || request.fields.some(field => !Object.hasOwn(match.values, field))))) {
    ctx.addIssue({ code: 'custom', message: 'run workbook reference must retain its exact requested values and membership' });
  }
});
export const WorkbookSnapshotRequestSchema = z.union([WorkbookReferenceRequestSchema, WorkbookAllRowsRequestSchema,
  WorkbookNamedReferenceRequestSchema, WorkbookNamedAllRowsRequestSchema, WorkbookSelectedRowReferenceRequestSchema]);
export const WorkbookReferenceSnapshotSchema = z.strictObject({ libraryId: WorkbookIdSchema, version: z.number().int().positive(),
  worksheets: z.array(z.strictObject({ sheetId: WorkbookIdSchema, name: NameSchema })).min(1),
  type: WorkbookReferenceTypeSchema, rows: z.array(z.strictObject({ key: z.string(), state: z.enum(['matched', 'missing', 'ambiguous']),
    matches: z.array(z.strictObject({ sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema, values: z.record(FieldSchema, WorkbookCellValueWireSchema) })) })) });
export const WorkbookReferenceLookupSchema = z.union([WorkbookReferenceRequestSchema.pick({ typeId: true, keys: true, fields: true }),
  WorkbookAllRowsRequestSchema.pick({ mode: true, typeId: true, fields: true })]);
export type WorkbookReferenceLookup = z.infer<typeof WorkbookReferenceLookupSchema>;
export const WorkbookRunReferenceSelectionSchema = WorkbookSelectedRowReferenceRequestBaseSchema.pick({ typeId: true, libraryId: true, versionId: true, selectedRow: true })
  .extend({ entry: z.number().int().positive() }).refine(selection => selection.selectedRow === undefined
    || (selection.libraryId !== undefined && selection.versionId !== undefined),
  { message: 'selected workbook rows require an explicit library and version' });
export const RunWorkbookReferenceSchema = z.strictObject({ request: WorkbookReferenceRequestSchema, snapshot: WorkbookReferenceSnapshotSchema }).superRefine((reference, ctx) => {
  const { request, snapshot } = reference;
  const sheets = new Set(snapshot.worksheets.map(sheet => sheet.sheetId));
  if (request.typeId !== snapshot.type.id || request.libraryId !== undefined && request.libraryId !== snapshot.libraryId
    || new Set(request.keys).size !== request.keys.length || new Set(request.fields).size !== request.fields.length
    || sheets.size !== snapshot.worksheets.length || request.keys.length !== snapshot.rows.length
    || snapshot.rows.some((row, index) => row.key !== request.keys[index]
      || row.state !== (row.matches.length === 0 ? 'missing' : row.matches.length === 1 ? 'matched' : 'ambiguous')
      || row.matches.some(match => !sheets.has(match.sheetId)
        || Object.keys(match.values).length !== request.fields.length || request.fields.some(field => !Object.hasOwn(match.values, field))))) {
    ctx.addIssue({ code: 'custom', message: 'run workbook reference must retain its exact requested values and membership' });
  }
});
export const RunWorkbookAllRowsReferenceSchema = z.strictObject({ request: WorkbookAllRowsRequestSchema, snapshot: WorkbookReferenceSnapshotSchema }).superRefine(({ request, snapshot }, ctx) => {
  const sheets = new Set(snapshot.worksheets.map(sheet => sheet.sheetId)), rows = new Set<string>();
  if (request.typeId !== snapshot.type.id || request.libraryId !== snapshot.libraryId || request.expectedVersion !== snapshot.version
    || new Set(request.fields).size !== request.fields.length || sheets.size !== snapshot.worksheets.length
    || snapshot.rows.some(row => row.state !== "matched" || row.matches.length !== 1 || row.matches.some(match => {
      const identity = JSON.stringify([match.sheetId, match.rowId]);
      if (rows.has(identity)) return true;
      rows.add(identity);
      return !sheets.has(match.sheetId) || Object.keys(match.values).length !== request.fields.length
        || request.fields.some(field => !Object.hasOwn(match.values, field));
    }))) ctx.addIssue({ code: "custom", message: "Full workbook reference must retain its exact version, fields and row identities" });
});
export const WorkbookNamedReferenceSnapshotSchema = WorkbookReferenceSnapshotSchema.extend({ versionId: WorkbookIdSchema, versionName: NameSchema });
export const WorkbookSnapshotSchema = z.union([WorkbookReferenceSnapshotSchema, WorkbookNamedReferenceSnapshotSchema]);
export const WorkbookSelectedReferenceSnapshotSchema = WorkbookReferenceSnapshotSchema.extend({ versionId: WorkbookIdSchema.optional(), versionName: NameSchema.optional() });
export const RunWorkbookNamedReferenceSchema = z.strictObject({ request: WorkbookNamedReferenceRequestSchema, snapshot: WorkbookSelectedReferenceSnapshotSchema }).superRefine((reference, ctx) => {
  const { request, snapshot } = reference;
  const sheets = new Set(snapshot.worksheets.map(sheet => sheet.sheetId));
  if (request.typeId !== snapshot.type.id || request.libraryId !== undefined && request.libraryId !== snapshot.libraryId
    || request.versionId !== undefined && request.versionId !== snapshot.versionId
    || (snapshot.versionId === undefined) !== (snapshot.versionName === undefined)
    || new Set(request.keys).size !== request.keys.length || new Set(request.fields).size !== request.fields.length
    || sheets.size !== snapshot.worksheets.length || request.keys.length !== snapshot.rows.length
    || snapshot.rows.some((row, index) => row.key !== request.keys[index]
      || row.state !== (row.matches.length === 0 ? 'missing' : row.matches.length === 1 ? 'matched' : 'ambiguous')
      || row.matches.some(match => !sheets.has(match.sheetId)
        || Object.keys(match.values).length !== request.fields.length || request.fields.some(field => !Object.hasOwn(match.values, field))))) {
    ctx.addIssue({ code: 'custom', message: 'run workbook reference must retain its exact requested values and membership' });
  }
});
export const RunWorkbookNamedAllRowsReferenceSchema = z.strictObject({ request: WorkbookNamedAllRowsRequestSchema, snapshot: WorkbookNamedReferenceSnapshotSchema })
  .superRefine(({ request, snapshot }, ctx) => {
    const { versionId: requested, ...masterRequest } = request;
    const { versionId, versionName: _name, ...masterSnapshot } = snapshot;
    if (requested !== undefined && requested !== versionId || !RunWorkbookAllRowsReferenceSchema.safeParse({ request: masterRequest, snapshot: masterSnapshot }).success)
      ctx.addIssue({ code: "custom", message: "Named full workbook reference must retain its exact selected version and membership" });
  });
export const RunWorkbookSnapshotReferenceSchema = z.union([RunWorkbookReferenceSchema, RunWorkbookAllRowsReferenceSchema,
  RunWorkbookNamedReferenceSchema, RunWorkbookNamedAllRowsReferenceSchema, RunWorkbookSelectedRowReferenceSchema]);
export function parseRunWorkbookReference(bound: SchemaBoundCanonicalValue): z.output<typeof RunWorkbookSnapshotReferenceSchema> {
  for (const schema of [RunWorkbookReferenceSchema, RunWorkbookAllRowsReferenceSchema, RunWorkbookNamedReferenceSchema, RunWorkbookNamedAllRowsReferenceSchema, RunWorkbookSelectedRowReferenceSchema]) {
    const hash = deriveSchemaHash(schema, "output");
    if (bound.schemaHash === hash) return schemaBoundValueSchema(schema, hash).parse(bound).value;
  }
  throw new Error("workbook-reference-schema-invalid");
}
export function bindRunWorkbookReference(requestValue: unknown, snapshot: unknown) {
  const request = WorkbookSnapshotRequestSchema.parse(requestValue);
  const source = WorkbookSnapshotSchema.parse(snapshot);
  const schema = "selectedRow" in request && request.selectedRow !== undefined ? RunWorkbookSelectedRowReferenceSchema : "mode" in request
    ? "versionId" in source ? RunWorkbookNamedAllRowsReferenceSchema : RunWorkbookAllRowsReferenceSchema
    : "versionId" in source ? RunWorkbookNamedReferenceSchema : RunWorkbookReferenceSchema;
  return { schemaHash: deriveSchemaHash(schema, "output"), value: JsonValueSchema.parse(schema.parse({ request, snapshot })) };
}
export type WorkbookType = z.infer<typeof WorkbookTypeSchema>;
export type WorkbookMetadata = z.infer<typeof WorkbookMetadataSchema>;
export type WorkbookOperation = z.infer<typeof WorkbookOperationSchema>;
export type WorkbookOperationReceipt = z.infer<typeof WorkbookOperationReceiptSchema>;

export type RunWorkbookReference = z.infer<typeof RunWorkbookSnapshotReferenceSchema>;
