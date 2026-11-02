import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import { donePage, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";
import { bindOcrPageReading } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { ItemIdSchema } from "../../../../src/rules/identity/ids.js";

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
