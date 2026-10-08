import {
ExplorerEditDraftSchema,
ExplorerEditValidationResultSchema,
WorkflowExplorerWireSchema,
type ExplorerEditValidationResult,
type WorkflowExplorerWire,
} from "../../../domain/dashboard/explorer.js";
import {
httpError
} from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


export interface ExplorerQueries {

  /** The graph projection itself remains read-only (D176); DCC5 validates its closed edit subset below. */
  workflowExplorer(): Promise<WorkflowExplorerWire>;

  /**
   * DCC5's review door. Validation is a typed answer (including refusal and
   * conflict), not an exception inferred from an HTTP status.
   */
  validateExplorerEdit(input: unknown): Promise<ExplorerEditValidationResult>;

}

export function createExplorerQueries(transport: DashboardTransport): ExplorerQueries { return Object.freeze({

    async workflowExplorer(): Promise<WorkflowExplorerWire> {
      return parseOrThrow(
        WorkflowExplorerWireSchema,
        "GET /api/v1/explorer",
        await transport.requestJson("/api/v1/explorer"),
      );
    },

    async validateExplorerEdit(input: unknown): Promise<ExplorerEditValidationResult> {
      const draft = ExplorerEditDraftSchema.parse(input);
      const path = "/api/v1/explorer/validate";
      const response = await transport.requestJsonResponse(path, {
        method: "POST",
        body: JSON.stringify(draft),
      });
      if (response.status !== 200 && response.status !== 409 && response.status !== 422) {
        throw httpError(response.status, response.body);
      }
      return parseOrThrow(ExplorerEditValidationResultSchema, `POST ${path}`, response.body);
    }
}); }
