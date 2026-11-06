import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { it } from "vitest";
import { createChatGptAccountService } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { createDebugEventWriter } from "../../../src/backend/logs/debug-events.js";
import type { AssistantInferenceRequest } from "../../../src/models/dashboard/assistant.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { chatGptFixture, completedOcrStream } from "../../support/helpers/chatgpt-account-fixtures.js";
import { partialTextStream } from "../../support/helpers/chatgpt-response-stream.js";
import { syntheticAssistantTools } from "../../support/helpers/assistant-function-fixtures.js";
import { debugTimelineFixture } from "../../support/helpers/backend/debug-timeline-fixture.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";

const image = { model: "gpt-6.1-sol", instruction: "PRIVATE_PROMPT_CANARY", input: { kind: "image" as const, mediaType: "image/png" as const, base64: "YQ==" } };
const assistant: AssistantInferenceRequest = { model: image.model, reasoning: { effort: "medium" },
  input: [{ role: "user", content: "PRIVATE_PROMPT_CANARY" }], tools: syntheticAssistantTools };

async function fixture(admission?: Parameters<typeof chatGptFixture>[0]) {
  const f = await chatGptFixture(admission), timeline = debugTimelineFixture(), mirrors: string[] = [];
  const debugEvents = createDebugEventWriter({ repository: timeline.repository, clock: f.clock, build: "test", development: true,
    writeStderr: line => { mirrors.push(line); } });
  f.service.setDebugEvents(debugEvents);
  return { ...f, mirrors, records: timeline.records, debugEvents };
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
        const expected = { operation, path: "http-error", contentType: "application/json", providerCode, hasBody: true,
          transport: { source: "injected", status, contentType: "application/json", hasBody: true, redirected: false, target: "missing" } };
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
  ["parse", () => new Response("PRIVATE_RESPONSE_CANARY", { headers: { "content-type": "application/json" } })],
  ["too-large", () => Response.json({ models: [], private: "PRIVATE_RESPONSE_CANARY".repeat(4000) })],
  ["decode", () => new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } })],
  ["missing-body", () => new Response(null, { status: 204 })],
] as const)("records assistant catalog %s failure separately from a verified OCR account", async (jsonFailure, response) => {
  const f = await fixture();
  try {
    await f.connected(); await f.service.extractText(image); const before = f.repository.read();
    f.setModelsHook(async () => response());
    await assert.rejects(f.service.listAssistantModels(), { code: "CHATGPT_MODELS_UNAVAILABLE" });
    assert.deepEqual(f.repository.read(), before); assert.equal(f.records.length, 1);
    const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
    if (payload.kind !== "debug") throw new Error("catalog diagnostic required");
    assert.equal(payload.event.route, "/v1/models"); assert.equal(payload.event.method, "GET");
    assert.equal(payload.event.chatGptInference?.operation, "assistant");
    assert.equal(payload.event.chatGptInference?.path, "catalog-body");
    assert.equal(payload.event.chatGptInference?.jsonFailure, jsonFailure);
    assert.equal(JSON.stringify([f.records, f.mirrors]).includes("CANARY"), false);
  } finally { await f.cleanup(); }
});

