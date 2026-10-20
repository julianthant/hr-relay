import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { pdf } from "pdf-to-img";
import { chatGptFixture, completedOcrStream } from "../../../support/helpers/chatgpt-account-fixtures.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createChatGptOcrAdapter } from "../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";
import { createProviderClient } from "../../../../src/backend/processing/providers/provider-client.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { extractFormPageTask } from "../../../../src/backend/processing/ocr/tasks/extract-form-page.js";
import { ExtractFormPage, OCR_EXTRACTION_REQUEST_HASH } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { DataPointSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { admitOcrExtraction, AdmittedExtractionSchema } from "../../../../src/models/ocr/extraction.js";
import { buildExtractionInstruction } from "../../../../src/models/ocr/instruction.js";
import { OCR_FORMS, fieldOnPageKind } from "../../../../src/models/ocr/form-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { evidenceLeaves, redactEvidenceLeaf } from "../../../../src/models/trust/evidence-classification.js";
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

for (const [formType, pageKind, control] of [
  ["oath", "oath", "valid"],
  ["emergency-contact", "emergency-contact", "valid"],
  ["i9", "i9-section1", "valid"],
  ["i9", "i9-section2", "valid"],
  ["oath", "boilerplate", "valid"],
  ["oath", "unrelated", "valid"],
  ["oath", "blank", "valid"],
  ["oath", "oath", "undeclared"],
  ["oath", "oath", "inconsistent"],
] as const) it(control === "undeclared" ? "refuses a genuinely undeclared OCR observation before checkpoint completion"
  : control === "inconsistent" ? "refuses an OCR observation that contradicts its returned value before checkpoint completion"
  : `persists an admitted ${formType}/${pageKind} checkpoint after subscription transport`, async () => {
  const f = chatGptFixture();
  try {
    await f.connected();
    const artifacts = createContentAddressedArtifactWriter({ admission: f.admission });
    const stored = await artifacts.put(bytes, { mediaType: "image/png" });
    assert.equal(stored.sha256, page.sha256);
    const form = OCR_FORMS[formType];
    const answer = formType === "oath" && pageKind === "oath" ? submission(f.clock.now().toISOString()) : {
      ...submission(f.clock.now().toISOString()), formType, pageKind,
      record: form.pageKinds.includes(pageKind) ? { answers: Object.fromEntries(form.fields.map((field) => [field.path,
        { state: "absent", reason: fieldOnPageKind(field, pageKind) ? "blank" : "not-on-form" },
      ])) } : null,
    };
    f.setSse(completedOcrStream(JSON.stringify(answer)));
    const base = world.fixtureDescriptor("ocr-account-proof", "oc", world.providersOnlyContract);
    const descriptor = defineWorkflowDescriptor({ id: base.id, version: base.version, contractFingerprint: base.contractFingerprint,
      code: base.code, label: base.label, icon: base.icon, category: base.category, canonicalInput: base.canonicalInput,
      inputSubject: "name", surface: base.surface, enqueue: base.enqueue, actions: base.actions, surfaces: {}, details: [],
      identity: base.identity, presentation: base.presentation, scenarios: base.scenarios, flow: flow(base.canonicalInput)
      .step("extract", ExtractFormPage, { dependsOn: [], replay: "checkpoint", bind: () => ({ formType, page: stored, sourcePage: 4 }) })
      .build({ schema: z.strictObject({ done: z.boolean() }), dependsOn: ["extract"], derive: () => ({ done: true }) }) });
    const task = control !== "valid" ? defineTask(ExtractFormPage, {
      sessions: [],
      async run({ input, ctx }) {
        return extractFormPageTask.impl.run({ input, ctx: { ...ctx, recordData(points) {
          if (control === "undeclared") {
            ctx.recordData({ direction: "read", field: "undeclaredOcrLeaf", value: true });
            ctx.recordData(points);
          } else {
            const batch = z.array(DataPointSchema).parse(points);
            ctx.recordData(batch.map(point => point.field === "sourcePage" ? { ...point, value: 5 } : point));
          }
        } } });
      },
    }) : extractFormPageTask;
    const stores = defineTaskStoreRegistry([defineServiceStore("ocr", { extract: task })], {
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
    const checkpoint = harness.authority.database.authority.runCheckpoints.latest(descriptor.id, claimed.run.envelope.itemId, "extract");
    const observations = harness.emitter.events().flatMap((event) => event.t === "data.observed" ? event.points : []);
    if (control !== "valid") {
      assert.equal(outcome.state, "failed");
      assert.ok(failure);
      assert.equal(checkpoint, undefined);
      if (control === "undeclared") {
        assert.match(failure.summary, /no declared evidence classification.*undeclaredOcrLeaf/su);
        assert.deepEqual(observations, []);
      } else {
        assert.match(failure.summary, /recorded value for sourcePage contradicts its parsed output/u);
        assert.deepEqual(observations.find(point => point.field === "sourcePage")?.values.map(value => {
          assert.ok(value.state === "allowed");
          return value.value;
        }), [5]);
      }
    } else {
      assert.equal(outcome.state, "done", failure?.summary ?? "composed extraction must finish");
      assert.equal(failure, undefined);
      assert.ok(checkpoint);
      const admission = admitOcrExtraction(answer);
      assert.equal(admission.admitted, true);
      if (!admission.admitted) throw new Error("fixture extraction must be admitted");
      const extraction = AdmittedExtractionSchema.parse(checkpoint.output.value);
      assert.deepEqual(extraction, admission.extraction);
      assert.equal(checkpoint.output.schemaHash, deriveSchemaHash(ExtractFormPage.output, "output"));
      assert.equal(checkpoint.runId, claimed.run.envelope.runId);
      assert.equal(checkpoint.claimGeneration, claimed.claim.claimGeneration);
      assert.equal(checkpoint.attempt, claimed.run.envelope.attempt);
      assert.equal(checkpoint.workflowId, descriptor.id);
      assert.equal(checkpoint.itemId, claimed.run.envelope.itemId);
      assert.equal(checkpoint.nodeId, "extract");
      assert.equal(checkpoint.contractFingerprint, descriptor.contractFingerprint);
      assert.equal(checkpoint.descriptorVersion, descriptor.version);
      assert.equal(extraction.sourceSha256, stored.sha256);
      assert.equal(extraction.sourcePage, 4);
      assert.deepEqual(extraction.source, answer.source);
      assert.equal(extraction.readAt, answer.readAt);
      const fields = ["formType", "sourcePage", "pageKind", "pageFingerprint", "record", "source", "readAt", "sourceSha256"] as const;
      assert.deepEqual(observations.map(({ field }) => field), fields);
      const scope = { kind: "task-output", taskId: ExtractFormPage.id } as const;
      assert.deepEqual(observations.map(({ direction, field, values }) => ({ direction, field, values })),
        fields.map(field => ({ direction: "read", field,
          values: evidenceLeaves(extraction[field], field).map(leaf => redactEvidenceLeaf(scope, leaf)),
        })));
      assert.deepEqual(checkpoint.provenance.map(({ path }) => path).sort(), evidenceLeaves(extraction).map(({ path }) => path));
      for (const fact of checkpoint.provenance) {
        assert.equal(fact.source, "live");
        assert.equal(fact.originalObservedAt, fact.observedAt);
      }
      assert.ok(checkpoint.observationOrigins?.length);
      for (const { origin } of checkpoint.observationOrigins) {
        assert.equal(origin.runId, claimed.run.envelope.runId);
        assert.equal(origin.attempt, claimed.run.envelope.attempt);
        assert.equal(origin.nodeId, "extract");
        assert.equal(origin.taskId, ExtractFormPage.id);
      }
      for (const leaf of evidenceLeaves(extraction)) {
        const local = redactEvidenceLeaf({ kind: "task-output", taskId: ExtractFormPage.id }, leaf);
        assert.ok(local.state === "allowed");
        assert.deepEqual(local.value, leaf.value);
      }
    }
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

function buildTwoPagePdf(): Buffer {
  const stream = "BT /F1 16 Tf 72 700 Td (Synthetic page) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document, "latin1");
}

for (const pageCount of [1, 2] as const)
  it(`requires a singleton PDF before subscription extraction: ${pageCount} pages`, async () => {
    const f = chatGptFixture(); try {
      await f.connected();
      const documentBytes = pageCount === 1
        ? readFileSync(new URL("../../../support/fixtures/documents/synthetic-sample.pdf", import.meta.url)) : buildTwoPagePdf();
      const parsed = await pdf(documentBytes, { scale: 1 });
      try { assert.equal(parsed.length, pageCount); } finally { await parsed.destroy(); }
      const sourceSha256 = createHash("sha256").update(documentBytes).digest("hex");
      const document = ArtifactRefSchema.parse({ ...page, sha256: sourceSha256, bytes: documentBytes.byteLength, mediaType: "application/pdf" });
      f.setSse(completedOcrStream(JSON.stringify({ ...submission(f.clock.now().toISOString()), sourceSha256 })));
      const adapter = createChatGptOcrAdapter({ account: f.service, clock: f.clock, model: "gpt-6.1-sol", artifacts: { open: async () => Readable.from([documentBytes]) } });
      const original = request();
      const result = await adapter.invoke({ ...original, payload: { ...original.payload, value: { ...original.payload.value, page: document } } }, options());
      assert.equal(result.response.state, pageCount === 1 ? "produced" : "invalid-response");
      assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, pageCount === 1 ? 1 : 0);
    } finally { await f.cleanup(); }
  });
