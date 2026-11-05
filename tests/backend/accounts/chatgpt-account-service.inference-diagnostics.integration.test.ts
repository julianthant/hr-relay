import assert from "node:assert/strict";
import { it } from "vitest";
import { createDebugEventWriter } from "../../../src/backend/logs/debug-events.js";
import type { AssistantInferenceRequest } from "../../../src/models/dashboard/assistant.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { chatGptFixture, completedOcrStream } from "../../support/helpers/chatgpt-account-fixtures.js";
import { syntheticAssistantTools } from "../../support/helpers/assistant-function-fixtures.js";
import { debugTimelineFixture } from "../../support/helpers/backend/debug-timeline-fixture.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";

const image = { model: "gpt-6.1-sol", instruction: "PRIVATE_PROMPT_CANARY", input: { kind: "image" as const, mediaType: "image/png" as const, base64: "YQ==" } };
const assistant: AssistantInferenceRequest = { model: image.model, reasoning: { effort: "medium" },
  input: [{ role: "user", content: "PRIVATE_PROMPT_CANARY" }], tools: syntheticAssistantTools };

async function fixture(admission?: Parameters<typeof chatGptFixture>[0]) {
  const f = await chatGptFixture(admission), timeline = debugTimelineFixture(), mirrors: string[] = [];
  f.service.setDebugEvents(createDebugEventWriter({ repository: timeline.repository, clock: f.clock, build: "test", development: true,
    writeStderr: line => { mirrors.push(line); } }));
  return { ...f, mirrors, records: timeline.records };
}

for (const operation of ["ocr", "assistant"] as const) {
  for (const envelope of ["error", "detail"] as const) {
    it.each([
      [429, "subscription_sharing_usage_limit_exceeded", "CHATGPT_USAGE_LIMIT"],
      [503, "subscription_sharing_usage_unavailable", "CHATGPT_USAGE_UNAVAILABLE"],
      [404, "model_not_found", "CHATGPT_MODEL_UNAVAILABLE"],
      [400, "subscription_sharing_unsupported_capability", "CHATGPT_REQUEST_REJECTED"],
      [403, "subscription_sharing_route_not_supported", "CHATGPT_REQUEST_REJECTED"],
      [400, "invalid_request_error", "CHATGPT_REQUEST_REJECTED"],
      [429, "rate_limit_exceeded", "CHATGPT_RATE_LIMITED"],
      [403, "subscription_sharing_user_not_eligible", "CHATGPT_PLAN_DISABLED"],
    ] as const)(`${operation} classifies ${envelope}.code %s/%s without private diagnostics`, async (status, providerCode, code) => {
      const f = await fixture();
      try {
        await f.connected();
        f.setResponse(() => Response.json({ [envelope]: { code: providerCode, message: "PRIVATE_RESPONSE_CANARY synthetic@example.com" } },
          { status, headers: { "x-request-id": "PRIVATE_HEADER_CANARY" } }));
        await assert.rejects(operation === "ocr" ? f.service.extractText(image) : f.service.inferAssistant(assistant), { code, message: ERROR_CATALOG[code].text });
        assert.equal(f.records.length, 1); assert.equal(f.mirrors.length, 1);
        const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
        if (payload.kind !== "debug") throw new Error("inference diagnostic required");
        assert.equal(payload.event.status, status); assert.equal(payload.event.code, code);
        const expected = { operation, path: "http-error", contentType: "application/json", providerCode };
        assert.deepEqual(payload.event.chatGptInference, expected);
        const mirrored: unknown = JSON.parse(f.mirrors[0]);
        assert.ok(mirrored !== null && typeof mirrored === "object" && "chatGptInference" in mirrored);
        assert.deepEqual(mirrored.chatGptInference, expected);
        const logged = JSON.stringify([f.records, f.mirrors]);
        for (const secret of ["CANARY", "synthetic-access", "synthetic-refresh", "synthetic@example.com", "synthetic-subject", "oaiapp_fixture"])
          assert.equal(logged.includes(secret), false, secret);
        assert.equal(f.calls.filter(call => call.url === "https://api.openai.com/v1/responses").length, 1);
      } finally { await f.cleanup(); }
    });
  }
}

