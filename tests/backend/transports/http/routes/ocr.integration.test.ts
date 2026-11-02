import assert from "node:assert/strict";
import { afterAll, it } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { foreignOriginCases, disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";

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
