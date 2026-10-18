import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { chatGptFixture, completedOcrStream } from "../../../support/helpers/chatgpt-account-fixtures.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createChatGptOcrAdapter } from "../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";
import { createProviderClient } from "../../../../src/backend/processing/providers/provider-client.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { extractFormPageTask } from "../../../../src/backend/processing/ocr/tasks/extract-form-page.js";
import { ExtractFormPage, OCR_EXTRACTION_REQUEST_HASH } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { buildExtractionInstruction } from "../../../../src/models/ocr/instruction.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";

const world = createCapabilityWiringTestWorld();
afterEach(world.cleanup);
const bytes = Buffer.from("synthetic page bytes");
const page = ArtifactRefSchema.parse({ id: "11111111-2222-4333-8444-555555555555", sha256: sha256Hex(bytes.toString("utf8")), bytes: bytes.length, mediaType: "image/png" });
function submission(readAt: string) {
  return { formType: "oath", source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "gpt-6.1-sol" },
    readAt, sourceSha256: String(page.sha256), sourcePage: 4, pageKind: "oath", record: { answers: {
      printedName: { state: "read", raw: "Example, Avery", confidence: 1 }, employeeId: { state: "read", raw: "10800000", confidence: 1 },
      signatureDate: { state: "read", raw: "07/21/2026", confidence: 1 }, employeeSigned: { state: "read", raw: "yes", confidence: 1 }, officerSigned: { state: "read", raw: "yes", confidence: 1 },
    } } };
}
function adapterFor(f: ReturnType<typeof chatGptFixture>, body = bytes) {
  return createChatGptOcrAdapter({ account: f.service, clock: f.clock, model: "gpt-6.1-sol", artifacts: { open: async () => Readable.from([body]) } });
}
function request() { return { capability: "ocr.extract" as const, payload: { schemaHash: OCR_EXTRACTION_REQUEST_HASH,
  value: { formType: "oath", sourcePage: 4, page, instruction: buildExtractionInstruction("oath") } } }; }
function options() { return { signal: new AbortController().signal, requestId: randomUUID(), deadlineMonotonicMs: 120_000 }; }

it("identifies the real runner evidence-classification blocker after subscription transport", async () => {
  const f = chatGptFixture();
  try {
    await f.connected();
    const artifacts = createContentAddressedArtifactWriter({ admission: f.admission });
    const stored = await artifacts.put(bytes, { mediaType: "image/png" });
    assert.equal(stored.sha256, page.sha256);
    const answer = submission(f.clock.now().toISOString());
    f.setSse(completedOcrStream(JSON.stringify(answer)));
    const base = world.fixtureDescriptor("ocr-account-proof", "oc", world.providersOnlyContract);
    const descriptor = defineWorkflowDescriptor({ id: base.id, version: base.version, contractFingerprint: base.contractFingerprint,
      code: base.code, label: base.label, icon: base.icon, category: base.category, canonicalInput: base.canonicalInput,
      inputSubject: "name", surface: base.surface, enqueue: base.enqueue, actions: base.actions, surfaces: {}, details: [],
      identity: base.identity, presentation: base.presentation, scenarios: base.scenarios, flow: flow(base.canonicalInput)
      .step("extract", ExtractFormPage, { dependsOn: [], replay: "checkpoint", bind: () => ({ formType: "oath" as const, page: stored, sourcePage: 4 }) })
      .build({ schema: z.strictObject({ done: z.boolean() }), dependsOn: ["extract"], derive: () => ({ done: true }) }) });
    const stores = defineTaskStoreRegistry([defineServiceStore("ocr", { extract: extractFormPageTask })], {
      scenarioIds: ExtractFormPage.scenarios, tasks: [{ id: ExtractFormPage.id, effect: ExtractFormPage.effect }],
    });
    const harness = world.wiringHarness(descriptor, stores, { artifacts });
    harness.authority.database.authority.runs.enqueue(world.queuedRunFor(descriptor));
    const claimed = world.claim(harness.authority, descriptor);
    const outcome = await executeClaimedRun({ ...harness.deps, providers: {
      adapters: { "ocr.extract": createChatGptOcrAdapter({ account: f.service, artifacts, clock: f.clock, model: "gpt-6.1-sol" }) },
      idFactory: { next: randomUUID }, configSnapshots: harness.authority.database.authority.configSnapshots,
    } }, { ...claimed, signal: world.SIGNAL });
    const run = harness.authority.database.authority.runs.get(claimed.run.envelope.runId);
    const failureId = run?.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    const failure = failureId === undefined ? undefined : harness.authority.database.authority.failures.get(failureId);
    assert.equal(outcome.state, "failed");
    assert.ok(failure); assert.match(failure.summary, /no declared evidence classification.*formType/su);
    assert.equal(harness.authority.database.authority.runCheckpoints.latest(descriptor.id, claimed.run.envelope.itemId, "extract"), undefined);
    const call = f.calls.find(call => call.url.endsWith("/responses")); assert.ok(call);
    assert.ok(typeof call.init.body === "string");
    assert.ok(call.init.body.includes(bytes.toString("base64")));
  } finally { await f.cleanup(); }
});

