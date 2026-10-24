import { ASSISTANT_FAILURES, AssistantRequestSchema, AssistantResultSchema, AssistantActionDecisionSchema, AssistantActionResultSchema } from "../../../../models/dashboard/assistant.js";
import type { AssistantService } from "../../../assistant/service.js";
import type { DashboardApp } from "./api-types.js";
import { operatorMutationIngressGuard } from "./operator-mutation-ingress.js";

async function readInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new Error("assistant-body-invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length; if (size > 20_000) throw new Error("assistant-body-invalid");
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
}

export function registerAssistantRoutes(app: DashboardApp, service: (Pick<AssistantService, "respond"> & Partial<Pick<AssistantService, "decide">>) | undefined): void {
  app.use("/api/v1/assistant/respond", operatorMutationIngressGuard);
  app.post("/api/v1/assistant/respond", async c => {
    c.header("Cache-Control", "no-store");
    try {
      const input = AssistantRequestSchema.parse(await readInput(c.req.raw));
      return c.json(AssistantResultSchema.parse(service === undefined
        ? { state: "refused", code: "ASSISTANT_UNAVAILABLE", message: ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE }
        : await service.respond(input, c.req.raw.signal)));
    } catch { return c.json({ state: "refused", code: "ASSISTANT_INVALID", message: ASSISTANT_FAILURES.ASSISTANT_INVALID }, 400); }
  });
  app.use("/api/v1/assistant/action", operatorMutationIngressGuard);
  app.post("/api/v1/assistant/action", async c => {
    c.header("Cache-Control", "no-store");
    try {
      const input = AssistantActionDecisionSchema.parse(await readInput(c.req.raw));
      return c.json(AssistantActionResultSchema.parse(service?.decide === undefined
        ? { state: "refused", code: "ASSISTANT_UNAVAILABLE" } : service.decide(input, c.req.raw.signal)));
    } catch { return c.json({ state: "refused", code: "ASSISTANT_INVALID" }, 400); }
  });
}
