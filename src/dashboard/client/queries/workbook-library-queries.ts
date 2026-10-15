import type { z } from "zod";
import {
  SavedWorkbookWireSchema, WorkbookListWireSchema, WorkbookHistoryWireSchema,
  WorkbookCreateRequestSchema, WorkbookSaveRequestSchema, WorkbookIntakeRequestSchema,
  WorkbookIntakeResultSchema, encodeEditableWorkbook, decodeSavedWorkbook, type SavedWorkbook,
} from "../../../models/dashboard/workbooks.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { httpError, schemaError } from "../errors.js";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";

export interface WorkbookLibraryQueries {
  workbookList(): Promise<readonly SavedWorkbook[]>;
  workbookOpen(libraryId: string): Promise<SavedWorkbook>;
  workbookCreate(workbook: unknown): Promise<SavedWorkbook>;
  workbookSave(libraryId: string, expectedVersion: number, workbook: unknown): Promise<SavedWorkbook>;
  workbookHistory(libraryId: string): Promise<readonly SavedWorkbook[]>;
  workbookIntake(libraryId: string, expectedVersion: number, workflowId: string): Promise<z.infer<typeof WorkbookIntakeResultSchema>>;
}

function encodeWorkbook(value: unknown) {
  try { return encodeEditableWorkbook(value); }
  catch (cause) { throw schemaError("Workbook request", cause); }
}

function canonicalContent(value: unknown): string {
  return canonicalJsonStringify(JSON.parse(JSON.stringify(value)));
}

export function createWorkbookLibraryQueries(transport: DashboardTransport): WorkbookLibraryQueries {
  return Object.freeze({
    async workbookList() {
      const path = "/api/v1/workbooks/list";
      const records = parseOrThrow(WorkbookListWireSchema, path, await transport.requestJson(path));
      if (new Set(records.map(record => record.libraryId)).size !== records.length) throw schemaError(path, "duplicate workbook identities");
      return records.map(decodeSavedWorkbook);
    },
    async workbookOpen(libraryId: string) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}`;
      const record = parseOrThrow(SavedWorkbookWireSchema, path, await transport.requestJson(path));
      if (record.libraryId !== libraryId) throw schemaError(path, "workbook identity mismatch");
      return decodeSavedWorkbook(record);
    },
    async workbookCreate(workbook: unknown) {
      const path = "/api/v1/workbooks";
      const request = parseOrThrow(WorkbookCreateRequestSchema, path, { workbook: encodeWorkbook(workbook) });
      if (request.workbook.libraryId !== undefined) throw schemaError(path, "new workbook already has a library identity");
      const record = parseOrThrow(SavedWorkbookWireSchema, path, await transport.requestJson(path, { method: "POST", body: JSON.stringify(request) }));
      if (record.version !== 1 || record.createdAt !== record.savedAt
        || canonicalContent(record.workbook) !== canonicalContent({ ...request.workbook, libraryId: record.libraryId })) throw schemaError(path, "created workbook differs from request");
      return decodeSavedWorkbook(record);
    },
    async workbookSave(libraryId: string, expectedVersion: number, workbook: unknown) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}/save`;
      const request = parseOrThrow(WorkbookSaveRequestSchema, path, { expectedVersion, workbook: encodeWorkbook(workbook) });
      if (request.workbook.libraryId !== libraryId) throw schemaError(path, "workbook request identity mismatch");
      const record = parseOrThrow(SavedWorkbookWireSchema, path, await transport.requestJson(path, { method: "POST", body: JSON.stringify(request) }));
      if (record.libraryId !== libraryId || record.version !== expectedVersion + 1
        || canonicalContent(record.workbook) !== canonicalContent(request.workbook)) throw schemaError(path, "saved workbook identity, version or content mismatch");
      return decodeSavedWorkbook(record);
    },
    async workbookHistory(libraryId: string) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}/history`;
      const records = parseOrThrow(WorkbookHistoryWireSchema, path, await transport.requestJson(path));
      if (records.length === 0 || records.some((record, index) => record.libraryId !== libraryId || record.version !== index + 1
        || record.createdAt !== records[0].createdAt)) throw schemaError(path, "workbook history identity or revision order mismatch");
      return records.map(decodeSavedWorkbook);
    },
    async workbookIntake(libraryId: string, expectedVersion: number, workflowId: string) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}/intake`;
      const request = parseOrThrow(WorkbookIntakeRequestSchema, path, { expectedVersion, workflowId });
      const response = await transport.requestJsonResponse(path, { method: "POST", body: JSON.stringify(request) });
      if (response.status !== 200 && response.status !== 201 && response.status !== 422) throw httpError(response.status, response.body);
      const result = parseOrThrow(WorkbookIntakeResultSchema, path, response.body);
      if (result.state === "refused") {
        if (response.status !== 422) throw schemaError(path, "workbook intake refusal status mismatch");
      } else if (response.status !== (result.state === "created" ? 201 : 200)
        || result.session.workflow !== workflowId || result.session.workbookSource?.libraryId !== libraryId
        || result.session.workbookSource.version !== expectedVersion) throw schemaError(path, "workbook intake source, workflow or status mismatch");
      return result;
    },
  });
}
