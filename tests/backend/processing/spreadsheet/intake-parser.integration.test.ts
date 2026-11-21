import assert from "node:assert/strict";
import { it } from "vitest";
import { createIntakeParser } from "../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("refuses a different media type for an already prepared artifact", async ({ onTestFinished }) => {
  const profile = await createBoundProfileFixture();
  onTestFinished(() => profile.close());
  const artifacts = createContentAddressedArtifactWriter({ admission: profile.admission });
  const artifact = await artifacts.put(Buffer.from("Employee ID#,Full Name\n10800000,Avery Example\n"), { mediaType: "text/csv" });
  const parser = createIntakeParser({ artifacts });
  const prepared = await parser.prepare({ artifact });
  assert.ok(prepared.state === "parsed");
  const { sheet } = prepared;
  assert.equal(parser.parse({ artifact, sheet, headerRowIndex: 0 }).state, "parsed");

  const claimedWorkbook = { ...artifact, mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  await assert.rejects(parser.prepare({ artifact: claimedWorkbook }), /metadata does not match stored content/u);
  await assert.rejects(parser.prepare({ artifact: claimedWorkbook, sheet }), /metadata does not match stored content/u);
  assert.throws(() => parser.parse({ artifact: claimedWorkbook, sheet, headerRowIndex: 0 }), /no intake parse was prepared/u);
});
