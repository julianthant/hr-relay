import { z } from "zod";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { referenceSchema, type AssistantPlugin } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

export function spreadsheetsPlugin(deps: AssistantPluginDeps): AssistantPlugin {
  const parameters = z.strictObject({ includeRemoved: z.boolean() });
  const Output = z.strictObject({ sheets: z.array(z.strictObject({ sheet: referenceSchema("S"), version: z.number().int().positive(),
    worksheets: z.number().int().positive(), rows: z.number().int().nonnegative(), removed: z.boolean() })) });
  return { domain: "spreadsheets", tools: [{
    name: "list_spreadsheets",
    description: "List the workbooks in the Spreadsheets library (removed ones only when asked) with their version, worksheet count and row count. Names, types and cell values stay local; refer to a workbook by its reference.",
    parameters, output: Output, privacy: [],
    async invoke(value, context) {
      const { includeRemoved } = parameters.parse(value);
      const catalog = deps.workbookCatalog().filter(entry => includeRemoved || !entry.state.removed);
      context.assertCurrent();
      return JsonValueSchema.parse({ sheets: catalog.map(entry => ({ sheet: context.references.issue("S", entry.libraryId, entry.name),
        version: entry.version, worksheets: entry.worksheets.length, rows: entry.rowCount, removed: entry.state.removed })) });
    },
  }] };
}
