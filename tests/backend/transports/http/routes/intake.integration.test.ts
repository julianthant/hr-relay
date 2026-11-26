import { IntakeSessionWireSchema } from "../../../../../src/models/intake/wire.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { foreignOriginCases, assertHttpFaultOnly,faultAuthoritySnapshot,disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";

import assert from "node:assert/strict";
import { UNWIRED_INTAKE_SERVICE } from "../../../../support/fixtures/intake-kernel-seams.js";
import { Workbook, writeXlsx } from "@shbernal/ts-xlsx";
import JSZip from "jszip";
import { composeIntake } from "../../../../../src/backend/app/composition/dashboard/intake.js";
import { createIntakeParser } from "../../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { INTAKE_UPLOAD_MAX_BYTES } from "../../../../../src/backend/runs/commands/intake-service.js";
import { INTAKE_FIXTURE_WORKFLOW_ID, intakeFixtureDescriptor, intakeFixtureProjection } from "../../../../support/fixtures/intake-workflow-fixture.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createHash } from "node:crypto";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  const FOREIGN_ORIGIN_CASES = foreignOriginCases();

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses an intake upload with %s before the query, the bytes or the intake service are read",
    async (_label, headers) => {
      let uploads = 0;
      const h = await harness({ profileFixture: profileFixtures.create,
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
    const h = await harness({ profileFixture: profileFixtures.create,
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
  it("cancels an oversized Intake upload before reading the remaining bytes", async () => {
    const upload = vi.fn((input: Parameters<typeof UNWIRED_INTAKE_SERVICE.upload>[0]) => actual.upload(input));
    const h = await harness({ profileFixture: profileFixtures.create, intake: { ...UNWIRED_INTAKE_SERVICE, upload } });
    const actual = composeIntake({ database: h.database, artifacts: h.artifacts, parser: createIntakeParser({ artifacts: h.artifacts }),
      projections: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined },
      descriptors: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined }, clock: h.clock, ids: sequentialIdFactory("c") });
    const chunk = new Uint8Array(1024 * 1024);
    const cancel = vi.fn();
    let bytesRead = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
        bytesRead += chunk.byteLength;
        if (bytesRead === INTAKE_UPLOAD_MAX_BYTES + 2 * chunk.byteLength) controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });
    const streamRequestInit: RequestInit & { readonly duplex: "half" } = {
      method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "text/csv" }, body, duplex: "half",
    };
    const request = new Request(`http://localhost/api/v1/intake/files?workflow=${INTAKE_FIXTURE_WORKFLOW_ID}&filename=roster.csv`, streamRequestInit);

    const response = await h.app.request(request);

    assert.equal(response.status, 400);
    const error = await json(response);
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.equal(error.retryable, false);
    assert.match(String(error.message), /an intake upload may not exceed 26214400 bytes/u);
    assert.equal(bytesRead, INTAKE_UPLOAD_MAX_BYTES + chunk.byteLength);
    expect(cancel).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(["archive", "truncated-pk", "directory", "xml", "rels", "workbook-empty", "relationships-empty"])("refuses malformed XLSX %s through the real upload/parser without creating a session", async corruption => {
    const h = await harness({ profileFixture: profileFixtures.create, intake: { ...UNWIRED_INTAKE_SERVICE, upload: input => actual.upload(input) } });
    const actual = composeIntake({ database: h.database, artifacts: h.artifacts, parser: createIntakeParser({ artifacts: h.artifacts }),
      projections: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined },
      descriptors: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined }, clock: h.clock, ids: sequentialIdFactory("c") });
    const workbook = new Workbook(); workbook.addWorksheet("Roster").addRow(["Employee ID#"]);
    const archive = await JSZip.loadAsync(writeXlsx(workbook));
    if (corruption === "xml" || corruption === "rels") archive.file(corruption === "rels" ? "xl/_rels/workbook.xml.rels" : "xl/worksheets/sheet1.xml", "<worksheet><sheetData><row>");
    if (corruption === "workbook-empty") archive.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>');
    if (corruption === "relationships-empty") archive.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    const bytes = corruption === "archive" ? new Uint8Array([1, 2, 3]) : corruption === "truncated-pk" ? new Uint8Array([0x50, 0x4b, 3, 4]) : await archive.generateAsync({ type: "uint8array" });
    if (corruption === "directory") {
      const directory = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
      assert.ok(directory >= 0 && directory < bytes.length - 22);
      const footer = bytes.slice(-22);
      bytes[directory] = 0;
      assert.deepEqual(bytes.slice(-22), footer);
    }
    const beforeFault = faultAuthoritySnapshot(h);
    const response = await h.app.request(`http://localhost/api/v1/intake/files?workflow=${INTAKE_FIXTURE_WORKFLOW_ID}&filename=broken.xlsx`, {
      method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: new Uint8Array(bytes).buffer,
    });
    assert.equal(response.status, 422); assert.equal((await json(response)).code, "INTAKE_UNREADABLE_FILE");
    assert.deepEqual(h.database.authority.intakeSessions.findActiveBySource(createHash("sha256").update(bytes).digest("hex")), []);
    assertHttpFaultOnly(h, beforeFault, 1);
  });
});

afterEach(disposeHttpRouteHarness);

it("admits the complete intake query before reading upload bytes and validates both result IDs", async () => {
  const h = await harness({ profileFixture: profileFixtures.create, intake: {
    ...UNWIRED_INTAKE_SERVICE,
    upload: input => intake.upload(input),
    read: sessionId => intake.read(sessionId),
  } });
  const intake = composeIntake({ database: h.database, artifacts: h.artifacts, parser: createIntakeParser({ artifacts: h.artifacts }),
    projections: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined },
    descriptors: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined }, clock: h.clock, ids: sequentialIdFactory("c") });
  const uploadUrl = `http://localhost/api/v1/intake/files?workflow=${INTAKE_FIXTURE_WORKFLOW_ID}&filename=roster.csv`;
  const headers = { host: "localhost", origin: "http://localhost", "content-type": "text/csv" };
  const upload = await h.app.request(uploadUrl, { method: "POST", headers, body: "Employee ID#,Effective Date,Dept\n10000001,2026-01-03,Fixture\n" });
  assert.equal(upload.status, 201);
  const createdBody = await upload.text();
  const { intakeSessionId } = IntakeSessionWireSchema.parse(JSON.parse(createdBody));
  const session = await h.app.request(`/api/v1/intake/${intakeSessionId}`);
  assert.equal(session.status, 200);
  assert.equal(await session.text(), createdBody);
  for (const suffix of ["&extra=unused", "&filename=second.csv"]) {
    const request = new Request(uploadUrl + suffix, {
      method: "POST", headers, body: "example",
    });
    const response = await h.app.request(request);
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "SCHEMA_INVALID");
    assert.equal(request.bodyUsed, false);
  }
  const id = "00000000-0000-4000-8000-000000000001";
  const result = await h.app.request(`/api/v1/intake/${id}/commands/${id}`);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), '{"state":"unavailable"}');
  for (const path of ["/api/v1/intake/malformed", `/api/v1/intake/malformed/commands/${id}`, `/api/v1/intake/${id}/commands/malformed`]) {
    const response = await h.app.request(path);
    assert.equal(response.status, 400, path);
    assert.equal((await json(response)).code, "SCHEMA_INVALID");
  }
});
