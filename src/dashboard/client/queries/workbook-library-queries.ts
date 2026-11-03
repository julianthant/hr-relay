import type { z } from "zod";
import {
  SavedWorkbookWireSchema, WorkbookRevisionSchema, WorkbookListWireSchema, WorkbookHistoryWireSchema,
  WorkbookCreateRequestSchema, WorkbookSaveRequestSchema, WorkbookIntakeRequestSchema,
  WorkbookIntakeResultSchema, encodeEditableWorkbook, decodeSavedWorkbook, type SavedWorkbook,
} from "../../../models/dashboard/workbooks.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { httpError, schemaError } from "../errors.js";
import type { DashboardTransport } from "../transport.js";
import { parseOrThrow } from "./query-parse.js";
import { WorkbookLibraryCatalogSchema, WorkbookLibraryActionSchema, WorkbookLibraryActionRecordSchema, WorkbookLibraryActionStatusSchema, WorkbookLibraryVersionViewSchema,
  type WorkbookLibraryEntry, type WorkbookLibraryAction, type WorkbookLibraryActionRecord } from "../../../models/dashboard/workbook-library.js";

export interface WorkbookLibraryQueries {
  workbookCatalog(): Promise<readonly WorkbookLibraryEntry[]>;
  workbookLibraryVersion(libraryId: string, versionId: string): Promise<z.infer<typeof WorkbookLibraryVersionViewSchema>>;
  workbookLibraryAction(libraryId: string, action: WorkbookLibraryAction): Promise<WorkbookLibraryActionRecord>;
  workbookLibraryActionStatus(libraryId: string, operationId: string): Promise<z.infer<typeof WorkbookLibraryActionStatusSchema>>;
  workbookList(): Promise<readonly SavedWorkbook[]>;
  workbookOpen(libraryId: string): Promise<SavedWorkbook>;
  workbookRevision(libraryId: string, version: number): Promise<SavedWorkbook>;
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
    async workbookCatalog() {
      const path = '/api/v1/workbooks/catalog';
      return parseOrThrow(WorkbookLibraryCatalogSchema, path, await transport.requestJson(path));
    },
    async workbookLibraryVersion(libraryId: string, versionId: string) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}/versions/${encodeURIComponent(versionId)}`;
      const view = parseOrThrow(WorkbookLibraryVersionViewSchema, path, await transport.requestJson(path));
      if (view.libraryId !== libraryId || view.version.id !== versionId) throw schemaError(path, 'named version identity mismatch');
      return view;
    },
    async workbookLibraryAction(libraryId: string, value: WorkbookLibraryAction) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}/library-actions`;
      const action = parseOrThrow(WorkbookLibraryActionSchema, path, value);
      const record = parseOrThrow(WorkbookLibraryActionRecordSchema, path, await transport.requestJson(path, { method: 'POST', body: JSON.stringify(action) }));
      if (record.libraryId !== libraryId || canonicalContent(record.action) !== canonicalContent(action)) throw schemaError(path, 'library action identity mismatch');
      return record;
    },
    async workbookLibraryActionStatus(libraryId: string, operationId: string) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}/library-actions/${encodeURIComponent(operationId)}`;
      const status = parseOrThrow(WorkbookLibraryActionStatusSchema, path, await transport.requestJson(path));
      if (status.state === 'recorded' && (status.record.libraryId !== libraryId || status.record.action.operationId !== operationId)) throw schemaError(path, 'library action identity mismatch');
      return status;
    },
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
    async workbookRevision(libraryId: string, version: number) {
      const path = `/api/v1/workbooks/${encodeURIComponent(libraryId)}/revisions/${version}`;
      parseOrThrow(WorkbookRevisionSchema, path, version);
      const record = parseOrThrow(SavedWorkbookWireSchema, path, await transport.requestJson(path));
      if (record.libraryId !== libraryId || record.version !== version) throw schemaError(path, "workbook revision identity mismatch");
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
      if (records.some((record, index) => record.libraryId !== libraryId || (index > 0 && record.version < records[index - 1].version)
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
