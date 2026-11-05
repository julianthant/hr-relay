import assert from "node:assert/strict";
import { it } from "vitest";
import type { AssistantInferenceRequest } from "../../../src/models/dashboard/assistant.js";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";
import { completedResponseStream } from "../../support/helpers/chatgpt-response-stream.js";
import { syntheticAssistantTools } from "../../support/helpers/assistant-function-fixtures.js";
import { ChatGptStreamEventTypeSchema } from "../../../src/models/events/timeline.js";

const model = "gpt-6.1-sol", text = "x".repeat(211);
const image = { model, instruction: "Read the synthetic form", input: { kind: "image" as const, mediaType: "image/png" as const, base64: "YQ==" } };
const assistant: AssistantInferenceRequest = { model, reasoning: { effort: "medium" }, input: [{ role: "user", content: "Synthetic request" }], tools: syntheticAssistantTools };
const item = { id: "msg_synthetic", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] };
interface StreamEvent {
  type: string; output_index?: number; item_id?: string; content_index?: number; delta?: string; text?: string;
  item?: Record<string, unknown>; response?: Record<string, unknown>; part?: unknown;
}
function events(): StreamEvent[] {
  return [
    { type: "response.created", response: { id: "resp_synthetic", model, status: "in_progress", output: [] } },
    { type: "response.in_progress", response: { id: "resp_synthetic", model, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { id: item.id, type: "message", status: "in_progress", role: "assistant", content: [] } },
    { type: "response.content_part.added", output_index: 0, item_id: item.id, content_index: 0, part: { type: "output_text", text: "" } },
    ...Array.from({ length: 211 }, (): StreamEvent => ({ type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "x" })),
    { type: "response.output_text.annotation.added", output_index: 0, item_id: item.id, content_index: 0 },
    { type: "response.output_text.done", output_index: 0, item_id: item.id, content_index: 0, text },
    { type: "response.content_part.done", output_index: 0, item_id: item.id, content_index: 0, part: item.content[0] },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_synthetic", model, status: "completed", error: null, incomplete_details: null, output: [] } },
  ];
}
function event(input: StreamEvent[], type: string): StreamEvent {
  const value = input.find(event => event.type === type); assert.ok(value); return value;
}
function wire(input: readonly StreamEvent[]): string { return input.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""); }