it.each(["signature", "claims", "audience", "time", "rotation", "subject"] as const)("records assistant refresh %s failures before any inference request without private values", async cause => {
  const f = await fixture();
  try {
    await f.connected(); const before = f.repository.read(); f.clock.advanceWall(3_600_000);
    if (cause === "signature") f.tamperSignature();
    if (cause === "claims") f.setClaims({ iss: "PRIVATE_ISSUER_CANARY" });
    if (cause === "audience") f.setClaims({ aud: "PRIVATE_AUDIENCE_CANARY" });
    if (cause === "time") f.setClaims({ exp: Math.floor(f.clock.nowMs() / 1000) - 1 });
    if (cause === "rotation") f.setToken({ refresh_token: undefined });
    if (cause === "subject") f.setClaims({ sub: "PRIVATE_SUBJECT_CANARY" });
    await assert.rejects(f.service.inferAssistant(assistant), { code: "CHATGPT_AUTH_INVALID" });
    assert.deepEqual(f.repository.read(), before); assert.equal(f.records.length, 1);
    const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
    if (payload.kind !== "debug") throw new Error("authentication diagnostic required");
    const path = cause === "rotation" || cause === "subject" ? `auth-refresh-${cause}` : `auth-id-token-${cause}`;
    assert.equal(payload.event.chatGptInference?.operation, "assistant"); assert.equal(payload.event.chatGptInference?.path, path);
    assert.equal(payload.event.route, undefined);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    const logged = JSON.stringify([f.records, f.mirrors]);
    for (const value of ["CANARY", "synthetic-access", "synthetic-refresh", "synthetic@example.com", "synthetic-subject", "oaiapp_fixture"]) assert.equal(logged.includes(value), false);
  } finally { await f.cleanup(); }
});

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
  ["output-schema", () => sse(completedOcrStream("PRIVATE_RESPONSE_CANARY").replaceAll('"role":"assistant"', '"role":"system"')), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
  ["stream-incomplete", () => sse(partialTextStream("PRIVATE_RESPONSE_CANARY")), "CHATGPT_OCR_INCOMPLETE", "text/event-stream"],
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
      f.setResponse(() => sse(partialTextStream("PRIVATE_RESPONSE_CANARY")
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

it("preserves native headers and accepts validated headerless streams through the real wrapper for OCR and assistant", async () => {
  const f = await fixture(); let requests = 0, omitContentType = false;
  const server = createServer((request, response) => {
    requests++; request.resume();
    response.writeHead(200, omitContentType ? {} : { "Content-Type": "text/event-stream; charset=utf-8" });
    const stream = omitContentType ? completedOcrStream("Synthetic streamed form").replace('"model":"gpt-6.1-sol","status":"completed",', '"model":"gpt-6.1-sol",') : completedOcrStream("Synthetic streamed form");
    response.write(stream.slice(0, 31)); response.end(stream.slice(31));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address !== null && typeof address !== "string");
  const account = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock,
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      if (url !== "https://api.openai.com/v1/responses") return f.transport(input, init);
      assert.equal(init?.method, "POST"); assert.equal(init.redirect, "error");
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/responses`, init);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), omitContentType ? null : "text/event-stream; charset=utf-8");
      assert.ok(response.body);
      return response;
    } });
  account.setDebugEvents(f.debugEvents);
  try {
    await f.connected();
    assert.deepEqual(await account.extractText(image), { text: "Synthetic streamed form", model: image.model, responseId: "resp_synthetic" });
    const result = await account.inferAssistant(assistant);
    assert.deepEqual(result.output, [{ id: "item_synthetic_0", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Synthetic streamed form" }] }]);
    assert.equal(requests, 2);
    assert.equal(f.records.length, 0);
    omitContentType = true;
    assert.deepEqual(await account.extractText(image), { text: "Synthetic streamed form", model: image.model, responseId: "resp_synthetic" });
    assert.deepEqual((await account.inferAssistant(assistant)).output, result.output);
    assert.equal(requests, 4); assert.equal(f.records.length, 0);
    assert.equal(JSON.stringify([f.records, f.mirrors]).includes("127.0.0.1"), false);
  } finally {
    try { await account.close(); await f.cleanup(); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))); }
  }
});

for (const operation of ["ocr", "assistant"] as const) {
  it.each([
    ["id", null, "null"], ["model", null, "null"], ["model", "PRIVATE MODEL CANARY", "string"],
    ["status", "failed", "string"], ["status", null, "null"], ["output", null, "null"], ["output", Array.from({ length: 33 }, () => null), "array"],
  ] as const)(`${operation} retains value-free terminal shape and event order when %s is invalid`, async (key, invalid, type) => {
    const f = await fixture();
    try {
      await f.connected();
      const terminal = { id: "PRIVATE_ID_CANARY", model: image.model, status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "PRIVATE_TEXT_CANARY" }] }], metadata: { PRIVATE_KEY_CANARY: "PRIVATE_VALUE_CANARY" }, [key]: invalid };
      const events = [{ type: "response.created", response: { id: "PRIVATE_ID_CANARY", model: image.model } }, { type: "PRIVATE_EVENT_CANARY" },
        { type: "response.output_item.added", output_index: 0, item: { id: "PRIVATE_ITEM_CANARY", type: "message" } },
        { type: "response.content_part.added", item_id: "PRIVATE_ITEM_CANARY", output_index: 0, content_index: 0, part: { type: "output_text", text: "" } },
        { type: "response.output_text.delta", item_id: "PRIVATE_ITEM_CANARY", delta: "PRIVATE_TEXT_CANARY", output_index: 0, content_index: 0 },
        { type: "response.completed", sequence_number: 4, response: terminal }];
      f.setResponse(() => new Response(new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""))));
      await assert.rejects(operation === "ocr" ? f.service.extractText(image) : f.service.inferAssistant(assistant), { code: "CHATGPT_OCR_INCOMPLETE" });
      assert.equal(f.records.length, 1);
      const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
      if (payload.kind !== "debug") throw new Error("inference diagnostic required");
      const diagnostic = payload.event.chatGptInference; assert.ok(diagnostic);
      assert.equal(diagnostic.path, "terminal-schema");
      assert.deepEqual(diagnostic.events, { types: ["response.created", "unknown", "response.output_item.added", "response.content_part.added", "response.output_text.delta", "response.completed"], truncated: false });
      assert.ok(diagnostic.terminalShape?.fields.some(field => field.path.join(".") === `response.${key}` && field.type === type));
      assert.ok(diagnostic.terminalShape?.fields.some(field => field.path.join(".") === "response.metadata.*" && field.type === "string"));
      assert.equal(diagnostic.terminalShape?.truncated, false);
      assert.ok(diagnostic.terminalIssues?.issues.some(issue => issue.path.join(".") === `response.${key}`));
      const mirror = JSON.parse(f.mirrors[0]) as { chatGptInference: unknown };
      assert.deepEqual(mirror.chatGptInference, diagnostic);
      assert.equal(JSON.stringify([f.records, f.mirrors]).includes("CANARY"), false);
    } finally { await f.cleanup(); }
  });

  it(`bounds ${operation} event and terminal shape diagnostics without retaining values or array indices`, async () => {
    const f = await fixture();
    try {
      await f.connected();
      const terminal = { type: "response.completed", response: { id: null, model: image.model, status: "completed", output: [],
        metadata: Array.from({ length: 200 }, () => ({ PRIVATE_KEY_CANARY: "PRIVATE_VALUE_CANARY" })) } };
      const prefix = Array.from({ length: 300 }, () => 'data: {"type":"PRIVATE_EVENT_CANARY"}\n\n').join("");
      f.setResponse(() => sse(`${prefix}data: ${JSON.stringify(terminal)}\n\n`));
      await assert.rejects(operation === "ocr" ? f.service.extractText(image) : f.service.inferAssistant(assistant), { code: "CHATGPT_OCR_INCOMPLETE" });
      const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
      if (payload.kind !== "debug") throw new Error("inference diagnostic required");
      const diagnostic = payload.event.chatGptInference; assert.ok(diagnostic);
      assert.equal(diagnostic.events?.types.length, 256); assert.equal(diagnostic.events?.truncated, true);
      assert.ok(diagnostic.terminalShape);
      assert.equal(diagnostic.terminalShape?.fields.length, 128); assert.equal(diagnostic.terminalShape?.truncated, true);
      assert.ok(diagnostic.terminalShape.fields.some(field => field.path.includes("[]")));
      assert.equal(JSON.stringify([f.records, f.mirrors]).includes("CANARY"), false);
      assert.ok(Buffer.byteLength(JSON.stringify(payload.event)) < 64 * 1024);
    } finally { await f.cleanup(); }
  });

  it.each([
    ["empty body", ""],
    ["HTML", "<!doctype html><title>PRIVATE_RESPONSE_CANARY</title>\n\n"],
    ["plain text", "PRIVATE_RESPONSE_CANARY\n\n"],
    ["JSON", JSON.stringify({ type: "response.completed", response: { status: "completed" } })],
    ["invalid event JSON", "data: PRIVATE_RESPONSE_CANARY\n\n"],
    ["invalid terminal", 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'],
    ["partial output", 'data: {"type":"response.output_text.delta","delta":"PRIVATE_RESPONSE_CANARY"}\n\n'],
    ["inconsistent output", completedOcrStream("PRIVATE_RESPONSE_CANARY").replace('"delta":"PRIVATE_RESPONSE_CANARY"', '"delta":"different"')],
  ])(`${operation} refuses headerless %s instead of treating it as successful inference`, async (_name, body) => {
    const f = await fixture();
    try {
      await f.connected();
      f.setResponse(() => new Response(new TextEncoder().encode(body)));
      await assert.rejects(operation === "ocr" ? f.service.extractText(image) : f.service.inferAssistant(assistant), { code: "CHATGPT_OCR_INCOMPLETE" });
      assert.equal(f.records.length, 1);
      const payload = f.records[0].payload; assert.equal(payload.kind, "debug");
      if (payload.kind !== "debug") throw new Error("inference diagnostic required");
      assert.equal(payload.event.chatGptInference?.operation, operation);
      assert.equal(payload.event.chatGptInference?.contentType, "missing");
      assert.equal(payload.event.chatGptInference?.transport?.contentType, "missing");
      assert.equal(JSON.stringify([f.records, f.mirrors]).includes("CANARY"), false);
    } finally { await f.cleanup(); }
  });

  it.each(["application/json", "text/html", "text/plain", "application/octet-stream"])(`${operation} rejects an explicit %s content type even with valid SSE bytes`, async contentType => {
    const f = await fixture();
    try {
      await f.connected(); f.setResponse(() => new Response(completedOcrStream("Synthetic streamed form"), { headers: { "content-type": contentType } }));
      await assert.rejects(operation === "ocr" ? f.service.extractText(image) : f.service.inferAssistant(assistant), { code: "CHATGPT_OCR_FAILED" });
    } finally { await f.cleanup(); }
  });
}
