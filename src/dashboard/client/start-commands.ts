import { z } from "zod";
import { RerunWarningRequestSchema, RerunWarningWireSchema, type RerunWarningWire } from "../../domain/dashboard/rerun-warning.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { RerunPlanRefusalCodeSchema } from "../../domain/run/rerun.js";
import { StartPlanRequestSchema,StartPlanWireSchema,type StartPlanWire } from "../../domain/dashboard/start-plan.js";
import { DashboardClientError, httpError, schemaError } from "./errors.js";
import type { DashboardTransport } from "./transport.js";


/**
 * The start plan's request and response are owned by `domain/dashboard/start-plan.ts`
 * and imported here; `StartPlanResponse` is the surfaces' name for the wire.
 */
export type StartPlanResponse = StartPlanWire;


const RerunRefusalSchema = z.strictObject({ state: z.literal("error"), code: z.literal("RERUN_REFUSED"), message: z.string().min(1),
  retryable: z.literal(false), refusalCode: RerunPlanRefusalCodeSchema });
export class StartPlanRefusalError extends DashboardClientError {
  readonly refusalCode: z.infer<typeof RerunPlanRefusalCodeSchema>;
  constructor(status: number, body: z.infer<typeof RerunRefusalSchema>) {
    super({ kind: "http", status, code: body.code, message: body.message });
    this.refusalCode = body.refusalCode;
  }
}

export interface StartCommands {
  previewRerunWarnings(input: unknown): Promise<RerunWarningWire>;

  submitStartPlan(input: unknown): Promise<StartPlanResponse>;
}

export function createStartCommands(transport: DashboardTransport): StartCommands { return Object.freeze({
    async previewRerunWarnings(input: unknown): Promise<RerunWarningWire> {
      const body = RerunWarningRequestSchema.parse(input);
      const response = await transport.requestJsonResponse("/api/v1/rerun-warnings", { method: "POST", body: JSON.stringify(body) });
      if (!response.ok) {
        const refusal = RerunRefusalSchema.safeParse(response.body);
        if (refusal.success && (response.status === 404 || response.status === 409)) throw new StartPlanRefusalError(response.status, refusal.data);
        throw httpError(response.status, response.body);
      }
      const warning = RerunWarningWireSchema.parse(response.body);
      if (warning.workflowId !== body.workflowId || canonicalJsonStringify(warning.rerun.source) !== canonicalJsonStringify(body.source)) {
        throw new Error("RERUN_WARNING_IDENTITY_MISMATCH");
      }
      return warning;
    },

    async submitStartPlan(input: unknown): Promise<StartPlanResponse> {
      const body = StartPlanRequestSchema.parse(input);
      const response = await transport.requestJsonResponse("/api/v1/start-plans", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const refusal = RerunRefusalSchema.safeParse(response.body);
        if (refusal.success && (response.status === 404 || response.status === 409)) throw new StartPlanRefusalError(response.status, refusal.data);
        throw httpError(response.status, response.body);
      }
      try {
        return StartPlanWireSchema.parse(response.body);
      } catch (error) {
        throw schemaError("POST /api/v1/start-plans", error);
      }
    }
}); }
