import { WorkflowExplorerWireSchema, type WorkflowExplorerWire } from "../../../models/dashboard/explorer.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";

export interface ExplorerQueries {
  workflowExplorer(): Promise<WorkflowExplorerWire>;
}

export function createExplorerQueries(transport: DashboardTransport): ExplorerQueries {
  return Object.freeze({
    async workflowExplorer(): Promise<WorkflowExplorerWire> {
      return parseOrThrow(WorkflowExplorerWireSchema, "GET /api/v1/explorer",
        await transport.requestJson("/api/v1/explorer"));
    },
  });
}
