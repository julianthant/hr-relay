import { z } from "zod";
import {
PreflightRerunCommandRequestSchema,
PreflightRerunCommandResultWireSchema,
} from "../../domain/preflight-contract.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


type PreflightRerunCommandResult = z.infer<typeof PreflightRerunCommandResultWireSchema>;


export interface PreflightQueries {

  /** DCC2's read-only rerun command, typed here when Settings acquired its control. */
  rerunPreflight(request: unknown): Promise<PreflightRerunCommandResult>;
}

export function createPreflightQueries(transport: DashboardTransport): PreflightQueries { return Object.freeze({

    async rerunPreflight(request: unknown): Promise<PreflightRerunCommandResult> {
      const command = PreflightRerunCommandRequestSchema.parse(request);
      return parseOrThrow(
        PreflightRerunCommandResultWireSchema,
        "POST /api/v1/preflight/rerun",
        await transport.requestJson("/api/v1/preflight/rerun", {
          method: "POST",
          body: JSON.stringify(command),
        }),
      );
    }
}); }
