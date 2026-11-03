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
