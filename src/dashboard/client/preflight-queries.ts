import { FrontendBootstrapWireSchema, type FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import { z } from "zod";
import {
PreflightRerunCommandRequestSchema,
PreflightReadinessWireSchema, PreflightSelectionSchema, type PreflightSelection, type PreflightReadinessWire,
PreflightRerunCommandResultWireSchema,
} from "../../domain/preflight-contract.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


type PreflightRerunCommandResult = z.infer<typeof PreflightRerunCommandResultWireSchema>;


export interface PreflightQueries {
  readPreflight(selection?: PreflightSelection): Promise<PreflightReadinessWire>;
  readiness(): Promise<{ state: "present"; checks: NonNullable<FrontendBootstrapWire["preflight"]> } | { state: "unavailable"; reason: string }>;

  /** DCC2's read-only rerun command, typed here when Settings acquired its control. */
  rerunPreflight(request: unknown): Promise<PreflightRerunCommandResult>;
}

export function createPreflightQueries(transport: DashboardTransport): PreflightQueries { return Object.freeze({
    async readPreflight(selection?: PreflightSelection) {
      const response = selection === undefined
        ? await transport.requestJson("/api/v1/preflight")
        : await transport.requestJson(`/api/v1/preflight?selection=${encodeURIComponent(JSON.stringify(PreflightSelectionSchema.parse(selection)))}`);
      return parseOrThrow(PreflightReadinessWireSchema, "GET /api/v1/preflight", response);
    },
    async readiness() {
      const boot = parseOrThrow(FrontendBootstrapWireSchema, "GET /api/v1/bootstrap", await transport.requestJson("/api/v1/bootstrap"));
      return boot.preflight === undefined ? { state: "unavailable" as const, reason: "Preflight evidence not served." } : { state: "present" as const, checks: boot.preflight };
    },

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
