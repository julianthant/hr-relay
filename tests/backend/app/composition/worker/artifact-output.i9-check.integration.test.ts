import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import readXlsxFile from "read-excel-file/node";
import { it } from "vitest";
import { composeWorkerArtifactProjector } from "../../../../../src/backend/app/composition/worker/artifact-output.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { ArtifactOutboxStorageRecordSchema } from "../../../../../src/models/artifacts/generated-artifact.js";
import { i9MatchOutcome, i9RetentionRow } from "../../../../../src/rules/i9-check/retention.js";
import { i9CheckWorkbookTable } from "../../../../../src/rules/i9-check/workbook.js";
import { i9Candidate, i9CheckInput } from "../../../../support/fixtures/i9-check.js";
import { foundationFixture, id, update } from "../../../../support/helpers/database-foundation/fixtures.js";

it("publishes nine retention columns at the run's configured tracker path with journal replay and conflict protection", async () => {
  const f = await foundationFixture();
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const projector = composeWorkerArtifactProjector({ admission: f.profile.admission, database: f.db, artifacts, clock: f.clock });
    const row = i9RetentionRow({ input: i9CheckInput, initial: i9MatchOutcome({ hits: [], confirmed: [i9Candidate], dropped: [] }) }).row;
    const first = ArtifactOutboxStorageRecordSchema.parse({ ...update(1), payload: { ...update(1).payload, value: { rows: [row] } } });
    f.db.authority.artifactOutbox.insert(first);
    assert.deepEqual(await projector.projectOutbox([first.outboxId]), { projected: 1 });
    const destination = f.snapshot.config.paths.i9CheckTrackerPath;
    const bytes = readFileSync(destination), sheets = await readXlsxFile(bytes);
    assert.deepEqual(sheets[0].data[0], ["stableKey", "keyValues", "record", "projectedAt"]);
    const view = sheets.find(sheet => sheet.sheet === "I-9 Check"); assert.ok(view);
    assert.deepEqual(view.data[0], i9CheckWorkbookTable([row]).columns);
    assert.deepEqual(view.data[1].map(cell => cell ?? ""), i9CheckWorkbookTable([row]).rows[0].values);
    assert.equal(view.data[1][1], "000012345");
    assert.deepEqual(await projector.projectOutbox([first.outboxId]), { projected: 0 });
    assert.deepEqual(readFileSync(destination), bytes);
    const next = ArtifactOutboxStorageRecordSchema.parse({ ...update(2), payload: { ...update(2).payload, value: { rows: [row, { ...row, recordId: "another-person" }] } } });
    f.db.authority.artifactOutbox.insert(next);
    assert.deepEqual(await projector.projectOutbox([next.outboxId]), { projected: 1 });
    const published = await readXlsxFile(readFileSync(destination));
    assert.equal(published.find(sheet => sheet.sheet === "I-9 Check")?.data.length, 3);
    const head = f.db.authority.artifactSinkHeads.get("xlsx-retention"); assert.ok(head);
    writeFileSync(destination, "Operator changed these bytes");
    f.db.authority.artifactOutbox.insert(ArtifactOutboxStorageRecordSchema.parse({ ...update(3), payload: first.payload }));
    await assert.rejects(projector.projectOutbox([id(3)]), /recorded head/u);
    assert.equal(readFileSync(destination, "utf8"), "Operator changed these bytes");
    assert.deepEqual(f.db.authority.artifactSinkHeads.get("xlsx-retention"), head);
  } finally { await f.dispose(); }
});
