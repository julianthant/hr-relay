import { ASSISTANT_FAILURES, AssistantResultSchema } from "../../../../models/dashboard/assistant.js";
import type { AssistantService } from "../../../assistant/service.js";
import type { DashboardApp } from "./api-types.js";
import { operatorMutationIngressGuard } from "./operator-mutation-ingress.js";

export function registerAssistantRoutes(app: DashboardApp, service: AssistantService): void {
  app.post("/api/v1/assistant/respond", operatorMutationIngressGuard, async c => {
    c.header("Cache-Control", "no-store");
    const invalid = () => c.json({ state: "refused", code: "ASSISTANT_INVALID", message: ASSISTANT_FAILURES.ASSISTANT_INVALID }, 400);
    const reader = c.req.raw.body?.getReader();
    if (reader === undefined) return invalid();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      let input: unknown;
      try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length; if (size > 20_000) throw new Error("assistant-body-invalid");
        chunks.push(chunk.value);
      }
      input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
      return c.json(AssistantResultSchema.parse(await service.respond(input, c.req.raw.signal)));
    } catch { return invalid(); }
  });
}
