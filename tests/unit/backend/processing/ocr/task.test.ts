import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { ArtifactRefSchema } from "../../../../../src/domain/artifacts.js";
import { sha256Hex } from "../../../../../src/domain/sha256.js";
import { deriveSchemaHash } from "../../../../../src/domain/schema-bound-value.js";
import { extractFormPageTask } from "../../../../../src/stores/ocr/index.js";

const PAGE_SHA = sha256Hex("fixture-oath-page");
const PAGE = ArtifactRefSchema.parse({
  id: "11111111-2222-4333-8444-555555555555",
  sha256: PAGE_SHA,
  bytes: 4096,
  mediaType: "image/png",
});
const RESPONSE_HASH = deriveSchemaHash(z.unknown(), "output");

function completeAnswers() {
  return {
    formType: "oath",
    source: { kind: "provider", providerId: "deterministic", modelId: "fixture-1" },
    readAt: "2026-08-06T09:00:00.000Z",
    sourceSha256: PAGE_SHA,
    sourcePage: 4,
    pageKind: "oath",
    record: {
      answers: {
        printedName: { state: "read", raw: "Example, Avery", confidence: 0.97 },
        employeeId: { state: "read", raw: "10800000", confidence: 0.93 },
        signatureDate: { state: "read", raw: "07/21/2026", confidence: 0.95 },
        employeeSigned: { state: "read", raw: "yes", confidence: 0.99 },
        officerSigned: { state: "read", raw: "yes", confidence: 0.98 },
      },
    },
  };
}

function taskCtx(response: unknown, sent: unknown[], recorded: unknown[]) {
  return {
    providers: {
      "ocr.extract": {
        capability: "ocr.extract",
        call: (payload: unknown) => {
          sent.push(payload);
          return Promise.resolve(response);
        },
      },
    },
    recordData: (point: unknown) => { recorded.push(point); },
    fail: (code: string, message: string) => {
      throw Object.assign(new Error(message), { code });
    },
  };
}

async function run(response: unknown) {
  const sent: unknown[] = [];
  const recorded: unknown[] = [];
  try {
    const output = await extractFormPageTask.impl.run({
      input: { formType: "oath", page: PAGE, sourcePage: 4 },
      ctx: taskCtx(response, sent, recorded) as never,
    });
    return { output, sent, recorded };
  } catch (error) {
    const caught = error as Error & { code?: string };
    if (caught.code === undefined) throw error;
    return { failure: { code: caught.code, message: caught.message }, sent, recorded };
  }
}

describe("OCR provider task wrapper", () => {
  it("sends the page request and returns a strictly admitted extraction with public facts", async () => {
    const result = await run({
      state: "produced",
      value: { schemaHash: RESPONSE_HASH, value: completeAnswers() },
    });
    assert.equal("failure" in result, false);
    if (!("output" in result)) throw new Error("expected admitted extraction");

    assert.equal(result.sent.length, 1);
    const request = result.sent[0] as { value: { formType: string; page: unknown; sourcePage: number; instruction: string } };
    assert.equal(request.value.formType, "oath");
    assert.deepEqual(request.value.page, PAGE);
    assert.equal(request.value.sourcePage, 4);
    assert.match(request.value.instruction, /^# Extract: /u);
    assert.match(request.value.instruction, /`employeeId`/u);
    assert.match(request.value.instruction, /`signatureDate`/u);
    assert.equal(result.output.formType, "oath");
    assert.equal(result.output.source.kind, "provider");
    assert.equal(result.output.sourcePage, 4);
    assert.deepEqual(result.recorded, [[
      { direction: "read", field: "formType", value: "oath" },
      { direction: "read", field: "sourcePage", value: 4 },
      { direction: "read", field: "pageKind", value: "oath" },
      { direction: "read", field: "pageFingerprint", value: result.output.pageFingerprint },
      { direction: "read", field: "hasRecord", value: true },
    ]]);
  });

  it("preserves retry information in a named provider refusal", async () => {
    const result = await run({
      state: "unavailable",
      reason: {
        code: "rate-exhausted",
        message: "capability budget spent",
        retryAt: "2026-08-06T10:00:00.000Z",
      },
    });
    assert.equal("failure" in result, true);
    if ("failure" in result) {
      assert.equal(result.failure.code, "provider-unavailable");
      assert.match(result.failure.message, /rate-exhausted/u);
      assert.match(result.failure.message, /2026-08-06T10:00:00.000Z/u);
      assert.deepEqual(result.recorded, []);
    }
  });

  it("names an unreadable provider response without recording successful facts", async () => {
    const unreadable = await run({ state: "invalid-response", reason: "not JSON" });
    assert.equal("failure" in unreadable, true);
    if ("failure" in unreadable) {
      assert.equal(unreadable.failure.code, "unreadable-page");
      assert.deepEqual(unreadable.recorded, []);
    }
  });

  it("names a partial answer as incomplete without recording successful facts", async () => {
    const partial = completeAnswers();
    delete (partial.record.answers as Record<string, unknown>).signatureDate;
    const incomplete = await run({
      state: "produced",
      value: { schemaHash: RESPONSE_HASH, value: partial },
    });
    assert.equal("failure" in incomplete, true);
    if ("failure" in incomplete) {
      assert.equal(incomplete.failure.code, "incomplete-extraction");
      assert.match(incomplete.failure.message, /signatureDate not answered/u);
      assert.deepEqual(incomplete.recorded, []);
    }
  });
});


