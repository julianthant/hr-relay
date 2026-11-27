import {
  WorkflowExplorerWireSchema,
  type WorkflowExplorerWire,
} from "../../../models/dashboard/explorer.js";
import type { Fingerprint } from "../../../rules/identity/ids.js";
import { parseOrThrow } from "./query-parse.js";
import { schemaError } from "../errors.js";
import type { DashboardTransport } from "../transport.js";

type ExplorerReadOptions = Readonly<{ descriptorHash?: Fingerprint; refresh?: boolean }>;

export interface ExplorerQueries {
  workflowExplorer(signal?: AbortSignal, options?: ExplorerReadOptions): Promise<WorkflowExplorerWire>;
}

export function createExplorerQueries(transport: DashboardTransport): ExplorerQueries {
  let retained: WorkflowExplorerWire | undefined;
  let sequence = 0;
  return Object.freeze({
    async workflowExplorer(signal?: AbortSignal, { descriptorHash, refresh }: ExplorerReadOptions = {}): Promise<WorkflowExplorerWire> {
      signal?.throwIfAborted();
      if (retained !== undefined && retained.descriptorHash === descriptorHash && !refresh) return retained;
      const started = ++sequence;
      const wire = parseOrThrow(WorkflowExplorerWireSchema, "GET /api/v1/explorer",
        await transport.requestJson("/api/v1/explorer", { signal }));
      if (descriptorHash !== undefined && wire.descriptorHash !== descriptorHash) {
        throw schemaError("GET /api/v1/explorer", "Explorer descriptor hash differs from bootstrap");
      }
      signal?.throwIfAborted();
      if (started === sequence && descriptorHash !== undefined) retained = wire;
      return wire;
    },
  });
}
