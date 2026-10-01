/**
 * D161 — the first production `ocr.extract` adapter is a PEER of the CLI
 * routes, and its transport cannot leak or invent.
 *
 * The cases that matter:
 * - the produced path stamps provenance from what the adapter KNOWS and passes
 *   the model's reading through verbatim, so the one gate admits it onto the
 *   SAME fingerprint an operator lands on for the identical reading;
 * - a model that omits a key stays omitted — the gate names the gap, this
 *   adapter never fills it;
 * - the API key travels in a header and appears in no message or evidence;
 * - remote refusals map onto the CLOSED reason codes (429 → retryable
 *   `rate-exhausted` with a real instant; 401/403 → `adapter-unavailable`;
 *   anything else throws so admission records a durable interruption);
 * - a non-JSON answer is `invalid-response` reporting SHAPE only, because the
 *   body could contain page contents.
 */
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createGeminiOcrExtractAdapter } from "../../src/infra/providers/gemini-ocr-extract.js";
import {
  createAdmittedProviderClient,
  type MonotonicDeadlineScheduler,
} from "../../src/backend/runs/provider-admission.js";
import { manualClock } from "../../src/domain/clock.js";
import { defaultRuntimePaths } from "../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema } from "../../src/domain/config/schema.js";
import {
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ProviderAdmissionIdSchema,
} from "../../src/domain/ids.js";
import { ArtifactRefSchema } from "../../src/domain/artifacts.js";
import { ProviderRequestEnvelopeSchema } from "../../src/domain/providers.js";
import { admitOcrExtraction } from "../../src/domain/ocr/extraction.js";
import { buildExtractionInstruction } from "../../src/domain/ocr/instruction.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { HASH_B, NOW, UUID_4 } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID, WORKFLOW_ID } from "../fixtures/phase1f-run-fixtures.js";

const API_KEY = "test-gemini-key-never-logged";
const MODEL = "gemini-3-flash-preview";
const AT = "2026-08-08T10:00:00.000Z";
const PAGE_BYTES = Buffer.from("png-bytes-of-a-real-scan-page");
const PAGE = ArtifactRefSchema.parse({
  id: "11111111-2222-4333-8444-555555555555",
  sha256: sha256Hex(PAGE_BYTES.toString("latin1")),
  bytes: PAGE_BYTES.length,
  mediaType: "image/png",
});

const READING = {
  pageKind: "oath",
  record: { answers: {
    printedName: { state: "read", raw: "Battistessa, Johnnie", confidence: 0.97 },
    employeeId: { state: "read", raw: "10873698", confidence: 0.93 },
    signatureDate: { state: "read", raw: "07/21/2026", confidence: 0.95 },
    employeeSigned: { state: "read", raw: "yes", confidence: 0.99 },
    officerSigned: { state: "absent", reason: "blank" },
  } },
};

function envelope() {
  return ProviderRequestEnvelopeSchema.parse({
    capability: "ocr.extract",
    payload: {
      schemaHash: FingerprintSchema.parse(sha256Hex("request-schema")),
      value: {
        formType: "oath",
        instruction: buildExtractionInstruction("oath"),
        page: PAGE,
        sourcePage: 1,
      },
    },
  });
}

interface CapturedFetch {
  readonly calls: { url: string; init: RequestInit }[];
}

function scriptedFetch(respond: () => Response): CapturedFetch & { fn: typeof fetch } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn: typeof fetch = (input, init) => {
    if (typeof input !== "string") throw new Error("this adapter always fetches by URL string");
    calls.push({ url: input, init: init ?? {} });
    return Promise.resolve(respond());
  };
  return { calls, fn };
}

function adapterWith(fetchFn: typeof fetch, openedRefs: unknown[] = []) {
  return createGeminiOcrExtractAdapter({
    apiKey: API_KEY,
    modelId: MODEL,
    artifacts: {
      open: (ref) => {
        openedRefs.push(ref);
        return Promise.resolve(Readable.from([PAGE_BYTES]));
      },
    },
    clock: manualClock(new Date(AT), 1_000),
    fetchFn,
  });
}

function callOptions() {
  return {
    signal: new AbortController().signal,
    deadlineMonotonicMs: 120_000,
    admissionId: ProviderAdmissionIdSchema.parse("00000000-0000-4000-8000-000000000091"),
  };
}

function geminiBody(text: string) {
  return { responseId: "resp-1", candidates: [{ content: { parts: [{ text }] } }] };
}

