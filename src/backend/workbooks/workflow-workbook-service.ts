import { z } from "zod";
import { SavedWorkbookSchema, EditableWorkbookSchema, type EditableWorkbook } from "../../models/dashboard/workbooks.js";
import { importSpreadsheet } from "../../models/dashboard/workbook-import.js";
import { WorkflowWorkbookCommandSchema, WorkflowWorkbookResultSchema } from "../../models/processing/workbooks/read-result.js";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { ContentAddressedArtifactWriter } from "../../workflow-kit/artifacts.js";
import type { Clock } from "../../rules/time/clock.js";
import { WorkbookLibraryError, type WorkbookLibraryRepository } from "./workbook-library-service.js";

export function createWorkflowWorkbookService(deps: Readonly<{
  repository: WorkbookLibraryRepository; artifacts: Pick<ContentAddressedArtifactWriter, "open">; clock: Clock;
}>) {
  return Object.freeze({
    async publish(runIdValue: unknown, commandValue: unknown, signal: AbortSignal): Promise<z.output<typeof WorkflowWorkbookResultSchema>> {
      const runId = RunIdSchema.parse(runIdValue), command = WorkflowWorkbookCommandSchema.parse(commandValue);
      const operationId = sha256Hex(`${runId}:${command.operationKey}`);
      const prefix = `workflow:${operationId}:`, marker = `${prefix}${sha256Hex(canonicalJsonStringify(command))}:`;
      const receipt = (libraryId: string, version: number) => WorkflowWorkbookResultSchema.parse({ state: "saved", operationId, libraryId, version });
      // shortcut: replay scans library history; index operations if publication becomes slow.
      const previous = () => {
        for (const current of deps.repository.list()) {
          for (const revision of deps.repository.history(current.libraryId)) {
            const ids = revision.workbook.sheets.flatMap(sheet => [sheet.id, ...sheet.rows.map(row => row.id)]).filter(id => id.startsWith(prefix));
            if (ids.length === 0) continue;
            if (ids.some(id => !id.startsWith(marker))) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
            return receipt(revision.libraryId, revision.version);
          }
        }
        return undefined;
      };
      const prior = previous();
      if (prior !== undefined) return prior;
      let document: EditableWorkbook;
      if (command.source.kind === "table") {
        const table = command.source.table;
        document = EditableWorkbookSchema.parse({ name: table.name, themes: [], hasFormulas: false, sheets: [{
          id: `${marker}sheet`, name: table.name, hidden: [], width: table.columns.length, headerRow: 1,
          rows: [{ id: `${marker}header`, cells: table.columns.map(value => ({ value })) },
            ...table.rows.map(row => ({ id: `${marker}row:${row.id}`, cells: row.values.map(value => ({ value, ...(typeof value === "string" ? { numFmt: "@" } : {}) })) }))],
        }] });
      } else {
        if (command.source.artifact.bytes > 20 * 1024 * 1024) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of await deps.artifacts.open(command.source.artifact)) {
          const parsed = z.instanceof(Uint8Array).safeParse(chunk);
          if (!parsed.success) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT", { cause: parsed.error });
          const bytes = parsed.data;
          size += bytes.length;
          if (size > 20 * 1024 * 1024) throw new WorkbookLibraryError("WORKBOOK_INVALID");
          chunks.push(bytes);
        }
        if (size !== command.source.artifact.bytes) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
        const bytes = Uint8Array.from(Buffer.concat(chunks));
        try {
          const imported = await importSpreadsheet(command.source.name, bytes.buffer);
          document = EditableWorkbookSchema.parse({ ...imported, sheets: imported.sheets.map((sheet, index) => ({ ...sheet,
            id: `${marker}sheet-${index}`, rows: sheet.rows.map((row, ordinal) => ({ ...row, id: `${marker}sheet-${index}:row-${ordinal}` })),
          })) });
        } catch (cause) { throw new WorkbookLibraryError("WORKBOOK_INVALID", { cause }); }
      }
      signal.throwIfAborted();
      const now = deps.clock.now().toISOString();
      const target = command.target;
      try {
        if (target.kind === "create") {
          const libraryId = `workflow:${operationId}`;
          deps.repository.create(SavedWorkbookSchema.parse({ libraryId, version: 1, createdAt: now, savedAt: now,
            workbook: { ...document, name: target.name, libraryId } }));
          return receipt(libraryId, 1);
        }
        const current = deps.repository.read(target.libraryId);
        if (current === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
        if (current.version !== target.expectedVersion) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
        if (target.kind === "append") {
          const sheet = current.workbook.sheets.find(candidate => candidate.id === target.sheetId);
          const incoming = document.sheets[0];
          if (sheet === undefined || incoming === undefined || sheet.width !== incoming.width || sheet.headerRow !== undefined && sheet.headerRow !== 1
            || canonicalJsonStringify(sheet.rows[0].cells.map(cell => cell.value)) !== canonicalJsonStringify(incoming.rows[0].cells.map(cell => cell.value))) {
            throw new WorkbookLibraryError("WORKBOOK_INVALID");
          }
          document = { ...current.workbook, sheets: current.workbook.sheets.map(candidate => candidate === sheet
            ? { ...sheet, rows: [...sheet.rows, ...incoming.rows.slice(1)] } : candidate) };
        } else document = { ...document, libraryId: target.libraryId };
        const workbook = EditableWorkbookSchema.parse(document);
        deps.repository.save(SavedWorkbookSchema.parse({ ...current, version: current.version + 1, savedAt: now, workbook }), current.version);
        return receipt(current.libraryId, current.version + 1);
      } catch (cause) {
        if (cause instanceof WorkbookLibraryError && cause.code === "WORKBOOK_VERSION_CONFLICT") {
          const recovered = previous();
          if (recovered !== undefined) return recovered;
        }
        throw cause;
      }
    },
  });
}
