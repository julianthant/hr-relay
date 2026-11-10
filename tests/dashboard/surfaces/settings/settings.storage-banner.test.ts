import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { StorageNotice } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";

function storage(authority: "healthy" | "unavailable") {
  return StorageHealthSummaryWireSchema.parse({ authority });
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
    assert.match(unavailable, /Storage unavailable/u);
    assert.match(unavailable, /Open Settings &gt; Storage/u);
    assert.doesNotMatch(unavailable, /<button/u);
  });
});
