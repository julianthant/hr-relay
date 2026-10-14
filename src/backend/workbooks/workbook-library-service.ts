import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CANONICAL_FIELD_IDS } from "../../models/fields/registry.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import type { Clock } from "../../rules/time/clock.js";
import { deepFreeze } from "../../rules/validation/immutability.js";

export const WORKBOOK_LIBRARY_ERRORS = Object.freeze({
  WORKBOOK_INVALID: "The workbook is malformed and cannot be saved.",
  WORKBOOK_NOT_FOUND: "The saved workbook was not found.",
  WORKBOOK_VERSION_CONFLICT: "The saved workbook changed. Read its current version before saving.",
  WORKBOOK_STORAGE_CORRUPT: "The saved workbook or its history is corrupt.",
  WORKBOOK_STORAGE_FAILED: "The workbook library storage operation failed.",
});
export class WorkbookLibraryError extends Error {
  constructor(readonly code: keyof typeof WORKBOOK_LIBRARY_ERRORS, options?: ErrorOptions) {
    super(WORKBOOK_LIBRARY_ERRORS[code], options);
    this.name = "WorkbookLibraryError";
  }
}

const IdSchema = z.string().min(1);
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
const BindingSchema = z.strictObject({ id: IdSchema, sourceColumn: IndexSchema.nullable(), sourceHeader: z.string(), fieldId: FieldSchema.nullable(), basis: z.enum(["header", "values", "manual", "unmapped"]) });
const CellSchema = z.strictObject({ value: z.union([z.string(), z.number().finite(), z.boolean(), z.date(), z.null()]), fill: FillSchema.optional(), background: z.string().optional() });
const SheetSchema = z.strictObject({ id: IdSchema, name: NameSchema, rows: z.array(z.strictObject({ id: IdSchema, cells: z.array(CellSchema) })).min(1), width: z.number().int().positive(), hidden: z.array(IndexSchema), headerRow: z.number().int().positive().optional(), sourceHeaderRow: z.number().int().positive().optional(), columnBindings: z.array(BindingSchema).optional() });
const ThemesSchema = z.union([z.array(z.string()), z.record(z.string().regex(/^[a-zA-Z0-9]+$/u), z.string())]);
function unique(values: readonly (string | number)[]): boolean { return new Set(values).size === values.length; }
export const EditableWorkbookSchema = z.strictObject({ name: NameSchema, libraryId: IdSchema.optional(), sheets: z.array(SheetSchema).min(1), themes: ThemesSchema, hasFormulas: z.boolean() }).superRefine((workbook, ctx) => {
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
export type EditableWorkbook = z.infer<typeof EditableWorkbookSchema>;
export const SavedWorkbookSchema = z.strictObject({ libraryId: IdSchema, version: z.number().int().positive(), createdAt: IsoInstantSchema, savedAt: IsoInstantSchema, workbook: EditableWorkbookSchema }).refine(record => record.workbook.libraryId === record.libraryId && Date.parse(record.savedAt) >= Date.parse(record.createdAt));
export type SavedWorkbook = z.infer<typeof SavedWorkbookSchema>;
export interface WorkbookLibraryRepository {
  create(record: SavedWorkbook): SavedWorkbook;
  read(libraryId: string): SavedWorkbook | undefined;
  list(): readonly SavedWorkbook[];
  save(record: SavedWorkbook, expectedVersion: number): SavedWorkbook;
  history(libraryId: string): readonly SavedWorkbook[];
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkbookLibraryError("WORKBOOK_INVALID", { cause: parsed.error });
  return parsed.data;
}
export function createWorkbookLibraryService(deps: Readonly<{ repository: WorkbookLibraryRepository; clock: Clock }>) {
  const read = (libraryId: string): SavedWorkbook => {
    const record = deps.repository.read(input(IdSchema, libraryId));
    if (record === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
    return record;
  };
  return Object.freeze({
    create(value: unknown): SavedWorkbook {
      const workbook = input(EditableWorkbookSchema, value);
      if (workbook.libraryId !== undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      const libraryId = randomUUID(), now = deps.clock.now().toISOString();
      return deps.repository.create(input(SavedWorkbookSchema, { libraryId, version: 1, createdAt: now, savedAt: now, workbook: { ...workbook, libraryId } }));
    },
    read,
    list: () => deps.repository.list(),
    save(libraryId: string, expectedVersion: number, value: unknown): SavedWorkbook {
      const workbook = input(EditableWorkbookSchema, value);
      input(z.number().int().positive(), expectedVersion);
      const current = read(libraryId);
      if (workbook.libraryId !== libraryId) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      return deps.repository.save(input(SavedWorkbookSchema, { ...current, version: expectedVersion + 1, savedAt: deps.clock.now().toISOString(), workbook }), expectedVersion);
    },
    history(libraryId: string): readonly SavedWorkbook[] { read(libraryId); return deps.repository.history(libraryId); },
  });
}
export type WorkbookLibraryService = ReturnType<typeof createWorkbookLibraryService>;

export function serializeSavedWorkbook(record: SavedWorkbook): string {
  const parsed = SavedWorkbookSchema.parse(record);
  return JSON.stringify({ ...parsed, workbook: { ...parsed.workbook, sheets: parsed.workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, value: cell.value instanceof Date ? { type: "date", value: cell.value.toISOString() } : cell.value })) })) })) } });
}
export function deserializeSavedWorkbook(json: string): SavedWorkbook {
  try {
    const tagged = z.strictObject({ type: z.literal("date"), value: IsoInstantSchema });
    const raw: unknown = JSON.parse(json, (key: string, value: unknown) => {
      if (key === "value" && value !== null && typeof value === "object") return new Date(tagged.parse(value).value);
      return value;
    });
    return deepFreeze(SavedWorkbookSchema.parse(raw));
  } catch (cause) { throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT", { cause }); }
}
