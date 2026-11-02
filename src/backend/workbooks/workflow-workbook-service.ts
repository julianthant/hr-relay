import { z } from "zod";
import { SavedWorkbookSchema, EditableWorkbookSchema } from "../../models/dashboard/workbooks.js";
import { WorkflowWorkbookCommandSchema, WorkflowWorkbookResultSchema } from "../../models/processing/workbooks/read-result.js";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { Clock } from "../../rules/time/clock.js";
import { WorkbookLibraryError, type WorkbookLibraryRepository } from "./workbook-library-service.js";

export function createWorkflowWorkbookService(deps: Readonly<{ repository: WorkbookLibraryRepository; clock: Clock }>) {
  return Object.freeze({
    async publish(runIdValue: unknown, commandValue: unknown, signal: AbortSignal): Promise<z.output<typeof WorkflowWorkbookResultSchema>> {
      const runId = RunIdSchema.parse(runIdValue), command = WorkflowWorkbookCommandSchema.parse(commandValue);
      const operationId = sha256Hex(runId), libraryId = `workflow:${operationId}`;
      const marker = `workflow:${operationId}:${sha256Hex(canonicalJsonStringify(command))}:`;
      const receipt = () => WorkflowWorkbookResultSchema.parse({ state: "saved", operationId, libraryId, version: 1 });
      signal.throwIfAborted();
      if (deps.repository.read(libraryId) !== undefined) {
        const original = deps.repository.history(libraryId)[0];
        if (original === undefined || original.workbook.sheets[0].id !== `${marker}sheet`) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
        return receipt();
      }
      const table = command.table;
      const workbook = EditableWorkbookSchema.parse({ name: command.name, libraryId, themes: [], hasFormulas: false, sheets: [{
        id: `${marker}sheet`, name: table.name, hidden: [], width: table.columns.length, headerRow: 1,
        rows: [{ id: `${marker}header`, cells: table.columns.map(value => ({ value })) },
          ...table.rows.map(row => ({ id: `${marker}row:${row.id}`, cells: row.values.map(value => ({ value, ...(typeof value === "string" ? { numFmt: "@" } : {}) })) }))],
      }] });
      const now = deps.clock.now().toISOString();
      deps.repository.create(SavedWorkbookSchema.parse({ libraryId, version: 1, createdAt: now, savedAt: now, workbook }));
      return receipt();
    },
  });
}
