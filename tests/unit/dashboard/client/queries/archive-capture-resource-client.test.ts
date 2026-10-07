import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardQueries } from "../../../../../src/dashboard/client/queries.js";
import { DashboardClientError } from "../../../../../src/dashboard/client/errors.js";
import { createDashboardTransport, type FetchLike } from "../../../../../src/dashboard/client/transport.js";
import { FIXTURE_ARCHIVED_RUN } from "../../../../support/fixtures/dashboard/fixture-archive.js";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000002";
const FOREIGN_RUN_ID = "00000000-0000-4000-8000-000000000003";
const FOREIGN_ARTIFACT_ID = "00000000-0000-4000-8000-000000000004";
const PATH = `/api/v1/archive/${RUN_ID}/captures/${ARTIFACT_ID}/resource`;

describe("the archived capture resource client", () => {
  it("binds the requested ids and abort signal to the exact resource request", async () => {
    let observedPath: string | undefined;
    let observedSignal: AbortSignal | null | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      observedPath = url;
      observedSignal = init?.signal;
      return Response.json({
        runId: RUN_ID,
        artifactId: ARTIFACT_ID,
        resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${RUN_ID}/${ARTIFACT_ID}` },
      });
    };
    const queries = createDashboardQueries(createDashboardTransport({ baseUrl: "http://fixture.test", fetchImpl }));
    const controller = new AbortController();

    const resource = await queries.archivedCaptureResource(RUN_ID, ARTIFACT_ID, controller.signal);

    assert.equal(observedPath, `http://fixture.test${PATH}`);
    assert.equal(observedSignal, controller.signal);
    assert.equal(resource.runId, RUN_ID);
    assert.equal(resource.artifactId, ARTIFACT_ID);
  });

  it.each([
    ["run", FOREIGN_RUN_ID, ARTIFACT_ID],
    ["artifact", RUN_ID, FOREIGN_ARTIFACT_ID],
  ] as const)("refuses a strict resource response for a foreign %s identity", async (_label, runId, artifactId) => {
    const fetchImpl: FetchLike = () => Promise.resolve(Response.json({
      runId,
      artifactId,
      resource: { state: "missing", reason: "The archived capture's stored bytes are no longer present." },
    }));
    const queries = createDashboardQueries(createDashboardTransport({ baseUrl: "http://fixture.test", fetchImpl }));

    await assert.rejects(
      () => queries.archivedCaptureResource(RUN_ID, ARTIFACT_ID),
      (error: unknown) => {
        assert.ok(error instanceof DashboardClientError);
        assert.equal(error.kind, "schema");
        assert.equal(error.code, "ARCHIVE_CAPTURE_RESOURCE_IDENTITY_MISMATCH");
        assert.match(error.message, new RegExp(RUN_ID, "u"));
        assert.match(error.message, new RegExp(ARTIFACT_ID, "u"));
        assert.doesNotMatch(error.message, new RegExp(runId === RUN_ID ? artifactId : runId, "u"));
        return true;
      },
    );
  });
});

describe("the archived run client", () => {
  it("refuses a strict archived detail for a foreign requested run", async () => {
    assert.notEqual(FIXTURE_ARCHIVED_RUN.runId, RUN_ID, "the negative control requires a foreign fixture run");
    const fetchImpl: FetchLike = () => Promise.resolve(Response.json(FIXTURE_ARCHIVED_RUN));
    const queries = createDashboardQueries(createDashboardTransport({ baseUrl: "http://fixture.test", fetchImpl }));

    await assert.rejects(
      () => queries.archivedRun(RUN_ID),
      (error: unknown) => {
        assert.ok(error instanceof DashboardClientError);
        assert.equal(error.kind, "schema");
        assert.equal(error.code, "ARCHIVED_RUN_IDENTITY_MISMATCH");
        assert.match(error.message, new RegExp(RUN_ID, "u"));
        assert.doesNotMatch(error.message, new RegExp(FIXTURE_ARCHIVED_RUN.runId, "u"));
        return true;
      },
    );
  });
});