describe("D161 gemini ocr.extract adapter", () => {
  it("sends the shared brief with the page inline, and never puts the key in the URL", async () => {
    const modelAnswer = JSON.stringify({
      formType: "oath",
      source: { kind: "local-agent", agentId: "<your tool id>", invocation: "<the command you ran>" },
      readAt: "<ISO-8601 instant with offset>",
      sourceSha256: "<sha256 of the page image or PDF you read>",
      sourcePage: 1,
      ...READING,
    });
    const fetcher = scriptedFetch(() =>
      new Response(JSON.stringify(geminiBody(`\`\`\`json\n${modelAnswer}\n\`\`\``)), { status: 200 }));
    const openedRefs: unknown[] = [];
    const adapter = adapterWith(fetcher.fn, openedRefs);

    const request = envelope();
    assert.deepEqual(adapter.estimate(request), { maximumCostUsdMicros: 0 });
    const outcome = await adapter.invoke(request, callOptions());

    // Transport facts: one call, model in the path, key in the HEADER only.
    assert.equal(fetcher.calls.length, 1);
    const { url, init } = fetcher.calls[0];
    assert.equal(url.includes(MODEL), true);
    assert.equal(url.includes(API_KEY), false, "the key must never ride the URL");
    assert.equal((init.headers as Record<string, string>)["x-goog-api-key"], API_KEY);
    if (typeof init.body !== "string") throw new Error("the adapter sends a JSON string body");
    const sent = JSON.parse(init.body) as {
      contents: { parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] }[];
      generationConfig: { responseMimeType: string; temperature: number };
    };
    assert.equal(sent.generationConfig.temperature, 0);
    assert.equal(sent.generationConfig.responseMimeType, "application/json");
    assert.equal(sent.contents[0].parts[0].text, buildExtractionInstruction("oath"));
    assert.equal(sent.contents[0].parts[1].inline_data?.data, PAGE_BYTES.toString("base64"));
    // The artifact was resolved by its WHOLE ref, so the store could refuse a
    // mismatched identity.
    assert.deepEqual(openedRefs, [PAGE]);

    // Provenance is stamped from facts, not echoed from the model's skeleton.
    assert.equal(outcome.response.state, "produced");
    if (outcome.response.state !== "produced") throw new Error("unreachable");
    const submission = outcome.response.value.value as Record<string, unknown>;
    assert.deepEqual(submission.source, { kind: "provider", providerId: "gemini", modelId: MODEL });
    assert.equal(submission.readAt, AT);
    assert.equal(submission.sourceSha256, PAGE.sha256);

    // The one gate admits it — onto the SAME fingerprint the operator route
    // produces for the identical reading. Route 1 is a peer, not a variant.
    const admitted = admitOcrExtraction(submission);
    assert.equal(admitted.admitted, true, JSON.stringify(admitted));
    if (!admitted.admitted) throw new Error("unreachable");
    const byHand = admitOcrExtraction({
      formType: "oath",
      source: { kind: "operator", actorId: "local-operator" },
      readAt: "2026-08-08T12:00:00.000Z",
      sourceSha256: PAGE.sha256,
      sourcePage: 1,
      pageKind: "oath",
      record: READING.record,
    });
    assert.equal(byHand.admitted, true);
    if (!byHand.admitted) throw new Error("unreachable");
    assert.equal(admitted.extraction.pageFingerprint, byHand.extraction.pageFingerprint);

    // Evidence is post-redaction: no page contents, no key.
    assert.equal(outcome.evidence.summary.includes("Battistessa"), false);
    assert.equal(outcome.evidence.summary.includes(API_KEY), false);
    assert.equal(outcome.evidence.providerRequestId, "resp-1");
  });

  it("keeps a key the model omitted omitted, so the gate can name the gap", async () => {
    const fetcher = scriptedFetch(() =>
      new Response(JSON.stringify(geminiBody(JSON.stringify({ pageKind: "oath" }))), { status: 200 }));
    const outcome = await adapterWith(fetcher.fn).invoke(envelope(), callOptions());
    assert.equal(outcome.response.state, "produced");
    if (outcome.response.state !== "produced") throw new Error("unreachable");
    const submission = outcome.response.value.value as Record<string, unknown>;
    assert.equal(Object.hasOwn(submission, "record"), false, "the adapter must not invent a record");
    const admitted = admitOcrExtraction(submission);
    assert.equal(admitted.admitted, false);
  });

  it("maps 429 onto retryable rate-exhausted, honoring Retry-After when the provider names one", async () => {
    const withHeader = scriptedFetch(() =>
      new Response("slow down", { status: 429, headers: { "retry-after": "30" } }));
    const outcomeWithHeader = await adapterWith(withHeader.fn).invoke(envelope(), callOptions());
    assert.equal(outcomeWithHeader.response.state, "unavailable");
    if (outcomeWithHeader.response.state !== "unavailable") throw new Error("unreachable");
    assert.equal(outcomeWithHeader.response.reason.code, "rate-exhausted");
    assert.equal(outcomeWithHeader.response.reason.retryAt, "2026-08-08T10:00:30.000Z");

    const withoutHeader = scriptedFetch(() => new Response("slow down", { status: 429 }));
    const outcomeWithout = await adapterWith(withoutHeader.fn).invoke(envelope(), callOptions());
    if (outcomeWithout.response.state !== "unavailable") throw new Error("expected unavailable");
    // No Retry-After: the next fixed UTC minute boundary, D112's own window.
    assert.equal(outcomeWithout.response.reason.retryAt, "2026-08-08T10:01:00.000Z");
  });

  it("treats 401/403 as adapter-unavailable and anything else as a loud interruption", async () => {
    const denied = scriptedFetch(() => new Response("forbidden", { status: 403 }));
    const outcome = await adapterWith(denied.fn).invoke(envelope(), callOptions());
    assert.equal(outcome.response.state, "unavailable");
    if (outcome.response.state !== "unavailable") throw new Error("unreachable");
    assert.equal(outcome.response.reason.code, "adapter-unavailable");
    assert.equal(outcome.response.reason.message.includes(API_KEY), false);

    const broken = scriptedFetch(() => new Response("oops", { status: 503 }));
    await assert.rejects(
      () => adapterWith(broken.fn).invoke(envelope(), callOptions()),
      /http 503/,
    );
  });

  it("reports a non-JSON answer by shape only, never by excerpt", async () => {
    const fetcher = scriptedFetch(() =>
      new Response(JSON.stringify(geminiBody("The page shows Battistessa, Johnnie signing an oath.")), { status: 200 }));
    const outcome = await adapterWith(fetcher.fn).invoke(envelope(), callOptions());
    assert.equal(outcome.response.state, "invalid-response");
    if (outcome.response.state !== "invalid-response") throw new Error("unreachable");
    assert.equal(outcome.response.reason.includes("Battistessa"), false, "a parse failure must not quote the body");
  });

  describe("through the real admission kernel", () => {
    const roots: string[] = [];
    afterEach(() => {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    class ImmediateScheduler implements MonotonicDeadlineScheduler {
      schedule(_deadlineMonotonicMs: number, _onDeadline: () => void) {
        return Object.freeze({ cancel: () => undefined });
      }
    }

    it("reserves, invokes and settles a real adapter call durably before returning it", async () => {
      const root = mkdtempSync(join(tmpdir(), "hrauto-gemini-adapter-"));
      roots.push(root);
      const clock = manualClock(new Date(NOW), 1_000);
      const database = AuthorityDatabase.open(
        { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "gemini-adapter-test" },
        clock,
      );
      const snapshot = {
        configSnapshotId: ConfigSnapshotIdSchema.parse(UUID_4),
        revision: 1,
        fingerprint: FingerprintSchema.parse(HASH_B),
        capturedAt: IsoInstantSchema.parse(NOW),
        capturedBy: "local-operator",
        config: ConfigSchema.parse({ paths: defaultRuntimePaths() }),
        provenance: {},
      };
      database.authority.configSnapshots.insert(snapshot);
      database.authority.runs.enqueue(QUEUED_RUN);
      const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW });
      if (claimed.state !== "claimed") throw new Error("fixture did not claim its run");
      const validating = database.authority.runs.transition({
        runId: RUN_ID,
        expectedVersion: claimed.run.version,
        claim: { workerId: WORKER_ID, claimGeneration: 1 },
        lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
        now: NOW,
      });
      if (validating.state !== "applied") throw new Error("fixture did not validate its run");
      const running = database.authority.runs.transition({
        runId: RUN_ID,
        expectedVersion: validating.run.version,
        claim: { workerId: WORKER_ID, claimGeneration: 1 },
        lifecycle: {
          state: "running",
          workerId: WORKER_ID,
          claimedAt: NOW,
          heartbeatAt: NOW,
          currentNodeId: "reading",
        },
        now: NOW,
      });
      if (running.state !== "applied") throw new Error("fixture did not run");

      const modelAnswer = JSON.stringify({ ...READING });
      const fetcher = scriptedFetch(() =>
        new Response(JSON.stringify(geminiBody(modelAnswer)), { status: 200 }));
      const adapter = createGeminiOcrExtractAdapter({
        apiKey: API_KEY,
        modelId: MODEL,
        artifacts: { open: () => Promise.resolve(Readable.from([PAGE_BYTES])) },
        clock,
        fetchFn: fetcher.fn,
      });
      const admissionId = ProviderAdmissionIdSchema.parse("00000000-0000-4000-8000-000000000161");
      const client = createAdmittedProviderClient("ocr.extract", {
        execution: { runId: RUN_ID, attempt: 1, nodeId: "reading", taskId: "ocr/extract-form-page" },
        configSnapshotId: snapshot.configSnapshotId,
        configFingerprint: snapshot.fingerprint,
        configSnapshot: snapshot,
        runSignal: new AbortController().signal,
        adapters: { "ocr.extract": adapter },
        repository: database.authority.providerAdmissions,
        clock,
        idFactory: { next: () => admissionId },
        deadlineScheduler: new ImmediateScheduler(),
      });

      const response = await client.call(envelope().payload);
      assert.equal(response.state, "produced");
      const admission = database.authority.providerAdmissions.get(admissionId);
      assert.equal(admission?.lifecycle.state, "settled");
      if (admission?.lifecycle.state !== "settled") throw new Error("unreachable");
      assert.equal(admission.lifecycle.actualUsage.costUsdMicros, 0);
      assert.equal(admission.lifecycle.evidence.summary.includes("Battistessa"), false);
      database.close();
    });
  });
});
