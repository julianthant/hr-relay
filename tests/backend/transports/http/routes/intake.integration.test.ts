import { foreignOriginCases } from "../../../../support/helpers/backend/http-route-harness.js";

import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNWIRED_INTAKE_SERVICE } from "../../../../support/fixtures/intake-kernel-seams.js";
import Excel from "exceljs";
import JSZip from "jszip";
import { composeIntake } from "../../../../../src/backend/app/composition/dashboard/intake.js";
import { createIntakeParser } from "../../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { INTAKE_FIXTURE_WORKFLOW_ID, intakeFixtureDescriptor, intakeFixtureProjection } from "../../../../support/fixtures/intake-workflow-fixture.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createHash } from "node:crypto";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  const FOREIGN_ORIGIN_CASES = foreignOriginCases();

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses an intake upload with %s before the query, the bytes or the intake service are read",
    async (_label, headers) => {
      let uploads = 0;
      const h = harness({
        intake: {
          ...UNWIRED_INTAKE_SERVICE,
          upload: () => {
            uploads += 1;
            return Promise.resolve({ state: "refused" as const, code: "unreadable-file" as const, message: "unreachable" });
          },
        },
      });
      const request = new Request("http://localhost/api/v1/intake/files?workflow=fixture-graph&filename=roster.csv", {
        method: "POST",
        headers: { ...headers, "content-type": "text/csv" },
        body: "eid\n10873698\n",
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false);
      assert.equal(uploads, 0);
    },
  );

  it("admits a same-origin intake upload under the file's own media type and keeps the route's media contract", async () => {
    const seen: string[] = [];
    const h = harness({
      intake: {
        ...UNWIRED_INTAKE_SERVICE,
        upload: (input) => {
          seen.push(`${input.workflow}|${input.fileName}|${input.mediaType}|${String(input.bytes.byteLength)}`);
          return Promise.resolve({ state: "refused" as const, code: "unreadable-file" as const, message: "the fixture intake accepts nothing" });
        },
      },
    });
    const response = await h.app.request("http://localhost/api/v1/intake/files?workflow=fixture-graph&filename=roster.csv", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "text/csv" },
      body: "eid\n10873698\n",
    });
    // Admitted (not 403/415): the intake service's own refusal answers, under
    // the route's typed intake code — the loopback door never requires JSON here.
    assert.equal(response.status, 422);
    assert.equal((await json(response)).code, "INTAKE_UNREADABLE_FILE");
    assert.deepEqual(seen, ["fixture-graph|roster.csv|text/csv|13"]);
  });
  it.each(["archive", "truncated-pk", "directory", "xml", "rels"])("refuses malformed XLSX %s through the real upload/parser without creating a session", async corruption => {
    const h = harness({ intake: { ...UNWIRED_INTAKE_SERVICE, upload: input => actual.upload(input) } });
    const actual = composeIntake({ database: h.database, artifacts: h.artifacts, parser: createIntakeParser({ artifacts: h.artifacts }),
      projections: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined },
      descriptors: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined }, clock: h.clock, ids: sequentialIdFactory("c") });
    const workbook = new Excel.Workbook(); workbook.addWorksheet("Roster").addRow(["Employee ID#"]);
    const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
    if (corruption === "xml" || corruption === "rels") archive.file(corruption === "rels" ? "xl/_rels/workbook.xml.rels" : "xl/worksheets/sheet1.xml", "<worksheet><sheetData><row>");
    const bytes = corruption === "archive" ? new Uint8Array([1, 2, 3]) : corruption === "truncated-pk" ? new Uint8Array([0x50, 0x4b, 3, 4]) : await archive.generateAsync({ type: "uint8array" });
    if (corruption === "directory") {
      const directory = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
      assert.ok(directory >= 0 && directory < bytes.length - 22);
      const footer = bytes.slice(-22);
      bytes[directory] = 0;
      assert.deepEqual(bytes.slice(-22), footer);
    }
    const generation = h.database.getMeta().authorityGeneration;
    const response = await h.app.request(`http://localhost/api/v1/intake/files?workflow=${INTAKE_FIXTURE_WORKFLOW_ID}&filename=broken.xlsx`, {
      method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: new Uint8Array(bytes).buffer,
    });
    assert.equal(response.status, 422); assert.equal((await json(response)).code, "INTAKE_UNREADABLE_FILE");
    assert.deepEqual(h.database.authority.intakeSessions.findActiveBySource(createHash("sha256").update(bytes).digest("hex")), []);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
});

import { disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
