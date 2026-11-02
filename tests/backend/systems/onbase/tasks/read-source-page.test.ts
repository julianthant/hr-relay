import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument } from "pdf-lib";
import { describe, it } from "vitest";
import { extractOnbasePage, readSourcePageTask } from "../../../../../src/backend/systems/onbase/tasks/read-source-page.js";
import { ONBASE_EXAMPLE_INPUT, OnbaseInputSchema } from "../../../../../src/models/systems/onbase/import-document.js";
import { createOnbaseDriver } from "../../../../../src/backend/systems/onbase/driver/interpreter.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { taskFailer } from "../../../../../src/workflow-kit/task.js";
import { fakeOnbasePage } from "../../../../support/helpers/browser/fake-onbase-page.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function documentBytes() {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([100, 200]); document.addPage([300, 400]); document.addPage([500, 600]);
  return document.save();
}
describe("selected OnBase PDF page", () => {
  it("copies exactly the selected page with deterministic bytes and no neighboring page", async () => {
    const bytes = await documentBytes(), selected = await extractOnbasePage(bytes, 2);
    const document = await PDFDocument.load(selected); assert.equal(document.getPageCount(), 1);
    assert.deepEqual(document.getPage(0).getSize(), { width: 300, height: 400 });
    assert.deepEqual(await extractOnbasePage(bytes, 2), selected);
    for (const page of [0, -1, 4, 1.5]) await assert.rejects(extractOnbasePage(bytes, page));
    await assert.rejects(extractOnbasePage(Buffer.from("not a pdf"), 1));
  });
  it("refuses interactive source fields rather than dropping their values", async () => {
    const document = await PDFDocument.create(); document.addPage();
    document.getForm().createTextField("employee").setText("Example");
    await assert.rejects(extractOnbasePage(await document.save(), 1));
  });
  it("uses the artifact reader, verifies bytes and never stores another copy or exposes PDF bytes in output", async () => {
    const bytes = await documentBytes(), fixture = fakeOnbasePage(), driver = createOnbaseDriver(() => undefined, fixture.page, manualClock(new Date("2026-11-02T12:00:00Z")));
    const input = OnbaseInputSchema.parse({ ...ONBASE_EXAMPLE_INPUT, sourcePage: 2, document: { ...ONBASE_EXAMPLE_INPUT.document, sha256: hash(bytes), bytes: bytes.length } });
    const invoke = (body: Uint8Array) => readSourcePageTask.impl.run({ input, ctx: { driver, signal: new AbortController().signal,
      log: { info() {}, warn() {}, debug() {} }, recordData() {}, captureScreenshot: async () => undefined, fail: taskFailer(readSourcePageTask.contract),
      artifacts: { open: async () => Readable.from([body]), put: async () => { throw new Error("unexpected storage"); } },
    } });
    const output = await invoke(bytes);
    assert.equal(output.pageSha256, hash(await extractOnbasePage(bytes, 2)));
    assert.deepEqual(Object.keys(output).sort(), ["document", "pageSha256", "sourcePage", "ucpathId"]);
    await assert.rejects(invoke(bytes.slice(1)), /source PDF page could not be verified/u);
    const changed = Uint8Array.from(bytes); changed[0] = (changed[0] ?? 0) ^ 1;
    await assert.rejects(invoke(changed), /source PDF page could not be verified/u);
    assert.equal(fixture.actions.includes("click:Import"), false);
  });
});
