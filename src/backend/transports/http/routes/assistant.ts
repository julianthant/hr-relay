import { wireError } from "./failure-status.js";
import { z } from "zod";
import { ASSISTANT_FAILURES, ASSISTANT_HISTORY_BODY_MAX_BYTES, AssistantModelPreferenceViewSchema, AssistantM1RequestSchema, AssistantM1RespondEnvelopeSchema,
  AssistantActivityWireSchema, AssistantM1ConversationWireSchema, AssistantHistoryOperationSchema, AssistantHistoryResultSchema, AssistantHistoryWireSchema, AssistantStageResultSchema } from "../../../../models/dashboard/assistant.js";
import type { AssistantService } from "../../../assistant/service.js";
import type { DashboardApp } from "./api-types.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
import { AssistantAttachmentRefusal } from "../../../assistant/attachments.js";

async function readInput(request: Request, maxBytes = 20_000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new Error("assistant-body-invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length; if (size > maxBytes) throw new Error("assistant-body-invalid");
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
}

/** Reads a raw upload with a real byte counter; overflow and abort cancel the stream before more is buffered. */
async function readUpload(request: Request, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new AssistantAttachmentRefusal("ASSISTANT_ATTACHMENT_TOO_LARGE");
      chunks.push(chunk.value);
    }
    signal.throwIfAborted();
    return new Uint8Array(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener("abort", abort);
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}
const UNAVAILABLE_NO_REPLY = { kind: "result", result: { state: "no-reply", reason: "ASSISTANT_UNAVAILABLE", canRetry: false, turn: null } } as const;
const uploadName = (value: string | undefined) => decodeURIComponent(value ?? "");

export function registerAssistantRoutes(app: DashboardApp, service: AssistantService | undefined): void {
  app.get("/api/v1/assistant/models", c => {
    c.header("Cache-Control", "no-store");
    try {
      if (service?.models === undefined) return c.json(wireError("ASSISTANT_UNAVAILABLE", ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE, false), 503);
      return c.json(service.models());
    } catch { return c.json(wireError("ASSISTANT_UNAVAILABLE", ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE, false), 503); }
  });
  app.get("/api/v1/assistant/model-preference", c => {
    c.header('cache-control', 'no-store');
    try {
      if (service?.modelPreference === undefined) return c.json(wireError('ASSISTANT_UNAVAILABLE', ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE, false), 503);
      return c.json(AssistantModelPreferenceViewSchema.parse(service.modelPreference()));
    } catch { return c.json(wireError('ASSISTANT_UNAVAILABLE', ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE, false), 503); }
  });
  app.use("/api/v1/assistant/respond", operatorMutationIngressGuard);
  app.post("/api/v1/assistant/respond", async c => {
    c.header("Cache-Control", "no-store");
    try {
      const input = AssistantM1RequestSchema.parse(await readInput(c.req.raw));
      return c.json(AssistantM1RespondEnvelopeSchema.parse(service === undefined ? UNAVAILABLE_NO_REPLY : await service.respond(input, c.req.raw.signal)));
    } catch { return c.json({ kind: "result", result: { state: "no-reply", reason: "ASSISTANT_INVALID", canRetry: false, turn: null } }, 400); }
  });
  const HISTORY_UNAVAILABLE = ["ASSISTANT_HISTORY_UNAVAILABLE", ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE, false] as const;
  app.get("/api/v1/assistant/activity", c => {
    c.header("Cache-Control", "no-store");
    const input = z.strictObject({ search: z.string().max(200).optional() }).safeParse(c.req.query());
    if (!input.success) return c.json(wireError("ASSISTANT_INVALID", ASSISTANT_FAILURES.ASSISTANT_INVALID, false), 400);
    try {
      if (service?.activity === undefined) return c.json(wireError(...HISTORY_UNAVAILABLE), 503);
      return c.json(AssistantActivityWireSchema.parse(service.activity(input.data.search)));
    } catch { return c.json(wireError(...HISTORY_UNAVAILABLE), 503); }
  });
  app.use("/api/v1/assistant/history", operatorMutationIngressGuard);
  app.get("/api/v1/assistant/history", c => {
    c.header("Cache-Control", "no-store");
    try {
      if (service?.historyView === undefined) return c.json(wireError(...HISTORY_UNAVAILABLE), 503);
      return c.json(AssistantHistoryWireSchema.parse(service.historyView()));
    } catch { return c.json(wireError(...HISTORY_UNAVAILABLE), 503); }
  });
  app.get("/api/v1/assistant/conversations/:conversationId", c => {
    c.header("Cache-Control", "no-store");
    try {
      if (service?.conversation === undefined) return c.json(wireError(...HISTORY_UNAVAILABLE), 503);
      const view = service.conversation(c.req.param("conversationId"));
      return view === undefined ? c.json(wireError("ASSISTANT_CONVERSATION_STALE", ASSISTANT_FAILURES.ASSISTANT_CONVERSATION_STALE, false), 404)
        : c.json(AssistantM1ConversationWireSchema.parse(view));
    } catch { return c.json(wireError(...HISTORY_UNAVAILABLE), 503); }
  });
  app.post("/api/v1/assistant/history", async c => {
    c.header("Cache-Control", "no-store");
    let input;
    try { input = AssistantHistoryOperationSchema.parse(await readInput(c.req.raw, ASSISTANT_HISTORY_BODY_MAX_BYTES)); }
    catch { return c.json({ state: "refused", code: "ASSISTANT_INVALID" }, 400); }
    try {
      if (service?.history === undefined) return c.json(wireError(...HISTORY_UNAVAILABLE), 503);
      return c.json(AssistantHistoryResultSchema.parse(service.history(input)));
    } catch { return c.json(wireError(...HISTORY_UNAVAILABLE), 503); }
  });
  // Upload bytes use the file media type; Host/Origin admission still applies before any byte is read.
  app.use("/api/v1/assistant/conversations/:conversationId/attachments", operatorOpaqueIngressGuard);
  app.post("/api/v1/assistant/conversations/:conversationId/attachments", async c => {
    c.header("Cache-Control", "no-store");
    if (service?.stage === undefined) return c.json(wireError("ASSISTANT_UNAVAILABLE", ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE, false), 503);
    try {
      const result = AssistantStageResultSchema.parse(await service.stage({ conversationId: c.req.param("conversationId"), contentType: c.req.header("content-type"),
        name: uploadName(c.req.header("x-relay-file-name")), read: (maxBytes, signal) => readUpload(c.req.raw, maxBytes, signal) }, c.req.raw.signal));
      return c.json(result, result.state === "staged" ? 201 : 422);
    } catch { return c.json(wireError("ASSISTANT_UNAVAILABLE", ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE, false), 503); }
  });
}