it.each([
  ["http-error-body", () => new Response("PRIVATE_RESPONSE_CANARY", { status: 502, headers: { "content-type": "text/html; private=PRIVATE_HEADER_CANARY" } }), "CHATGPT_OCR_FAILED", "text/html"],
  ["http-error", () => Response.json({ error: { code: "PRIVATE_CODE_CANARY", message: "PRIVATE_RESPONSE_CANARY" } }, { status: 500 }), "CHATGPT_OCR_FAILED", "application/json"],
  ["content-type", () => new Response("PRIVATE_RESPONSE_CANARY", { headers: { "content-type": "private/PRIVATE_HEADER_CANARY" } }), "CHATGPT_OCR_FAILED", "other"],
  ["content-type", () => new Response(null, { status: 204 }), "CHATGPT_OCR_FAILED", "missing"],
  ["stream-decode", () => new Response(new Uint8Array([255]), { headers: { "content-type": "text/event-stream" } }), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["stream-json", () => sse("data: PRIVATE_RESPONSE_CANARY\n\n"), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["stream-schema", () => sse('data: {"type":7,"message":"PRIVATE_RESPONSE_CANARY"}\n\n'), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["stream-delta", () => sse('data: {"type":"response.output_text.delta","delta":"PRIVATE_RESPONSE_CANARY","content_index":1}\n\n'), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["stream-error", () => sse('data: {"type":"error","code":null,"message":"PRIVATE_RESPONSE_CANARY"}\n\n'), "CHATGPT_OCR_FAILED", "text/event-stream"],
  ["stream-refusal", () => sse('data: {"type":"response.refusal.delta","delta":"PRIVATE_RESPONSE_CANARY"}\n\n'), "CHATGPT_OCR_FAILED", "text/event-stream"],
  ["response-failed", () => sse('data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"PRIVATE_RESPONSE_CANARY"}}}\n\n'), "CHATGPT_OCR_FAILED", "text/event-stream"],
  ["response-incomplete", () => sse('data: {"type":"response.incomplete","response":{"error":null}}\n\n'), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["terminal-schema", () => sse('data: {"type":"response.completed","response":{"error":null}}\n\n'), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["output-schema", () => sse(completedOcrStream("PRIVATE_RESPONSE_CANARY").replace('"role":"assistant"', '"role":"system"')), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["stream-incomplete", () => sse('data: {"type":"response.output_text.delta","delta":"PRIVATE_RESPONSE_CANARY"}\n\n'), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
] as const)("records the %s failure path without response text", async (path, response, code, contentType) => {
  const f = await fixture();
  try {
    await f.connected(); f.setResponse(response);
    await assert.rejects(f.service.extractText(image), { code });
    assert.equal(f.records.length, 1);
    const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
    if (payload.kind !== "debug") throw new Error("inference diagnostic required");
    assert.equal(payload.event.chatGptInference?.path, path);
    assert.equal(payload.event.chatGptInference?.contentType, contentType);
    assert.equal(payload.event.chatGptInference?.providerCode, path === "http-error" ? "unknown" : path === "response-failed" ? "server_error" : "none");
    assert.equal(JSON.stringify([f.records, f.mirrors]).includes("CANARY"), false);
  } finally { await f.cleanup(); }
});

for (const event of ["error", "response.failed", "response.incomplete"] as const)
  it(`classifies model access midstream in ${event} without accepting partial output`, async () => {
    const f = await fixture();
    try {
      await f.connected();
      f.setResponse(() => sse('data: {"type":"response.output_text.delta","delta":"PRIVATE_RESPONSE_CANARY"}\n\n'
        + `data: ${JSON.stringify({ type: event, response: { error: { code: "model_not_found" } } })}\n\n`));
      await assert.rejects(f.service.inferAssistant(assistant), { code: "CHATGPT_MODEL_UNAVAILABLE" });
      assert.equal(f.records.length, 1);
      const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
      if (payload.kind !== "debug") throw new Error("inference diagnostic required");
      assert.equal(payload.event.chatGptInference?.providerCode, "model_not_found");
      assert.equal(payload.event.chatGptInference?.path, event === "error" ? "stream-error" : event === "response.failed" ? "response-failed" : "response-incomplete");
    } finally { await f.cleanup(); }
  });

it("reports diagnostic persistence failure after closing the response", async () => {
  const f = await fixture(); let cancelled = false;
  try {
    await f.connected();
    f.service.setDebugEvents({ emit() { throw new Error("PRIVATE_LOG_CANARY"); } });
    f.setResponse(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_DIAGNOSTICS_UNAVAILABLE" });
    assert.equal(cancelled, true);
  } finally { await f.cleanup(); }
});

it("keeps actual resource uncertainty when diagnostic persistence also fails", async () => {
  const profile = await createBoundProfileFixture(), f = await fixture(profile.admission);
  try {
    await f.connected();
    f.service.setDebugEvents({ emit() { throw new Error("PRIVATE_LOG_CANARY"); } });
    f.setResponse(() => new Response(new ReadableStream({ cancel() { throw new Error("PRIVATE_CLOSURE_CANARY"); } }), { headers: { "content-type": "application/json" } }));
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    await assert.rejects(f.service.signOut(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    await assert.rejects(f.cleanup(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
  } finally { await profile.close(); }
});

it("records transport failure with no invented HTTP status or content type", async () => {
  const f = await fixture();
  try {
    await f.connected(); f.setResponse(() => { throw new Error("PRIVATE_TRANSPORT_CANARY"); });
    await assert.rejects(f.service.extractText(image), { code: "CHATGPT_AUTH_UNAVAILABLE" });
    assert.equal(f.records.length, 1);
    const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
    if (payload.kind !== "debug") throw new Error("inference diagnostic required");
    assert.equal(payload.event.status, undefined);
    assert.deepEqual(payload.event.chatGptInference, { operation: "ocr", path: "transport", contentType: "missing", providerCode: "none" });
    assert.equal(JSON.stringify([f.records, f.mirrors]).includes("CANARY"), false);
  } finally { await f.cleanup(); }
});

it("keeps successful inference quiet and the request contract unchanged", async () => {
  const f = await fixture();
  try {
    await f.connected(); await f.service.extractText(image);
    assert.deepEqual(f.records, []); assert.deepEqual(f.mirrors, []);
    const call = f.calls.find(call => call.url.endsWith("/responses")); assert.ok(call && typeof call.init.body === "string");
    const wire: unknown = JSON.parse(call.init.body);
    assert.deepEqual(wire, { model: image.model, store: false, stream: true,
      input: [{ role: "user", content: [{ type: "input_text", text: image.instruction }, { type: "input_image", image_url: "data:image/png;base64,YQ==", detail: "high" }] }] });
  } finally { await f.cleanup(); }
});

function sse(text: string): Response { return new Response(text, { headers: { "content-type": "text/event-stream; charset=utf-8" } }); }
