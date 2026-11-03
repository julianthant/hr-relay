import { z } from "zod";
import { SavedWorkbookSchema, EditableWorkbookSchema, type WorkbookOperationReceipt } from "../../models/dashboard/workbooks.js";
import { WorkflowWorkbookCommandSchema, WorkflowWorkbookResultSchema, type WorkbookReferenceWriteSchema } from "../../models/processing/workbooks/read-result.js";
import { RunIdSchema, WorkflowIdSchema, DateOnlySchema } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { Clock } from "../../rules/time/clock.js";
import { WorkbookLibraryError, type WorkbookLibraryRepository } from "./workbook-library-service.js";

export function createWorkflowWorkbookService(deps: Readonly<{ repository: WorkbookLibraryRepository; clock: Clock;
  publicationSource?: () => Readonly<{ workflowId: string; workflowLabel: string; partitionDay: string }>;
  references?: Readonly<{ runId: string; write(command: z.infer<typeof WorkbookReferenceWriteSchema>): WorkbookOperationReceipt }>;
}>) {
  return Object.freeze({
    async publish(runIdValue: unknown, commandValue: unknown, signal: AbortSignal): Promise<z.output<typeof WorkflowWorkbookResultSchema>> {
      const runId = RunIdSchema.parse(runIdValue), command = WorkflowWorkbookCommandSchema.parse(commandValue);
      if ("kind" in command) {
        signal.throwIfAborted();
        if (deps.references === undefined || deps.references.runId !== runId) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const result = deps.references.write(command);
        return WorkflowWorkbookResultSchema.parse({ state: "recorded", operationId: result.operationId,
          libraryId: result.libraryId, version: result.version, receiptState: result.state });
      }
      const source = deps.publicationSource?.();
      if (source === undefined) throw new WorkbookLibraryError("WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE");
      const operationId = sha256Hex(runId), libraryId = `workflow:${operationId}`;
      const marker = `workflow:${operationId}:${sha256Hex(canonicalJsonStringify(command))}:`;
      const receipt = () => WorkflowWorkbookResultSchema.parse({ state: "saved", operationId, libraryId, version: 1 });
      signal.throwIfAborted();
      if (deps.repository.read(libraryId) !== undefined) {
        const original = deps.repository.creation(libraryId);
        if (original === undefined || original.workbook.sheets[0].id !== `${marker}sheet`) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
        const origin = deps.repository.libraryState(libraryId).origin;
        if (origin.kind !== 'workflow' || origin.runId !== runId || origin.workflowId !== source.workflowId) throw new WorkbookLibraryError("WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE");
        return receipt();
      }
      const table = command.table;
      const workbook = EditableWorkbookSchema.parse({ name: command.name, libraryId, themes: [], hasFormulas: false, sheets: [{
        id: `${marker}sheet`, name: table.name, hidden: [], width: table.columns.length, headerRow: 1,
        rows: [{ id: `${marker}header`, cells: table.columns.map(value => ({ value })) },
          ...table.rows.map(row => ({ id: `${marker}row:${row.id}`, cells: row.values.map(value => ({ value, ...(typeof value === "string" ? { numFmt: "@" } : {}) })) }))],
      }] });
      const now = deps.clock.now().toISOString();
      deps.repository.create(SavedWorkbookSchema.parse({ libraryId, version: 1, createdAt: now, savedAt: now, workbook }), {
        kind: 'workflow', runId, partitionDay: DateOnlySchema.parse(source.partitionDay), workflowId: WorkflowIdSchema.parse(source.workflowId), workflowLabel: source.workflowLabel,
        rowCount: table.rows.length, rowSubject: table.rowSubject ?? 'record',
      });
      return receipt();
    },
  });
}
