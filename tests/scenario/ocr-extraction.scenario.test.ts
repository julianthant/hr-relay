/**
 * Executable scenarios for `ocr/extract-form-page` — route 1 of D151.
 *
 * The point of these is not that a provider can read a page; it is that route 1
 * is a PEER of the CLI routes. The same instruction goes out, the same gate
 * comes back, and the same problem text reaches the operator. The last scenario
 * is the sharp one: a model that answers a different field set than the form
 * declares must FAIL, not be quietly patched up, because a pipeline that
 * repaired a partial answer would be reading a different form than the operator.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { extractFormPageTask } from "../../src/stores/ocr/index.js";
import { admitOcrExtraction } from "../../src/domain/ocr/extraction.js";
import { buildExtractionInstruction } from "../../src/domain/ocr/instruction.js";
import { ArtifactRefSchema } from "../../src/domain/artifacts.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { z } from "zod";

const PAGE_SHA = sha256Hex("oath-page-1");
const PAGE = ArtifactRefSchema.parse({
  id: "11111111-2222-4333-8444-555555555555",
  sha256: PAGE_SHA,
  bytes: 4096,
  mediaType: "image/png",
});

/** The shape the task sends; mirrored so the scenario can assert what went out. */
const RequestSchema = z.strictObject({
  formType: z.string().min(1),
  instruction: z.string().min(1),
  pageArtifactId: z.string().min(1),
  pageSha256: z.string().min(1),
  sourcePage: z.number().int().positive(),
});
const RESPONSE_HASH = deriveSchemaHash(z.unknown(), "output");

function completeAnswers(overrides: Record<string, unknown> = {}) {
  return {
    formType: "oath",
    source: { kind: "provider", providerId: "deterministic", modelId: "fixture-1" },
    readAt: "2026-08-06T09:00:00.000Z",
    sourceSha256: PAGE_SHA,
    sourcePage: 1,
    pageKind: "oath",
    record: {
      answers: {
        printedName: { state: "read", raw: "Battistessa, Johnnie", confidence: 0.97 },
        employeeId: { state: "read", raw: "10873698", confidence: 0.93 },
        signatureDate: { state: "read", raw: "07/21/2026", confidence: 0.95 },
        employeeSigned: { state: "read", raw: "yes", confidence: 0.99 },
        officerSigned: { state: "read", raw: "yes", confidence: 0.98 },
        ...overrides,
      },
    },
  };
}

interface RunResult {
  readonly output?: unknown;
  readonly failure?: { code: string; message: string };
  readonly sent: unknown[];
}

async function runTask(respond: () => unknown): Promise<RunResult> {
  const sent: unknown[] = [];
  const ctx = {
    providers: {
      "ocr.extract": {
        capability: "ocr.extract",
        call: (payload: { value: unknown }) => {
          sent.push(payload.value);
          return Promise.resolve(respond());
        },
      },
    },
    artifacts: { open: () => { throw new Error("unused"); }, put: () => { throw new Error("unused"); } },
    recordData: () => undefined,
    fail: (code: string, message: string) => { throw Object.assign(new Error(message), { code }); },
  };
  try {
    const output = await extractFormPageTask.impl.run({
      input: { formType: "oath", page: PAGE, sourcePage: 1 },
      ctx: ctx as never,
    });
    return { output, sent };
  } catch (error) {
    const failure = error as Error & { code?: string };
    if (failure.code === undefined) throw error;
    return { failure: { code: failure.code, message: failure.message }, sent };
  }
}

describe("ocr/extract-form-page scenarios", () => {
  it("ocr/extract/complete — sends the shared instruction and returns an admitted record", async () => {
    const result = await runTask(() => ({
      state: "produced",
      value: { schemaHash: RESPONSE_HASH, value: completeAnswers() },
    }));

    assert.equal(result.failure, undefined);
    // Route 1 receives the SAME brief the CLI prints for routes 2 and 3.
    const request = RequestSchema.parse(result.sent[0]);
    assert.equal(request.instruction, buildExtractionInstruction("oath"));
    assert.equal(request.pageSha256, PAGE_SHA);

    const output = result.output as { pageFingerprint: string; record: { blockingPaths: string[] } };
    assert.deepEqual(output.record.blockingPaths, []);

    // And an operator submitting the identical reading by hand lands on the
    // same fingerprint — the routes are interchangeable, not merely similar.
    const byHand = admitOcrExtraction({
      ...completeAnswers(),
      source: { kind: "operator", actorId: "local-operator" },
    });
    assert.equal(byHand.admitted, true);
    if (!byHand.admitted) throw new Error("unreachable");
    assert.equal(byHand.extraction.pageFingerprint, output.pageFingerprint);
  });

  it("ocr/extract/illegible-mandatory — an unreadable mandatory box is a record, not a failure", async () => {
    const result = await runTask(() => ({
      state: "produced",
      value: {
        schemaHash: RESPONSE_HASH,
        value: completeAnswers({ officerSigned: { state: "absent", reason: "illegible" } }),
      },
    }));
    assert.equal(result.failure, undefined);
    const output = result.output as { record: { blockingPaths: string[] } };
    // A human resolves it downstream; the read itself succeeded.
    assert.deepEqual(output.record.blockingPaths, ["officerSigned"]);
  });

  it("ocr/extract/skipped-field-refused — a model that skips a field fails the task", async () => {
    const partial = completeAnswers();
    delete (partial.record.answers as Record<string, unknown>).signatureDate;
    const result = await runTask(() => ({
      state: "produced",
      value: { schemaHash: RESPONSE_HASH, value: partial },
    }));

    assert.equal(result.failure?.code, "incomplete-extraction");
    // The operator sees the SAME correction text a terminal agent would have.
    assert.equal(result.failure?.message.includes("signatureDate not answered"), true);
    assert.equal(result.output, undefined, "a partial answer must not be patched up into a record");
  });

  it("ocr/extract/provider-unavailable — exhaustion is named, never an empty record", async () => {
    const result = await runTask(() => ({
      state: "unavailable",
      reason: { code: "rate-exhausted", message: "capability budget spent", retryAt: "2026-08-06T10:00:00.000Z" },
    }));
    assert.equal(result.failure?.code, "provider-unavailable");
    // The closed code and the retry instant survive — they are the parts an
    // operator can act on, and flattening the reason to text would lose them.
    assert.equal(result.failure?.message.includes("rate-exhausted"), true);
    assert.equal(result.failure?.message.includes("2026-08-06T10:00:00.000Z"), true);
    assert.equal(result.output, undefined);

    const unusable = await runTask(() => ({ state: "invalid-response", reason: "not JSON" }));
    assert.equal(unusable.failure?.code, "unreadable-page");
  });
});
