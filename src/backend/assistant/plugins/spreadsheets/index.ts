import { z } from "zod";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { AssistantToolRefusal, referenceSchema, type AssistantPlugin, type AssistantToolContext } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

const Count = z.number().int().nonnegative();
const Worksheets = z.array(z.strictObject({ position: z.number().int().positive(), rows: Count, columns: Count, hiddenColumns: Count }));
const Flags = { formulas: z.boolean(), unsupportedMetadata: z.boolean() };
type Sheet = Readonly<{ rows: readonly unknown[]; width: number; hidden: readonly number[]; headerRow?: number | undefined }>;
/** Rows below the header, as the library catalog counts them. */
export const dataRows = (sheet: Sheet) => sheet.rows.length - (sheet.headerRow ?? 1);
/** Worksheet structure by position: counts only; names, headers and cells never leave. */
export const worksheetFacts = (workbook: Readonly<{ sheets: readonly Sheet[] }>) =>
  workbook.sheets.map((sheet, index) => ({ position: index + 1, rows: dataRows(sheet), columns: sheet.width, hiddenColumns: sheet.hidden.length }));
const flags = (workbook: Readonly<{ hasFormulas: boolean; unsupportedMetadata?: boolean | undefined }>) => ({ formulas: workbook.hasFormulas, unsupportedMetadata: workbook.unsupportedMetadata === true });

/** A library workbook's current entry by `S` reference; removed or missing workbooks are unavailable. */
export function catalogEntry(deps: Pick<AssistantPluginDeps, "workbooks">, context: AssistantToolContext, sheet: string) {
  const libraryId = context.references.resolve(sheet, ["S"]).target;
  const entry = deps.workbooks().catalog().find(candidate => candidate.libraryId === libraryId);
  if (entry === undefined || entry.state.removed) throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE");
  return entry;
}
/** The staged bytes behind an `A` reference of this chat, parsed by the Spreadsheets importer; parse failures are fixed codes. */
export async function attachmentWorkbook(deps: Pick<AssistantPluginDeps, "attachment">, context: AssistantToolContext, file: string) {
  const record = deps.attachment(context.conversationId, context.references.resolve(file, ["A"]).target);
  if (record === undefined) throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNAVAILABLE");
  if (record.mediaType !== "text/csv" && record.mediaType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNSUPPORTED");
  const { importWorkbook } = await import("../../../../rules/spreadsheets/workbook-io.js");
  const workbook = await importWorkbook(record.name, new Uint8Array(record.bytes).buffer).catch(() => { throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_INVALID"); });
  context.assertCurrent();
  return { id: record.id, sha256: record.sha256, workbook };
}

export function spreadsheetsPlugin(deps: AssistantPluginDeps): AssistantPlugin {
  const readParameters = z.strictObject({ view: z.enum(["list", "open", "versions", "types"]), sheet: referenceSchema("S").nullable(), limit: z.number().int().min(1).max(50) });
  const Library = { sheet: referenceSchema("S"), type: referenceSchema("T"), version: z.number().int().positive(), sharePointLinked: z.boolean(), ...Flags };
  const ReadOutput = z.union([
    z.strictObject({ view: z.literal("list"), sheets: z.array(z.strictObject({ ...Library, worksheets: Count, rows: Count })), more: z.boolean() }),
    z.strictObject({ view: z.literal("open"), ...Library, worksheets: Worksheets }),
    z.strictObject({ view: z.literal("versions"), sheet: referenceSchema("S"), versions: z.array(z.strictObject({ version: referenceSchema("V"), revision: z.number().int().positive(),
      savedAt: z.iso.datetime(), source: z.enum(["import", "operator", "sharepoint", "retained", "workflow"]), inUse: z.boolean() })), more: z.boolean() }),
    z.strictObject({ view: z.literal("types"), types: z.array(z.strictObject({ type: referenceSchema("T"), fields: Count, required: Count, workbooks: Count })), more: z.boolean() }),
  ]);
  const inspectParameters = z.strictObject({ file: referenceSchema("A") });
  const InspectOutput = z.strictObject({ file: referenceSchema("A"), worksheets: Worksheets, ...Flags });
  return { domain: "spreadsheets", tools: [{
    kind: "read", tier: "read", name: "read_spreadsheets",
    description: "Read the Spreadsheets library. view list: workbooks up to limit (sheet null). view open: one workbook's worksheets by position with row, column and hidden-column counts. "
      + "view versions: one workbook's named versions with the numeric revision each points at and which is in use. view types: workbook types with field counts (sheet null). "
      + "Workbook, worksheet, type and version names, headers and cell values stay local; refer to them only by reference.",
    parameters: readParameters, output: ReadOutput, privacy: [],
    async invoke(value, context) {
      const { view, sheet, limit } = readParameters.parse(value);
      if ((view === "open" || view === "versions") !== (sheet !== null)) throw new AssistantToolRefusal("ASSISTANT_INVALID");
      const library = (entry: ReturnType<typeof catalogEntry>) => ({ sheet: context.references.issue("S", entry.libraryId, entry.name),
        type: context.references.issue("T", entry.type.id, entry.type.name), version: entry.version, sharePointLinked: entry.metadata.sharePoint !== null });
      if (view === "list") {
        const catalog = deps.workbooks().catalog().filter(entry => !entry.state.removed);
        context.assertCurrent();
        return JsonValueSchema.parse({ view, sheets: catalog.slice(0, limit).map(entry => {
          const record = deps.workbooks().read(entry.libraryId).workbook;
          return { ...library(entry), ...flags(record), worksheets: entry.worksheets.length, rows: entry.rowCount };
        }), more: catalog.length > limit });
      }
      if (view === "types") {
        const types = deps.workbooks().types(), catalog = deps.workbooks().catalog().filter(entry => !entry.state.removed);
        context.assertCurrent();
        return JsonValueSchema.parse({ view, types: types.slice(0, limit).map(type => ({ type: context.references.issue("T", type.id, type.name), fields: type.fields.length,
          required: type.requiredFields?.length ?? 0, workbooks: catalog.filter(entry => entry.type.id === type.id).length })), more: types.length > limit });
      }
      const entry = catalogEntry(deps, context, sheet ?? "");
      if (view === "open") {
        const record = deps.workbooks().read(entry.libraryId).workbook;
        context.assertCurrent();
        return JsonValueSchema.parse({ view, ...library(entry), ...flags(record), worksheets: worksheetFacts(record) });
      }
      context.assertCurrent();
      const versions = entry.state.versions;
      return JsonValueSchema.parse({ view, sheet: context.references.issue("S", entry.libraryId, entry.name), versions: versions.slice(0, limit).map(version => ({
        version: context.references.issue("V", `${entry.libraryId}:${version.id}`, version.name), revision: version.version, savedAt: version.savedAt, source: version.source,
        inUse: version.id === entry.state.selectedVersionId })), more: versions.length > limit });
    },
  }, {
    kind: "read", tier: "read", name: "inspect_attachment",
    description: "Read the structure of an attached spreadsheet (.xlsx or .csv): worksheets by position with row, column and hidden-column counts, and whether it has formulas or unsupported content. "
      + "Its names, headers and values stay local. Nothing is saved.",
    parameters: inspectParameters, output: InspectOutput, privacy: [],
    async invoke(value, context) {
      const { file } = inspectParameters.parse(value);
      const { workbook } = await attachmentWorkbook(deps, context, file);
      return JsonValueSchema.parse({ file, worksheets: worksheetFacts(workbook), ...flags(workbook) });
    },
  }] };
}
