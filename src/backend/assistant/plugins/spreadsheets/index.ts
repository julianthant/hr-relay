import { z } from "zod";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { referenceSchema, type AssistantPlugin } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

export function spreadsheetsPlugin(deps: AssistantPluginDeps): AssistantPlugin {
  const parameters = z.strictObject({ limit: z.number().int().min(1).max(50) });
  const Output = z.strictObject({ sheets: z.array(z.strictObject({ sheet: referenceSchema("S"), version: z.number().int().positive(),
    worksheets: z.number().int().positive(), rows: z.number().int().nonnegative() })), more: z.boolean() });
  return { domain: "spreadsheets", tools: [{
    kind: "read", name: "list_spreadsheets",
    description: "List the workbooks in the Spreadsheets library, up to limit with their version, worksheet count and row count. Names, types and cell values stay local; refer to a workbook by its reference.",
    parameters, output: Output, privacy: [],
    async invoke(value, context) {
      const { limit } = parameters.parse(value);
      const catalog = deps.workbookCatalog();
      context.assertCurrent();
      return JsonValueSchema.parse({ sheets: catalog.slice(0, limit).map(entry => ({ sheet: context.references.issue("S", entry.libraryId, entry.name),
        version: entry.version, worksheets: entry.worksheets.length, rows: entry.rowCount })), more: catalog.length > limit });
    },
  }] };
}
