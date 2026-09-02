/**
 * Typed mutation surface: the ONE command envelope route plus start-plan
 * minting (ref frontend-backend-integration §3.4). The client validates the request BEFORE it leaves
 * (a malformed command never burns a round trip) and parses the result
 * verbatim — `conflict` and `rejected` are values, not exceptions, because
 * the operator acts on them.
 */
import { z } from "zod";
import {
  BulkRunCommandRequestSchema,
  BulkRunCommandResponseSchema,
  CommandRequestSchema,
  CommandResultSchema,
  SettingsCommandRequestSchema,
  type BulkRunCommandResponse,
  type CommandResult,
} from "../../domain/commands.js";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OperatorXlsxExportIdSchema,
  OperatorXlsxExportRequestSchema,
  OperatorXlsxFileNameSchema,
  type OperatorXlsxExportRequest,
} from "../../domain/dashboard/xlsx-export.js";
import { FingerprintSchema } from "../../domain/ids.js";
import { schemaError } from "./errors.js";
import type { DashboardTransport } from "./transport.js";

/** Mirrors the server's start-plan response wire (server/dashboard owns the shape). */
export const StartPlanResponseSchema = z.strictObject({
  wireVersion: z.literal(1),
  startPlanId: z.string().min(1),
  workflowId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }),
  dryRun: z.boolean(),
  browserMode: z.enum(["headless", "headed"]).optional(),
  captureBrowserScreenshots: z.boolean().optional(),
  priority: z.enum(["interactive", "bulk"]),
  plannedBy: z.string().min(1),
  configSnapshotId: z.string().min(1),
  fingerprints: z.strictObject({
    descriptorFingerprint: z.string().length(64),
    configFingerprint: z.string().length(64),
    ingressSchemaHash: z.string().length(64),
    canonicalInputSchemaHash: z.string().length(64),
    inputFingerprint: z.string().length(64),
  }),
  planned: z.array(z.strictObject({
    runId: z.string().min(1),
    traceId: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().min(1).optional(),
    matchKey: z.string().min(1),
  })),
  refused: z.array(z.strictObject({
    entry: z.number().int().positive(),
    code: z.string().min(1),
    message: z.string().min(1),
  })),
});
export type StartPlanResponse = z.infer<typeof StartPlanResponseSchema>;

export const StartPlanSubmissionSchema = z.strictObject({
  workflowId: z.string().min(1),
  submissions: z.array(z.unknown()).min(1),
  dryRun: z.boolean(),
  browserMode: z.enum(["headless", "headed"]),
  captureBrowserScreenshots: z.boolean(),
  priority: z.enum(["interactive", "bulk"]).optional(),
  requestedInstance: z.record(z.string(), z.enum(["prod", "test"])).optional(),
  selectedStepKeys: z.array(z.string().min(1)).min(1).optional(),
});

export interface DashboardCommands {
  submitStartPlan(input: unknown): Promise<StartPlanResponse>;
  executeCommand(request: unknown): Promise<CommandResult>;
  /** Atomic N-leaf Settings command; request parses before it leaves the browser. */
  applySettings(request: unknown): Promise<CommandResult>;
  /**
   * D235: one request, N CAS-bound transitions, N outcomes. The client parses
   * the vector verbatim for the same reason it parses a single result verbatim
   * — the server is the only party that knows what each run settled as.
   */
  executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse>;
  exportXlsx(request: OperatorXlsxExportRequest): Promise<OperatorXlsxClientDownload>;
}

export interface OperatorXlsxClientDownload {
  readonly exportId: z.infer<typeof OperatorXlsxExportIdSchema>;
  readonly filename: z.infer<typeof OperatorXlsxFileNameSchema>;
  readonly mediaType: typeof OPERATOR_XLSX_MEDIA_TYPE;
  readonly sha256: z.infer<typeof FingerprintSchema>;
  readonly bytes: ArrayBuffer;
}

const OperatorXlsxResponseHeadersSchema = z.strictObject({
  exportId: OperatorXlsxExportIdSchema,
  filename: OperatorXlsxFileNameSchema,
  mediaType: z.literal(OPERATOR_XLSX_MEDIA_TYPE),
  byteLength: z.number().int().positive(),
  sha256: FingerprintSchema,
});

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (value === null) throw new Error(`POST /api/v1/exports/xlsx response omitted ${name}`);
  return value;
}

function fileNameFromContentDisposition(value: string): string {
  const match = /^attachment; filename="([^"]+)"$/u.exec(value);
  if (match?.[1] === undefined) {
    throw new Error("POST /api/v1/exports/xlsx response has malformed content-disposition");
  }
  return match[1];
}

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDashboardCommands(transport: DashboardTransport): DashboardCommands {
  return Object.freeze({
    async submitStartPlan(input: unknown): Promise<StartPlanResponse> {
      const body = StartPlanSubmissionSchema.parse(input);
      const response = await transport.requestJson("/api/v1/start-plans", {
        method: "POST",
        body: JSON.stringify(body),
      });
      try {
        return StartPlanResponseSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/start-plans", error);
      }
    },
    async executeCommand(request: unknown): Promise<CommandResult> {
      const command = CommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      try {
        return CommandResultSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/commands", error);
      }
    },
    async applySettings(request: unknown): Promise<CommandResult> {
      const command = SettingsCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      try {
        return CommandResultSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/commands", error);
      }
    },
    async executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse> {
      const bulk = BulkRunCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands/bulk", {
        method: "POST",
        body: JSON.stringify(bulk),
      });
      try {
        return BulkRunCommandResponseSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/commands/bulk", error);
      }
    },
    async exportXlsx(input: OperatorXlsxExportRequest): Promise<OperatorXlsxClientDownload> {
      const request = OperatorXlsxExportRequestSchema.parse(input);
      const response = await transport.requestBinary("/api/v1/exports/xlsx", {
        method: "POST",
        body: JSON.stringify(request),
      });
      let headers: z.infer<typeof OperatorXlsxResponseHeadersSchema>;
      try {
        const etag = requiredHeader(response.headers, "etag");
        headers = OperatorXlsxResponseHeadersSchema.parse({
          exportId: requiredHeader(response.headers, "x-operator-export-id"),
          filename: fileNameFromContentDisposition(requiredHeader(response.headers, "content-disposition")),
          mediaType: requiredHeader(response.headers, "content-type"),
          byteLength: Number(requiredHeader(response.headers, "content-length")),
          sha256: /^"([0-9a-f]{64})"$/u.exec(etag)?.[1],
        });
      } catch (error) {
        throw schemaError("POST /api/v1/exports/xlsx", error);
      }
      if (response.bytes.byteLength !== headers.byteLength) {
        throw schemaError(
          "POST /api/v1/exports/xlsx",
          new Error(`body has ${String(response.bytes.byteLength)} bytes but header records ${String(headers.byteLength)}`),
        );
      }
      const actualDigest = await sha256Of(response.bytes);
      if (actualDigest !== headers.sha256) {
        throw schemaError(
          "POST /api/v1/exports/xlsx",
          new Error(`body digest ${actualDigest} disagrees with ${headers.sha256}`),
        );
      }
      return Object.freeze({ ...headers, bytes: response.bytes });
    },
  });
}
