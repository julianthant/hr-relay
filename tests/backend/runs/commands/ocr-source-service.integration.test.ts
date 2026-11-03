import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { createOcrSourceService, OCR_UPLOAD_MAX_BYTES, OcrSourceRefusedError } from "../../../../src/backend/runs/commands/ocr-source-service.js";
import { randomUUID } from "node:crypto";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { ocrProofReadDatabase, replaceOcrAuditRead, replaceOcrCommandRead } from "../../../support/helpers/backend/ocr-proof-reads.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
it("admits a bounded PDF once, reads the exact authorized source page, and refuses foreign run or page coordinates", async () => {
  const f = await world.fixture({ record: true });
  const generation = f.database.getMeta().authorityGeneration;
  const request = { actorId: "local-operator", fileName: "source.pdf", mediaType: "application/pdf",
    bytes: new TextEncoder().encode("%PDF-1.7\nSynthetic renderer fixture\n%%EOF") };
  const source = await f.sources.upload(request);
  assert.deepEqual(source.artifact, f.reading.input.document);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  for (const refusal of [
    { ...request, mediaType: "text/csv" }, { ...request, actorId: "foreign-operator" },
    { ...request, bytes: new Uint8Array() }, { ...request, bytes: new Uint8Array(OCR_UPLOAD_MAX_BYTES + 1) },
    { ...request, bytes: new TextEncoder().encode("not a PDF") },
  ]) await assert.rejects(f.sources.upload(refusal), OcrSourceRefusedError);
  const lease = await f.sources.page(f.run.envelope.runId, 1, 1);
  assert.equal(lease.ref.id, f.reading.input.image.id);
  const bytes = new Uint8Array(await new Response(await lease.takeBody()).arrayBuffer());
  assert.deepEqual(bytes, new Uint8Array(f.pageBytes));
  await assert.rejects(f.sources.page(randomUUID(), 1, 1));
  await assert.rejects(f.sources.page(f.run.envelope.runId, 2, 1));
  await assert.rejects(f.sources.page(f.run.envelope.runId, 1, 2));
  assert.equal(f.database.getMeta().authorityGeneration, generation);
});

it("closes prepared source bytes when person authority changes during verification", async () => {
  const f = await world.fixture({ record: true });
  let current = true, disposed = false;
  const sources = createOcrSourceService({ database: f.database, reader: f.canonical.lifecycle, clock: f.clock,
    artifacts: f.artifacts, assertCurrent: () => { if (!current) throw new OcrSourceRefusedError(); },
    artifactReader: { verify: ref => f.artifactReader.verify(ref), prepare: async (ref, signal) => {
      const lease = await f.artifactReader.prepare(ref, signal);
      current = false;
      return { ...lease, dispose: async () => { await lease.dispose(); disposed = true; } };
    } } });
  await assert.rejects(sources.page(f.run.envelope.runId, 1, 1), OcrSourceRefusedError);
  assert.equal(disposed, true);
});

it("reads the authenticated original command result without replaying an uncertain correction", async () => {
  const f = await world.fixture({ record: true });
  const command = f.command("correct-ocr-record", 1);
  assert.equal(f.canonical.kernel.execute(command).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2)).state, "applied");
  const generation = f.database.getMeta().authorityGeneration;
  const result = f.sources.commandResult(f.run.envelope.runId, command.commandId);
  assert.ok(result.state === "recorded" && result.request.commandId === command.commandId && result.result.state === "applied");
  assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.revision, 3);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(f.sources.commandResult(f.run.envelope.runId, randomUUID()), { state: "unavailable" });
});

it("settles approval only from exact authenticated command, audit and snapshot reads without replaying it", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const request = f.approval();
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const repositories = f.database.authority;
  const command = repositories.commands.get(request.commandId); assert.ok(command?.family === "gate");
  const audit = repositories.commandAudits.findByCommand(request.commandId); assert.ok(audit?.result.state === "applied");
  assert.equal(f.sources.commandResult(f.run.envelope.runId, request.commandId).state, "recorded");
  const variants: ReadonlyArray<readonly [string, AuthorityRepositories]> = [
    ["missing command", replaceOcrCommandRead(repositories, command.commandId, undefined)],
    ...([
      ["foreign command", { ...command, commandId: randomUUID() }],
      ["foreign actor", { ...command, requestedBy: "foreign-operator" }],
      ["foreign source", { ...command, source: "run-detail" }],
      ["foreign run", { ...command, target: { ...command.target, runId: randomUUID() } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrCommandRead(repositories, command.commandId, CommandRequestSchema.parse(candidate))] as const),
    ["missing audit", replaceOcrAuditRead(repositories, command.commandId, undefined)],
    ...([
      ["divergent audit", { ...audit, request: { ...command, requestedBy: "foreign-operator" } }],
      ["foreign result", { ...audit, result: { ...audit.result, commandId: randomUUID() } }],
      ["unapplied audit", { ...audit, result: { state: "rejected", commandId: command.commandId, code: "invalid-state", message: "Synthetic refusal" } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrAuditRead(repositories, command.commandId, CommandAuditRecordSchema.parse(candidate))] as const),
    ["missing snapshot", { ...repositories, ocrReviews: { ...repositories.ocrReviews, snapshots: () => [] } }],
  ];
  const generation = f.database.getMeta().authorityGeneration;
  for (const [name, altered] of variants) {
    const sources = createOcrSourceService({ database: ocrProofReadDatabase(f.database, altered), reader: f.canonical.lifecycle,
      clock: f.clock, artifacts: f.artifacts, artifactReader: f.artifactReader, assertCurrent: () => f.admission.assertProfileRuntime() });
    let result: ReturnType<typeof sources.commandResult>;
    try { result = sources.commandResult(f.run.envelope.runId, request.commandId); }
    catch (error) { assert.match(String(error), /OCR_(?:REVIEW|SOURCE)_REFUSED/u, name); continue; }
    assert.equal(result.state, "unavailable", name);
  }
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.equal(f.sources.commandResult(f.run.envelope.runId, request.commandId).state, "recorded");
});
