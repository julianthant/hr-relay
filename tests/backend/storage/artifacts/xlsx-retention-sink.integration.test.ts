import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { ArtifactSinkConflictError, type ArtifactSinkProjectionRequest } from "../../../../src/backend/storage/artifacts/artifact-sink.js";
import { createXlsxRetentionSink } from "../../../../src/backend/storage/artifacts/xlsx-retention-sink.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";
import { OPERATOR_XLSX_MEDIA_TYPE } from "../../../../src/models/dashboard/xlsx-export.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { id, NOW, update } from "../../../support/helpers/database-foundation/fixtures.js";

const header = ["stableKey", "keyValues", "record", "projectedAt"];
const journalRow = ["f".repeat(64), "[]", '"previous"', NOW];

async function withWorkbook(
  rows: readonly (readonly string[])[],
  run: (fixture: {
    path: string;
    project: () => Promise<unknown>;
    original: Buffer;
    prepared: ArtifactRef[];
  }) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "xlsx-retention-sink-"));
  try {
    const path = join(root, "journal.xlsx");
    const original: unknown = await writeXlsxFile(rows.map(row => row.map(value => ({ value })))).toBuffer();
    assert.ok(Buffer.isBuffer(original));
    writeFileSync(path, original);
    const previousArtifact = ArtifactRefSchema.parse({
      id: id(7),
      sha256: createHash("sha256").update(original).digest("hex"),
      bytes: original.length,
      mediaType: OPERATOR_XLSX_MEDIA_TYPE,
    });
    const row = update(2);
    const prepared: ArtifactRef[] = [];
    const sink = createXlsxRetentionSink({
      workbookPath: path,
      artifacts: {
        open: async () => Readable.from([original]),
        put: async () => { throw new Error("unexpected new retained artifact"); },
      },
    });
    const request: ArtifactSinkProjectionRequest = {
      row,
      head: { sinkId: row.sinkId, contentSha256: previousArtifact.sha256, generation: PositiveIntSchema.parse(1), lastOutboxId: update(1).outboxId, projectedAt: row.createdAt },
      previousArtifact,
      lockPath: await sink.writerLockPath(row),
      prepare: artifact => { prepared.push(artifact); },
      assertPrepared: () => assert.fail("unexpected workbook publication"),
      assertCurrent: async () => {},
    };
    await run({ path, project: () => sink.project(request), original, prepared });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it.each([
  { name: "wrong journal header", rows: [["key", ...header.slice(1)], journalRow] },
  { name: "short journal row", rows: [header, journalRow.slice(0, 3)] },
  { name: "duplicate stable key", rows: [header, journalRow, journalRow] },
])("refuses a retained workbook with a $name", async ({ rows }) => {
  await withWorkbook(rows, async ({ path, project, original, prepared }) => {
    await assert.rejects(project(), /retention-workbook-journal/u);
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(prepared, []);
  });
});

it("reuses the retained version for a matching journal row", async () => {
  const matching = ["a".repeat(64), '[{"field":"subject","value":"synthetic"}]', '"retained-2"', NOW];
  await withWorkbook([header, matching], async ({ path, project, original, prepared }) => {
    assert.deepEqual(await project(), { contentSha256: createHash("sha256").update(original).digest("hex"), artifact: prepared[0] });
    assert.equal(prepared.length, 1);
    assert.deepEqual(readFileSync(path), original);
  });
});

it.each(["file", "symlink", "absent"] as const)("preserves the workbook conflict when the companion is %s", async companion => {
  await withWorkbook([header, journalRow], async ({ path, project }) => {
    writeFileSync(path, "operator edit");
    const pending = `${path}.pending-${id(2)}.xlsx`;
    const existing = companion === "symlink" ? `${pending}.target` : pending;
    if (companion !== "absent") writeFileSync(existing, "another owner's bytes");
    if (companion === "symlink") symlinkSync(existing, pending);
    await assert.rejects(project(), (error: unknown) => {
      assert.ok(error instanceof ArtifactSinkConflictError);
      assert.ok(error.recordedSha256);
      assert.ok(error.actualSha256);
      assert.notEqual(error.recordedSha256, error.actualSha256);
      assert.equal(error.preservedPendingPath, companion === "absent" ? pending : undefined);
      return true;
    });
    assert.equal(readFileSync(path, "utf8"), "operator edit");
    if (companion === "absent") {
      assert.ok(readFileSync(pending).length > 0);
      if (process.platform !== "win32") assert.equal(lstatSync(pending).mode & 0o777, 0o600);
    } else {
      assert.equal(readFileSync(existing, "utf8"), "another owner's bytes");
      assert.equal(lstatSync(pending).isSymbolicLink(), companion === "symlink");
    }
  });
});
