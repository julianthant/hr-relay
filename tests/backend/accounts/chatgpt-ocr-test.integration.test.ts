import assert from "node:assert/strict";
import { ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { pdf } from "pdf-to-img";
import { Hono } from "hono";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";
import { createChatGptOcrTestService } from "../../../src/backend/accounts/chatgpt-ocr-test.js";
import { admitOcrExtraction } from "../../../src/models/ocr/extraction.js";
import { registerChatGptAccountRoutes } from "../../../src/backend/transports/http/routes/chatgpt-account.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";

it("Test OCR dispatches exactly one transient fixed synthetic page and exposes only safe completion metadata", async () => {
  const f = chatGptFixture();
  try {
    let calls = 0, retained: (() => Promise<unknown>) | undefined;
    const service = createChatGptOcrTestService({ assertCurrent: () => f.admission.assertProfileRuntime(), dispatch: async (input, signal, source) => {
      calls++; assert.equal(signal.aborted, false); assert.equal(input.formType, "oath"); assert.equal(input.sourcePage, 1);
      retained = () => source.open(input.page);
      await assert.rejects(source.open(ArtifactRefSchema.parse({ ...input.page, id: randomUUID() })), { code: "CHATGPT_OCR_INVALID" });
      const chunks: Buffer[] = [];
      for await (const chunk of await source.open(input.page)) { assert.ok(chunk instanceof Uint8Array); chunks.push(Buffer.from(chunk)); }
      await assert.rejects(source.open(input.page), { code: "CHATGPT_OCR_INVALID" });
      const bytes = Buffer.concat(chunks); assert.equal(bytes.byteLength, input.page.bytes);
      assert.equal(bytes.toString("latin1").includes("Employee ID: 10800000"), true);
      assert.equal(input.page.mediaType, "application/pdf");
      const document = await pdf(bytes, { scale: 1 });
      try { assert.equal(document.length, 1); } finally { await document.destroy(); }
      const admitted = admitOcrExtraction({ formType: input.formType, sourcePage: input.sourcePage, sourceSha256: input.page.sha256,
        source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "gpt-6.1-sol" }, readAt: f.clock.now().toISOString(), pageKind: "oath", record: { answers: {
          printedName: { state: "read", raw: "Example, Avery", confidence: 1 }, employeeId: { state: "read", raw: "10800000", confidence: 1 },
          signatureDate: { state: "read", raw: "07/21/2026", confidence: 1 }, employeeSigned: { state: "read", raw: "yes", confidence: 1 }, officerSigned: { state: "read", raw: "yes", confidence: 1 },
        } } });
      assert.equal(admitted.admitted, true); if (!admitted.admitted) throw new Error("fixture admission failed"); return admitted.extraction;
    } });
    const app: DashboardApp = new Hono(); registerChatGptAccountRoutes(app, { chatGptAccount: f.service, chatGptOcrTest: service });
    const url = "http://127.0.0.1/api/v1/settings/chatgpt-account/test-ocr";
    assert.equal((await app.request(url, { method: "POST", body: "{}" })).status, 403); assert.equal(calls, 0);
    const headers = { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" };
    const invalid = await app.request(url, { method: "POST", headers, body: '{"document":"private"}' });
    assert.equal((await invalid.json() as { state: string }).state, "refused"); assert.equal(calls, 0);
    const result = await app.request(url, { method: "POST", headers, body: "{}" });
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { state: "completed", model: "gpt-6.1-sol" }); assert.equal(calls, 1);
    assert.ok(retained); await assert.rejects(retained, { code: "CHATGPT_OCR_INVALID" });
    await assert.rejects(service.testOcr(AbortSignal.abort()), { code: "CHATGPT_OCR_CANCELLED" }); assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

it("Test OCR refuses a dispatcher result for a different source without fabricating success", async () => {
  const f = chatGptFixture(); try {
    const service = createChatGptOcrTestService({ assertCurrent: () => f.admission.assertProfileRuntime(), dispatch: async input => {
      const admitted = admitOcrExtraction({ formType: "oath", sourcePage: 2, sourceSha256: input.page.sha256,
        source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "gpt-6.1-sol" }, readAt: f.clock.now().toISOString(), pageKind: "blank", record: null });
      if (!admitted.admitted) throw new Error("fixture admission failed"); return admitted.extraction;
    } });
    await assert.rejects(service.testOcr(new AbortController().signal), { code: "CHATGPT_OCR_INVALID" });
  } finally { await f.cleanup(); }
});

it("Test OCR rejects a provider that always classifies the known-text form as blank", async () => {
  const f = chatGptFixture(); try {
    const service = createChatGptOcrTestService({ assertCurrent: () => f.admission.assertProfileRuntime(), dispatch: async input => {
      const admitted = admitOcrExtraction({ formType: "oath", sourcePage: 1, sourceSha256: input.page.sha256,
        source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "gpt-6.1-sol" }, readAt: f.clock.now().toISOString(), pageKind: "blank", record: null });
      if (!admitted.admitted) throw new Error("fixture admission failed"); return admitted.extraction;
    } });
    await assert.rejects(service.testOcr(new AbortController().signal), { code: "CHATGPT_OCR_INVALID" });
  } finally { await f.cleanup(); }
});

it("Test OCR cancellation before its fixed source opens stops without returning page bytes", async () => {
  const f = chatGptFixture(); try {
    const controller = new AbortController(); let calls = 0;
    const service = createChatGptOcrTestService({ assertCurrent: () => f.admission.assertProfileRuntime(), dispatch: async (input, _signal, source) => {
      calls++; controller.abort(); return source.open(input.page);
    } });
    await assert.rejects(service.testOcr(controller.signal), { code: "CHATGPT_OCR_CANCELLED" }); assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

it("Test OCR cancellation during dispatch cannot return completed", async () => {
  const f = chatGptFixture(); try {
    const controller = new AbortController(); let calls = 0;
    const service = createChatGptOcrTestService({ assertCurrent: () => f.admission.assertProfileRuntime(), dispatch: async input => {
      const admitted = admitOcrExtraction({ formType: input.formType, sourcePage: input.sourcePage, sourceSha256: input.page.sha256,
        source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "gpt-6.1-sol" }, readAt: f.clock.now().toISOString(), pageKind: "oath", record: { answers: {
          printedName: { state: "read", raw: "Example, Avery", confidence: 1 }, employeeId: { state: "read", raw: "10800000", confidence: 1 },
          signatureDate: { state: "read", raw: "07/21/2026", confidence: 1 }, employeeSigned: { state: "read", raw: "yes", confidence: 1 }, officerSigned: { state: "read", raw: "yes", confidence: 1 },
        } } });
      if (!admitted.admitted) throw new Error("fixture admission failed");
      calls++; await Promise.resolve(); controller.abort(); return admitted.extraction;
    } });
    await assert.rejects(service.testOcr(controller.signal), { code: "CHATGPT_OCR_CANCELLED" }); assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

for (const [employeeId, accepted] of [["10800001", false], ["10-800-000", true]] as const)
  it(`Test OCR ${accepted ? "accepts the normalized right" : "refuses a different valid"} employee ID`, async () => {
    const f = chatGptFixture(); try {
        const service = createChatGptOcrTestService({ assertCurrent: () => f.admission.assertProfileRuntime(), dispatch: async input => {
        const admitted = admitOcrExtraction({ formType: input.formType, sourcePage: input.sourcePage, sourceSha256: input.page.sha256,
          source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "gpt-6.1-sol" }, readAt: f.clock.now().toISOString(), pageKind: "oath", record: { answers: {
            printedName: { state: "read", raw: "Example, Avery", confidence: 1 }, employeeId: { state: "read", raw: employeeId, confidence: 1 },
            signatureDate: { state: "read", raw: "07/21/2026", confidence: 1 }, employeeSigned: { state: "read", raw: "yes", confidence: 1 }, officerSigned: { state: "read", raw: "yes", confidence: 1 },
          } } });
        assert.equal(admitted.admitted, true); if (!admitted.admitted) throw new Error("fixture admission failed");
        return admitted.extraction;
      } });
      if (accepted) assert.deepEqual(await service.testOcr(new AbortController().signal), { state: "completed", model: "gpt-6.1-sol" });
      else await assert.rejects(service.testOcr(new AbortController().signal), { code: "CHATGPT_OCR_INVALID" });
    } finally { await f.cleanup(); }
  });
