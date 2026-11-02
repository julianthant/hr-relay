import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import { donePage, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";
import { bindOcrPageReading } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { ItemIdSchema } from "../../../../src/rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { buildOcrSourceManifest, ocrPageInputs } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { insertUnboundOcrExtraction } from "../../../support/fixtures/storage/ocr-extractions.js";
import { containsDeletionArtifactReference } from "../../../../src/backend/storage/sqlite/native-run-deletion.js";

const world = createAuthorityAccountingTestWorld();
afterEach(world.cleanup);

it("retains explicit reading versions across restart and refuses divergent replay without advancing authority", async () => {
  const path = await world.databasePath();
  const database = await world.openDatabase(path);
  const input = sourceFixture(1).inputs[0], first = donePage(input).output;
  const reread = donePage({ ...input, readingId: ItemIdSchema.parse("00000000-0000-4000-8000-000000000909") }, "Example, Robin").output;
  const stored = { ...first, binding: "source-bound" };
  const generation = database.getMeta().authorityGeneration;
  assert.deepEqual(database.authority.ocrExtractions.insert(first), { state: "inserted", record: stored });
  assert.deepEqual(database.authority.ocrExtractions.insert(first), { state: "existing", record: stored });
  assert.equal(database.getMeta().authorityGeneration, generation + 1);
  const divergent = bindOcrPageReading(input, { ...first.extraction, readAt: "2026-11-02T10:00:00.000Z" });
  assert.throws(() => database.authority.ocrExtractions.insert(divergent), /ocr-extraction-replay-conflict/u);
  assert.throws(() => database.authority.ocrExtractions.insert({ ...first, extractionId: reread.extractionId }));
  assert.throws(() => database.authority.ocrExtractions.insert(first.extraction));
  assert.throws(() => database.authority.ocrExtractions.insert({ binding: "unbound-source", extraction: first.extraction,
    extractionId: `${first.extraction.sourceSha256}#1#${first.extraction.formType}` }));
  assert.equal(database.getMeta().authorityGeneration, generation + 1);
  assert.equal(database.authority.ocrExtractions.insert(reread).state, "inserted");
  database.close();
  const reopened = await world.openDatabase(path);
  assert.deepEqual(reopened.authority.ocrExtractions.get(first.extractionId), stored);
  assert.deepEqual(reopened.authority.ocrExtractions.get(reread.extractionId), { ...reread, binding: "source-bound" });
  assert.deepEqual(reopened.authority.ocrExtractions.findBySource(input.image.sha256).map(record => record.extractionId).sort(),
    [first.extractionId, reread.extractionId].sort());
  assert.equal(reopened.authority.ocrExtractions.get("absent"), undefined);
  assert.equal(reopened.getMeta().authorityGeneration, generation + 2);
});

it("blocks native overwrite, replacement and deletion while retaining exact source bindings", async () => {
  const path = await world.databasePath();
  const database = await world.openDatabase(path);
  const reading = donePage(sourceFixture(1).inputs[0]).output;
  database.authority.ocrExtractions.insert(reading);
  const raw = new DatabaseSync(path);
  try {
    assert.throws(() => raw.prepare("UPDATE artifacts SET payload_json='{}' WHERE id=?").run(reading.extractionId), /artifacts-extracted-immutable/u);
    assert.throws(() => raw.prepare("DELETE FROM artifacts WHERE id=?").run(reading.extractionId), /artifact-evidence-retained/u);
    assert.throws(() => raw.prepare("INSERT OR REPLACE INTO artifacts SELECT * FROM artifacts WHERE id=?").run(reading.extractionId), /artifact-identity-conflict/u);
  } finally { raw.close(); }
  assert.deepEqual(database.authority.ocrExtractions.get(reading.extractionId), { ...reading, binding: "source-bound" });
});

for (const binding of ["unbound-source", "source-bound"] as const) {
  it.each(["expiry", "run deletion"] as const)(`retains ${binding} OCR source bytes through %s while removing unrelated bytes`, async cleanup => {
    const w = await trustWorld();
    try {
      const run = w.create(830), terminal = w.cancel(run, 831);
      const artifacts = createContentAddressedArtifactWriter({ admission: w.profile.admission });
      const sourceBytes = Buffer.from("synthetic retained OCR image");
      const image = await artifacts.put(sourceBytes, { mediaType: "image/png" });
      const document = await artifacts.put(Buffer.from("synthetic original OCR document"), { mediaType: "application/pdf" });
      const input = ocrPageInputs(buildOcrSourceManifest(document, { pageCount: 1, pages: [{ sourcePage: 1, image }] }), sourceFixture(1).inputs[0].readingId)[0];
      const reading = donePage(input).output;
      const raw = new DatabaseSync(w.profile.path);
      let stored;
      try { stored = binding === "source-bound" ? w.database.authority.ocrExtractions.insert(reading).record
        : insertUnboundOcrExtraction(raw, reading.extraction); }
      finally { raw.close(); }
      assert.equal(containsDeletionArtifactReference(stored, image), true);
      if (stored.binding === "unbound-source") {
        const { sourceSha256: _source, ...withoutSource } = stored.extraction;
        assert.equal(containsDeletionArtifactReference({ ...stored, extraction: withoutSource }, image), false);
        assert.equal(containsDeletionArtifactReference(stored, document), false);
      }
      const sourcePath = join(w.profile.admission.artifactRoot, `${image.sha256}.artifact`);
      const before = readFileSync(sourcePath);
      const service = createDiagnosticCaptureService({ authority: w.database.authority, artifacts, clock: w.world.clock,
        ids: { uuid: randomUUID }, retentionDays: 1 });
      const capture = (bytes: Uint8Array) => operatorRequestedCapture({ service, runId: run.envelope.runId,
        configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
        attachments: [{ kind: "screenshot", mediaType: "image/png", sensitivity: "restricted", width: 1, height: 1, bytes }] });
      const shared = await capture(sourceBytes), unrelated = await capture(Buffer.from("unreferenced OCR diagnostic"));
      assert.equal(shared.attachments[0]?.digest, image.sha256);
      if (cleanup === "expiry") {
        const result = w.database.sweepOrdinaryDiagnostics(new Date(w.world.clock.nowMs() + 2 * 86_400_000).toISOString());
        assert.deepEqual([...result.purged].sort(), [shared.bundleId, unrelated.bundleId].sort());
        assert.equal(result.retainedBytes, sourceBytes.length);
      } else {
        assert.equal(w.service.delete({ commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: terminal.version }).state, "deleted");
        assert.equal(w.database.authority.runs.get(run.envelope.runId), undefined);
      }
      assert.deepEqual(readFileSync(sourcePath), before);
      assert.equal(existsSync(join(w.profile.admission.artifactRoot, `${unrelated.attachments[0]?.digest}.artifact`)), false);
      assert.deepEqual(w.database.authority.ocrExtractions.get(stored.extractionId), stored);
      const stream = await artifacts.open(image), chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        assert.ok(chunk instanceof Uint8Array);
        chunks.push(chunk);
      }
      assert.deepEqual(Buffer.concat(chunks), sourceBytes);
    } finally { await w.dispose(); }
  });
}
