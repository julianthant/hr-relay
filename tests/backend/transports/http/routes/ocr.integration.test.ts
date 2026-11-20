import { ArtifactRefSchema } from "../../../../../src/models/artifacts/artifacts.js";
import assert from "node:assert/strict";
import { afterAll, it } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { foreignOriginCases, disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";
import { OcrSourceRefusedError } from "../../../../../src/backend/runs/commands/ocr-source-service.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
for (const [label, headers] of foreignOriginCases()) {
  it(`refuses an OCR upload with ${label} before reading bytes or invoking its service`, async () => {
    let effects = 0;
    const h = await harness({ profileFixture: profiles.create, ocr: {
      upload: async () => { effects++; throw new Error("unrequested-upload"); },
      page: async () => { throw new Error("unrequested-page"); },
      commandResult: () => ({ state: "unavailable" as const }),
    } });
    try {
      const response = await h.app.request(new Request("http://localhost/api/v1/ocr/files", {
        method: "POST", headers: { ...headers, "content-type": "application/pdf" }, body: "%PDF-1.7",
      }));
      assert.equal(response.status, 403);
      assert.equal(effects, 0);
    } finally { await disposeHttpRouteHarness(); }
  });
}
it("decodes the private filename header and refuses malformed names before consuming bytes", async () => {
  const seen: string[] = [];
  const h = await harness({ profileFixture: profiles.create, ocr: {
    upload: async input => { seen.push(input.fileName); throw new OcrSourceRefusedError(); },
    page: async () => { throw new Error("unrequested-page"); },
    commandResult: () => ({ state: "unavailable" as const }),
  } });
  try {
    for (const name of [undefined, "%zz", "", "a".repeat(256)]) {
      const request = new Request("http://localhost/api/v1/ocr/files", {
        method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/pdf",
          ...(name === undefined ? {} : { "x-relay-file-name": name }) }, body: "%PDF-1.7",
      });
      assert.equal((await h.app.request(request)).status, 422);
      assert.equal(request.bodyUsed, false);
    }
    assert.deepEqual(seen, []);
    assert.equal((await h.app.request("http://localhost/api/v1/ocr/files", {
      method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/pdf",
        "x-relay-file-name": encodeURIComponent("synthetic scan é.pdf") }, body: "%PDF-1.7",
    })).status, 422);
    assert.deepEqual(seen, ["synthetic scan é.pdf"]);
  } finally { await disposeHttpRouteHarness(); }
});

it("validates the complete OCR page query and both command result IDs at the route", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const h = await harness({ profileFixture: profiles.create, ocr: {
    upload: async () => { throw new Error("unrequested-upload"); },
    page: async (runId, revision, page) => {
      assert.equal(runId, id);
      assert.equal(revision, 1);
      assert.equal(page, 1);
      return {
        ref: ArtifactRefSchema.parse({ id, sha256: "a".repeat(64), bytes: 12, mediaType: "image/png" }),
        takeBody: async () => new Blob(["fixture-page"]).stream(),
        dispose: async () => {},
      };
    },
    commandResult: () => ({ state: "unavailable" }),
  } });
  try {
    const result = await h.app.request(`/api/v1/runs/${id}/ocr/commands/${id}`);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), '{"state":"unavailable"}');
    const validPage = await h.app.request(`/api/v1/runs/${id}/ocr/pages/1?revision=1`);
    assert.equal(validPage.status, 200);
    assert.equal(await validPage.text(), "fixture-page");
    assert.equal(validPage.headers.get("content-disposition"), 'inline; filename="ocr-page-1.png"');

    for (const path of [`/api/v1/runs/${id}/ocr/commands/malformed`, `/api/v1/runs/malformed/ocr/commands/${id}`,
      `/api/v1/runs/malformed/ocr/pages/1?revision=1`, `/api/v1/runs/${id}/ocr/pages/1e0?revision=1`,
      `/api/v1/runs/${id}/ocr/pages/1?revision=1e0`, `/api/v1/runs/${id}/ocr/pages/1?revision=1&revision=1`,
      `/api/v1/runs/${id}/ocr/pages/1?revision=1&extra=unused`]) {
      const response = await h.app.request(path);
      assert.equal(response.status, 400, path);
      assert.match(await response.text(), /"code":"SCHEMA_INVALID"/u);
    }
  } finally { await disposeHttpRouteHarness(); }
});
