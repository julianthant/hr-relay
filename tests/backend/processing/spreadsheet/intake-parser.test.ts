import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe,it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { createIntakeParser } from "../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import type { ContentAddressedArtifactWriter } from "../../../../src/workflow-kit/artifacts.js";

type FixtureCell = string | number | boolean | Date | null;

async function workbook(sheets: readonly { name: string; data: readonly (readonly FixtureCell[])[] }[]) {
  const workbookSheets = sheets.map(({ name, data }) => ({
    sheet: name,
    data: data.map((row) => row.map((value) => value === null ? null : { value })),
  }));
  return Buffer.from(await writeXlsxFile(workbookSheets).toBuffer());
}

function artifactFor(bytes: Buffer) {
  return ArtifactRefSchema.parse({
    id: "11111111-2222-4333-8444-555555555555",
    sha256: sha256Hex(bytes.toString("base64")),
    bytes: bytes.byteLength,
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function reader(bytes: Buffer, opened: { count: number }): ContentAddressedArtifactWriter {
  return {
    put: () => { throw new Error("intake parsing must not write artifacts"); },
    open: () => {
      opened.count += 1;
      return Promise.resolve(Readable.from([bytes]));
    },
  };
}

describe("prepared intake parser", () => {
  it("binds the prepared default worksheet to its concrete synchronous selection without reopening", async () => {
    const bytes = await workbook([
      { name: "Roster", data: [["Employee ID#", "Full Name"], ["10800000", "Avery Example"]] },
      { name: "Notes", data: [["Not the roster"]] },
    ]);
    const artifact = artifactFor(bytes);
    const opened = { count: 0 };
    const parser = createIntakeParser({ artifacts: reader(bytes, opened) });

    const prepared = await parser.prepare({ artifact });
    assert.equal(prepared.state, "parsed");
    if (prepared.state !== "parsed") throw new Error("expected a parsed workbook");
    assert.deepEqual(prepared.sheets, ["Roster", "Notes"]);
    assert.equal(prepared.sheet, "Roster");

    const selected = parser.parse({ artifact, sheet: "Roster", headerRowIndex: 0 });
    assert.equal(selected.state, "parsed");
    if (selected.state !== "parsed") throw new Error("expected the concrete sheet selection");
    assert.deepEqual(selected.layout?.rows, [["10800000", "Avery Example"]]);
    assert.equal(opened.count, 1);
  });

  it("prepares the named sheet once, then synchronously re-derives a selected header from retained bytes", async () => {
    const bytes = await workbook([
      {
        name: "Mapping",
        data: [
          ["Roster export", ""],
          ["Employee ID#", "Full Name"],
          ["Employee ID#", "Full Name"],
          ["10800000", "Avery Example"],
          ["10800001", "Jordan Sample"],
        ],
      },
      { name: "Notes", data: [["Not a roster"], ["No names here"]] },
    ]);
    const artifact = artifactFor(bytes);
    const opened = { count: 0 };
    const parser = createIntakeParser({ artifacts: reader(bytes, opened) });

    const prepared = await parser.prepare({ artifact, sheet: "Mapping", headerRowIndex: 1 });
    assert.equal(prepared.state, "parsed");
    if (prepared.state !== "parsed") throw new Error("expected a parsed worksheet");
    assert.deepEqual(prepared.sheets, ["Mapping", "Notes"]);
    assert.equal(prepared.sheet, "Mapping");
    assert.equal(prepared.layout?.headerRowIndex, 1);

    const selected = parser.parse({ artifact, sheet: "Mapping", headerRowIndex: 2 });
    assert.equal(selected.state, "parsed");
    if (selected.state !== "parsed") throw new Error("expected a parsed selection");
    assert.equal(selected.layout?.headerRowIndex, 2);
    assert.deepEqual(selected.layout?.rows, [["10800000", "Avery Example"], ["10800001", "Jordan Sample"]]);
    assert.equal(opened.count, 1, "the synchronous selection reuses the prepared grid");
  });

  it("caches an explicit missing-sheet refusal and rejects parse keys nobody prepared", async () => {
    const bytes = await workbook([{ name: "Roster", data: [["Employee ID#"], ["10800000"]] }]);
    const artifact = artifactFor(bytes);
    const opened = { count: 0 };
    const parser = createIntakeParser({ artifacts: reader(bytes, opened) });

    const first = await parser.prepare({ artifact, sheet: "Missing" });
    const second = await parser.prepare({ artifact, sheet: "Missing" });
    assert.deepEqual(first, second);
    assert.equal(first.state, "refused");
    if (first.state !== "refused") throw new Error("expected a refusal");
    assert.equal(first.code, "unknown-sheet");
    assert.equal(first.message, 'worksheet "Missing" is not in this workbook (Roster)');
    assert.equal(opened.count, 1, "refusal is retained for the exact artifact and sheet key");

    assert.throws(
      () => parser.parse({ artifact, sheet: "Roster", headerRowIndex: 0 }),
      /no intake parse was prepared/u,
    );
  });

  it("evicts the oldest prepared grid after the documented retention limit", async () => {
    const sheets = Array.from({ length: 9 }, (_value, index) => ({
      name: "Sheet " + String(index + 1),
      data: [["Employee ID#", "Full Name"], ["10800000", "Avery Example"]],
    }));
    const bytes = await workbook(sheets);
    const artifact = artifactFor(bytes);
    const opened = { count: 0 };
    const parser = createIntakeParser({ artifacts: reader(bytes, opened) });

    for (let index = 1; index <= 9; index += 1) {
      const result = await parser.prepare({ artifact, sheet: "Sheet " + String(index) });
      assert.equal(result.state, "parsed");
      if (result.state === "parsed") assert.equal(result.sheet, "Sheet " + String(index));
    }
    assert.equal(opened.count, 9);
    assert.throws(
      () => parser.parse({ artifact, sheet: "Sheet 1", headerRowIndex: 0 }),
      /no intake parse was prepared/u,
    );
    const newest = parser.parse({ artifact, sheet: "Sheet 9", headerRowIndex: 0 });
    assert.equal(newest.state, "parsed");
    if (newest.state === "parsed") assert.deepEqual(newest.layout?.rows, [["10800000", "Avery Example"]]);
  });
});
