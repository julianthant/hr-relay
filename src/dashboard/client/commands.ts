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
  type BulkRunCommandResponse,
  type CommandResult,
} from "../../domain/commands.js";
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
  priority: z.enum(["interactive", "bulk"]).optional(),
  requestedInstance: z.record(z.string(), z.enum(["prod", "test"])).optional(),
  selectedStepKeys: z.array(z.string().min(1)).min(1).optional(),
});

export interface DashboardCommands {
  submitStartPlan(input: unknown): Promise<StartPlanResponse>;
  executeCommand(request: unknown): Promise<CommandResult>;
  /**
   * D235: one request, N CAS-bound transitions, N outcomes. The client parses
   * the vector verbatim for the same reason it parses a single result verbatim
   * — the server is the only party that knows what each run settled as.
   */
  executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse>;
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
  });
}