for (const change of ["hash", "form", "page", "provider", "model", "date", "json", "bytes"] as const) it(`refuses ${change} mismatch without exposing source output`, async () => {
  const f = chatGptFixture();
  try {
    await f.connected(); const answer = submission(f.clock.now().toISOString());
    if (change === "hash") answer.sourceSha256 = "b".repeat(64);
    if (change === "form") answer.formType = "i9";
    if (change === "page") answer.sourcePage = 2;
    if (change === "provider") answer.source.providerId = "foreign";
    if (change === "model") answer.source.modelId = "foreign";
    if (change === "date") answer.readAt = "2000-01-01T00:00:00Z";
    f.setSse(completedOcrStream(change === "json" ? "synthetic-sensitive" : JSON.stringify(answer)));
    const result = await adapterFor(f, change === "bytes" ? Buffer.from("wrong") : bytes).invoke(request(), options());
    assert.equal(result.response.state, change === "bytes" ? "unavailable" : "invalid-response");
    assert.equal(JSON.stringify(result).includes("synthetic-sensitive"), false);
  } finally { await f.cleanup(); }
});
for (const state of ["disconnected", "disabled", "cancelled", "expired", "quota", "malformed", "incomplete", "refused"] as const) it(`fails closed for ${state}`, async () => {
  const f = chatGptFixture();
  try {
    if (state !== "disconnected") await f.connected(state !== "disabled");
    if (state === "expired") { f.clock.advanceWall(3_600_000); f.setTokenStatus(400); }
    if (state === "quota") f.setSse('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    if (state === "malformed") f.setSse('data: {"type":"response.completed"}\n\n');
    if (state === "incomplete") f.setSse('data: {"type":"response.output_text.delta","delta":"{}"}\n\n');
    if (state === "refused") f.setSse('data: {"type":"response.refusal.delta","delta":"refused"}\n\n');
    const callOptions = options(); if (state === "cancelled") callOptions.signal = AbortSignal.abort();
    const result = await adapterFor(f).invoke(request(), callOptions);
    assert.equal(result.response.state, "unavailable");
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, ["quota", "malformed", "incomplete", "refused"].includes(state) ? 1 : 0);
  } finally { await f.cleanup(); }
});

it("runs the actual extraction task through the subscription adapter and admits its complete result", async () => {
  const f = chatGptFixture(); try {
    await f.connected(); f.setSse(completedOcrStream(JSON.stringify(submission(f.clock.now().toISOString()))));
    const config = ConfigSchema.parse({ paths: defaultRuntimePaths() }), id = randomUUID(), fingerprint = sha256Hex(canonicalJsonStringify(config));
    let deadline = 0;
    const client = createProviderClient("ocr.extract", { adapters: { "ocr.extract": adapterFor(f) }, clock: f.clock, idFactory: { next: randomUUID }, runSignal: new AbortController().signal,
      execution: { runId: id, attempt: 1, nodeId: "extract", taskId: "ocr/extract-form-page" }, configSnapshotId: id, configFingerprint: fingerprint,
      configSnapshot: { configSnapshotId: id, revision: 1, fingerprint, config, provenance: {}, capturedAt: f.clock.now().toISOString(), capturedBy: "local-operator" },
      deadlineScheduler: { schedule(at) { deadline = at; return { cancel() {} }; } },
    });
    const recorded: unknown[] = [];
    const output = await extractFormPageTask.impl.run({ input: { formType: "oath", page, sourcePage: 4 },
      ctx: { providers: { "ocr.extract": client }, artifacts: { open: async () => Readable.from([bytes]) },
        recordData: (value: unknown) => recorded.push(value), fail: (code: string, message: string) => { throw Object.assign(new Error(message), { code }); },
      } as never,
    });
    assert.equal(output.formType, "oath"); assert.equal(output.sourcePage, 4); assert.equal(output.sourceSha256, page.sha256);
    assert.deepEqual(output.source, { kind: "provider", providerId: "chatgpt-subscription", modelId: "gpt-6.1-sol" });
    assert.ok(output.record); assert.equal(output.record.answers.find(answer => answer.path === "printedName" && answer.state === "read")?.state, "read");
    assert.equal(output.record.blockingPaths.length, 0); assert.equal(recorded.length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 1);
    assert.equal(deadline, f.clock.monotonicMs() + 120_000);
  } finally { await f.cleanup(); }
});
