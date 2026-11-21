import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { StorageNotice } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { StorageAuthoritySummarySchema } from "../../../../src/models/storage/storage-status.js";

function storage(authority: "healthy" | "unavailable") {
  return StorageAuthoritySummarySchema.parse({ authority });
}

describe("the app-wide storage notice", () => {
  it("renders only when authority storage is unavailable", () => {
    const healthy = renderToStaticMarkup(createElement(StorageNotice, {
      storage: storage("healthy")
    }));
    const unavailable = renderToStaticMarkup(createElement(StorageNotice, {
      storage: storage("unavailable")
    }));

    assert.equal(healthy, "");
    assert.match(unavailable, /storage is unavailable/iu);
    assert.doesNotMatch(unavailable, /<button/u);
  });
});
