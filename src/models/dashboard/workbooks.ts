import { z } from "zod";
import { CANONICAL_FIELD_IDS } from "../fields/registry.js";
import { IsoInstantSchema, WorkflowIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { IntakeSessionWireSchema } from "../intake/wire.js";
import { IntakeCommandRequestSchema, CommandResultSchema } from "../../rules/commands/commands.js";

export const WorkbookIdSchema = z.string().min(1);
const NameSchema = z.string().refine(value => value.trim().length > 0);
const IndexSchema = z.number().int().nonnegative();
const ColorSchema = z.strictObject({ argb: z.string().regex(/^(?:[a-f\d]{6}|[a-f\d]{8})$/iu).optional(), theme: IndexSchema.optional(), indexed: IndexSchema.optional(), tint: z.number().min(-1).max(1).optional() });
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
  const CellSchema = z.strictObject({ value, fill: FillSchema.optional(), background: z.string().optional() });
  const SheetSchema = z.strictObject({ id: WorkbookIdSchema, name: NameSchema, rows: z.array(z.strictObject({ id: WorkbookIdSchema, cells: z.array(CellSchema) })).min(1), width: z.number().int().positive(), hidden: z.array(IndexSchema), headerRow: z.number().int().positive().optional(), sourceHeaderRow: z.number().int().positive().optional(), columnBindings: z.array(BindingSchema).optional() });
  const ThemesSchema = z.union([z.array(z.string()), z.record(z.string().regex(/^[a-zA-Z0-9]+$/u), z.string())]);
  function unique(values: readonly (string | number)[]): boolean { return new Set(values).size === values.length; }
  return z.strictObject({ name: NameSchema, libraryId: WorkbookIdSchema.optional(), sheets: z.array(SheetSchema).min(1), themes: ThemesSchema, hasFormulas: z.boolean() }).superRefine((workbook, ctx) => {
    let cells = 0;
    if (!unique(workbook.sheets.map(sheet => sheet.id)) || !unique(workbook.sheets.map(sheet => sheet.name.toLowerCase()))) ctx.addIssue({ code: "custom", message: "duplicate sheets" });
    for (const sheet of workbook.sheets) {
      cells += sheet.rows.length * sheet.width;
      if (!unique(sheet.rows.map(row => row.id)) || sheet.rows.some(row => row.cells.length !== sheet.width)
        || !unique(sheet.hidden) || sheet.hidden.some(column => column >= sheet.width)
        || (sheet.headerRow !== undefined && sheet.headerRow > sheet.rows.length)) ctx.addIssue({ code: "custom", message: "invalid sheet dimensions or identity" });
      if (sheet.columnBindings !== undefined && (sheet.columnBindings.length !== sheet.width
        || !unique(sheet.columnBindings.map(binding => binding.id))
        || !unique(sheet.columnBindings.flatMap(binding => binding.fieldId === null ? [] : [binding.fieldId]))
        || sheet.columnBindings.some(binding => binding.basis === "unmapped" && binding.fieldId !== null))) ctx.addIssue({ code: "custom", message: "invalid column bindings" });
    }
    if (cells > 100_000) ctx.addIssue({ code: "custom", message: "workbook cell limit exceeded" });
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
