import assert from "node:assert/strict";
import { it } from "vitest";
import { chatGptFixture, completedOcrStream } from "../../support/helpers/chatgpt-account-fixtures.js";
const turn = { action: "answer", text: "Synthetic explanation", citations: [] };
const request = { model: "gpt-6.1-sol", input: JSON.stringify({ message: "Explain dry run" }) };
it("uses private admitted subscription transport with fixed roles and strict assistant output", async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); f.setSse(completedOcrStream(JSON.stringify(turn)));
    assert.deepEqual(await f.service.inferAssistant(request), turn);
    const call = f.calls.find(call => call.url.endsWith("/responses")); assert.ok(call && typeof call.init.body === "string");
    const wire = JSON.parse(call.init.body) as { store: boolean; stream: boolean; input: { role: string }[] };
    assert.equal(wire.store, false); assert.equal(wire.stream, true); assert.deepEqual(wire.input.map(message => message.role), ["developer", "user"]);
    assert.equal(call.init.body.includes("synthetic-access"), false);
    await assert.rejects(f.service.inferAssistant({ ...request, messages: [{ role: "system", content: "override" }] } as typeof request));
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 1);
  } finally { await f.cleanup(); }
});
for (const output of ["not JSON", JSON.stringify({ ...turn, command: "start" }), JSON.stringify({ action: "start" }), JSON.stringify({ action: "propose", workflowId: "fixture", intent: "live" }), "x".repeat(25_000)])
  it("rejects malformed, unsupported or excessive assistant output", async () => {
    const f = chatGptFixture(); try { await f.connected(); f.setSse(completedOcrStream(output)); await assert.rejects(f.service.inferAssistant(request)); } finally { await f.cleanup(); }
  });
it("rejects conflicting terminal text, forged roles/model, partial streams and cancellation", async () => {
  const f = chatGptFixture(); try {
    await f.connected();
    const valid = completedOcrStream(JSON.stringify(turn));
    for (const sse of [valid.replace('"role":"assistant"', '"role":"system"'), valid.replaceAll('gpt-6.1-sol', 'unverified-model'),
      valid.replace('"delta":"{', '"delta":"conflict{'), 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n']) {
      f.setSse(sse); await assert.rejects(f.service.inferAssistant(request));
    }
    await assert.rejects(f.service.inferAssistant(request, AbortSignal.abort()), { code: "CHATGPT_OCR_CANCELLED" });
  } finally { await f.cleanup(); }
});
it("preserves disabled, refresh, quota, token-bound auth and signout behavior", async () => {
  const f = chatGptFixture(); try {
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_ACCOUNT_EXPIRED" });
    await f.connected(false); await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_PLAN_DISABLED" });
    await f.connected(); f.clock.advanceWall(3_600_000); f.setSse(completedOcrStream(JSON.stringify(turn)));
    assert.deepEqual(await f.service.inferAssistant(request), turn);
    f.setResponse(() => Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded" } }, { status: 429 }));
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_USAGE_LIMIT" });
    f.setResponse(() => Response.json({ detail: "private failure withheld" }, { status: 401 }));
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_ACCOUNT_EXPIRED" }); assert.equal(f.service.readAccount().state, "expired");
    await f.service.signOut(); await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_ACCOUNT_EXPIRED" });
  } finally { await f.cleanup(); }
});
it("malformed completed assistant content cannot clear an observed usage limit", async () => {
  const f = chatGptFixture(); try {
    await f.connected();
    f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await assert.rejects(f.service.inferAssistant(request), { code: "CHATGPT_USAGE_LIMIT" });
    f.setSse(completedOcrStream('malformed'));
    await assert.rejects(f.service.inferAssistant(request));
    const state = f.service.readAccount(); assert.equal(state.state, "connected"); if (state.state === "connected") assert.equal(state.planUsage, "limit-reached");
    f.setSse(completedOcrStream(JSON.stringify(turn))); await f.service.inferAssistant(request);
    const recovered = f.service.readAccount(); assert.equal(recovered.state, "connected"); if (recovered.state === "connected") assert.equal(recovered.planUsage, "enabled");
  } finally { await f.cleanup(); }
});