for (const operation of ["ocr", "assistant"] as const) {
  for (const contentType of [undefined, "text/event-stream"]) it(`${operation} assembles fragmented done items (${contentType ?? "missing MIME"}) and checks a repeated completed output`, async () => {
    const f = await chatGptFixture();
    try {
      await f.connected();
      let repeatedOutput = false;
      f.setResponse(() => new Response(new ReadableStream<Uint8Array>({ start(controller) {
        const input = events();
        if (repeatedOutput) { const completed = event(input, "response.completed"); completed.response = { ...completed.response, output: [item] }; }
        const bytes = new TextEncoder().encode(wire(input));
        for (let offset = 0; offset < bytes.length; offset += 17) controller.enqueue(bytes.slice(offset, offset + 17));
        controller.close();
      } }), { headers: contentType === undefined ? {} : { "content-type": contentType } }));
      if (operation === "ocr") assert.deepEqual(await f.service.extractText(image), { text, model, responseId: "resp_synthetic" });
      else assert.deepEqual((await f.service.inferAssistant(assistant)).output, [item]);
      repeatedOutput = true;
      if (operation === "ocr") assert.deepEqual(await f.service.extractText(image), { text, model, responseId: "resp_synthetic" });
      else assert.deepEqual((await f.service.inferAssistant(assistant)).output, [item]);
      assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 2);
      assert.equal(ChatGptStreamEventTypeSchema.parse("response.output_text.annotation.added"), "response.output_text.annotation.added");
    } finally { await f.cleanup(); }
  });

  it.each([
    ["missing completed marker", (input: StreamEvent[]) => input.pop()],
    ["missing done item", (input: StreamEvent[]) => input.splice(input.findIndex(event => event.type === "response.output_item.done"), 1)],
    ["missing text done", (input: StreamEvent[]) => input.splice(input.findIndex(event => event.type === "response.output_text.done"), 1)],
    ["missing content part done", (input: StreamEvent[]) => input.splice(input.findIndex(event => event.type === "response.content_part.done"), 1)],
    ["missing content part membership", (input: StreamEvent[]) => input.splice(input.findIndex(event => event.type === "response.content_part.added"), 1)],
    ["duplicate done item", (input: StreamEvent[]) => input.splice(-1, 0, event(input, "response.output_item.done"))],
    ["duplicate text done", (input: StreamEvent[]) => input.splice(-2, 0, event(input, "response.output_text.done"))],
    ["noncontiguous item index", (input: StreamEvent[]) => { event(input, "response.output_item.added").output_index = 1; }],
    ["out-of-range item index", (input: StreamEvent[]) => { event(input, "response.output_item.added").output_index = 32; }],
    ["negative item index", (input: StreamEvent[]) => { event(input, "response.output_item.added").output_index = -1; }],
    ["foreign delta identity", (input: StreamEvent[]) => { event(input, "response.output_text.delta").item_id = "foreign"; }],
    ["foreign done identity", (input: StreamEvent[]) => { const done = event(input, "response.output_item.done"); done.item = { ...done.item, id: "foreign" }; }],
    ["foreign text done identity", (input: StreamEvent[]) => { event(input, "response.output_text.done").item_id = "foreign"; }],
    ["orphan done index", (input: StreamEvent[]) => { event(input, "response.output_item.done").output_index = 1; }],
    ["duplicate added identity", (input: StreamEvent[]) => input.splice(-1, 0, { type: "response.output_item.added", output_index: 1, item: { id: item.id, type: "reasoning" } })],
    ["unfinished added item", (input: StreamEvent[]) => input.splice(-1, 0, { type: "response.output_item.added", output_index: 1, item: { id: "rs_unfinished", type: "reasoning" } })],
    ["unfinished added content part", (input: StreamEvent[]) => input.splice(4, 0, { type: "response.content_part.added", output_index: 0, item_id: item.id, content_index: 1, part: { type: "output_text", text: "" } })],
    ["contradictory done kind", (input: StreamEvent[]) => { const done = event(input, "response.output_item.done"); done.item = { ...done.item, type: "function_call" }; }],
    ["incomplete done item", (input: StreamEvent[]) => { const done = event(input, "response.output_item.done"); done.item = { ...done.item, status: "incomplete" }; }],
    ["orphan content index", (input: StreamEvent[]) => { event(input, "response.output_text.done").content_index = 1; }],
    ["delta disagreement", (input: StreamEvent[]) => { event(input, "response.output_text.delta").delta = "different"; }],
    ["text done disagreement", (input: StreamEvent[]) => { event(input, "response.output_text.done").text = "different"; }],
    ["content part disagreement", (input: StreamEvent[]) => { event(input, "response.content_part.done").part = { type: "output_text", text: "different" }; }],
    ["delta after text done", (input: StreamEvent[]) => input.splice(-2, 0, event(input, "response.output_text.delta"))],
    ["contradictory completed output", (input: StreamEvent[]) => { const done = event(input, "response.completed"); done.response = { ...done.response, output: [{ ...item, id: "foreign" }] }; }],
    ["contradictory completed status", (input: StreamEvent[]) => { const done = event(input, "response.completed"); done.response = { ...done.response, status: "failed" }; }],
    ["contradictory response identity", (input: StreamEvent[]) => { const done = event(input, "response.completed"); done.response = { ...done.response, id: "foreign" }; }],
    ["unselected completed model", (input: StreamEvent[]) => { const done = event(input, "response.completed"); done.response = { ...done.response, model: "foreign-model" }; }],
    ["changed added role", (input: StreamEvent[]) => { const added = event(input, "response.output_item.added"); added.item = { ...added.item, role: "system" }; }],
    ["event after completed", (input: StreamEvent[]) => input.push(event(input, "response.output_item.done"))],
  ] as const)(`${operation} refuses %s`, async (_name, change) => {
    const f = await chatGptFixture();
    try {
      await f.connected(); const input = events(); change(input);
      f.setResponse(() => new Response(new TextEncoder().encode(wire(input))));
      await assert.rejects(operation === "ocr" ? f.service.extractText(image) : f.service.inferAssistant(assistant), { code: "CHATGPT_OCR_INCOMPLETE" });
      assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 1);
    } finally { await f.cleanup(); }
  });

  it(`${operation} refuses terminal-only output without any streamed done item`, async () => {
    const f = await chatGptFixture();
    try {
      await f.connected(); f.setSse(wire([{ type: "response.completed", response: { id: "resp_synthetic", model, status: "completed", output: [item] } }]));
      await assert.rejects(operation === "ocr" ? f.service.extractText(image) : f.service.inferAssistant(assistant), { code: "CHATGPT_OCR_INCOMPLETE" });
    } finally { await f.cleanup(); }
  });
}

it.each(["missing", "identity", "name", "arguments", "duplicate"] as const)("refuses %s function argument completion while preserving reasoning and function validation", async problem => {
  const f = await chatGptFixture();
  try {
    await f.connected();
    const source = completedResponseStream([{ type: "reasoning", id: "rs_synthetic", summary: [], encrypted_content: "opaque-synthetic" },
      { type: "function_call", namespace: "synthetic", name: "answer", call_id: "call_synthetic", arguments: '{"text":"Synthetic","citations":[]}', status: "completed" }]);
    const input = source.trim().split("\n\n").map(frame => JSON.parse(frame.slice(6)) as StreamEvent);
    const done = event(input, "response.function_call_arguments.done");
    if (problem === "missing") input.splice(input.indexOf(done), 1);
    if (problem === "identity") done.item_id = "foreign";
    if (problem === "name") Object.assign(done, { name: "foreign" });
    if (problem === "arguments") Object.assign(done, { arguments: "{}" });
    if (problem === "duplicate") input.splice(input.indexOf(done), 0, done);
    f.setSse(wire(input));
    await assert.rejects(f.service.inferAssistant(assistant), { code: "CHATGPT_OCR_INCOMPLETE" });
  } finally { await f.cleanup(); }
});
