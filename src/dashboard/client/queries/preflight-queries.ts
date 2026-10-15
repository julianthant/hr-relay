import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema, type FrontendBootstrapWire } from "../../../models/dashboard/bootstrap.js";
import { z } from "zod";
import {
PreflightRerunCommandRequestSchema,
PreflightReadinessWireSchema, PreflightSelectionSchema, type PreflightSelection, type PreflightReadinessWire,
PreflightRerunCommandResultWireSchema,
} from "../../../models/preflight/preflight-contract.js";
import { ERROR_CATALOG, createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { DashboardClientError } from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


type PreflightRerunCommandResult = z.infer<typeof PreflightRerunCommandResultWireSchema>;


export interface PreflightQueries {
  preflightScopes(): Promise<z.output<typeof WorkflowBootstrapPrimitiveSchema>[]>;
  readPreflight(selection?: PreflightSelection): Promise<PreflightReadinessWire>;
  readiness(): Promise<{ state: "present"; checks: NonNullable<FrontendBootstrapWire["preflight"]> } | { state: "unavailable"; reason: string }>;

  /** The preflight rerun command, read-only, typed when Settings acquired its control. */
  rerunPreflight(request: unknown): Promise<PreflightRerunCommandResult>;
}

export function createPreflightQueries(transport: DashboardTransport): PreflightQueries { return Object.freeze({
    async preflightScopes() {
      const boot = parseOrThrow(FrontendBootstrapWireSchema, "GET /api/v1/bootstrap", await transport.requestJson("/api/v1/bootstrap"));
      return z.array(WorkflowBootstrapPrimitiveSchema).parse(boot.workflows);
    },
    async readPreflight(selection?: PreflightSelection) {
      try {
      const response = selection === undefined
        ? await transport.requestJson("/api/v1/preflight")
        : await transport.requestJson(`/api/v1/preflight?selection=${encodeURIComponent(JSON.stringify(PreflightSelectionSchema.parse(selection)))}`);
      return parseOrThrow(PreflightReadinessWireSchema, "GET /api/v1/preflight", response);
      } catch { throw new DashboardClientError({ kind: "schema", code: "PREFLIGHT_READ_UNAVAILABLE", message: ERROR_CATALOG.PREFLIGHT_READ_UNAVAILABLE.text }); }
    },
    async readiness() {
      const boot = parseOrThrow(FrontendBootstrapWireSchema, "GET /api/v1/bootstrap", await transport.requestJson("/api/v1/bootstrap"));
      return boot.preflight === undefined ? { state: "unavailable" as const, reason: "Preflight evidence not served." } : { state: "present" as const, checks: boot.preflight };
    },

    async rerunPreflight(request: unknown): Promise<PreflightRerunCommandResult> {
      try {
      const command = PreflightRerunCommandRequestSchema.parse(request);
      const result = parseOrThrow(
        PreflightRerunCommandResultWireSchema,
        "POST /api/v1/preflight/rerun",
        await transport.requestJson("/api/v1/preflight/rerun", {
          method: "POST",
          body: JSON.stringify(command),
        }),
      );
      if (result.commandId !== command.commandId || result.report.configFingerprint !== command.target.expectedConfigFingerprint
        || result.report.descriptorFingerprint !== command.target.expectedDescriptorFingerprint) {
        throw new DashboardClientError({ kind: "schema", code: "COMMAND_RESULT_IDENTITY_MISMATCH",
          message: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_RESULT_IDENTITY_MISMATCH", {})).text });
      }
      return result;
      } catch (error) {
        if (error instanceof DashboardClientError && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH") throw error;
        throw new DashboardClientError({ kind: "schema", code: "PREFLIGHT_RERUN_UNAVAILABLE", message: ERROR_CATALOG.PREFLIGHT_RERUN_UNAVAILABLE.text }); }
    }
}); }
