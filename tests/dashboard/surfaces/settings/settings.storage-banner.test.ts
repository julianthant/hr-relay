import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { StorageNotice } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";

const CHECKED_AT = "2026-08-27T16:00:00.000Z";

function storage(authority: "healthy" | "unavailable") {
  return StorageHealthSummaryWireSchema.parse({
    authority,
    backup: "current",
    checkedAt: CHECKED_AT,
  });
}

describe("the app-wide storage notice", () => {
  it("renders only when authority storage is unavailable", () => {
    const healthy = renderToStaticMarkup(createElement(StorageNotice, {
      storage: storage("healthy"),
      onOpenSettings: () => undefined,
    }));
    const unavailable = renderToStaticMarkup(createElement(StorageNotice, {
      storage: storage("unavailable"),
      onOpenSettings: () => undefined,
    }));

    assert.equal(healthy, "");
    assert.match(unavailable, /Storage unavailable/u);
    assert.match(unavailable, /Storage checks/u);
  });
});

for (const authority of ["healthy", "unavailable"] as const) {
  for (const backup of ["current", "stale", "missing"] as const) it(`keeps ${authority}/${backup} summary claims independent`, () => {
    const markup = renderToStaticMarkup(createElement(StorageNotice, {storage: {...storage(authority), backup}, onOpenSettings: () => undefined}));
    if (authority === "healthy") assert.equal(markup, "");
    else assert.match(markup, /Storage unavailable/u);
    assert.doesNotMatch(markup, /backup|restore/iu);
    assert.doesNotMatch(markup, /unaffected|cadence allows|read-write/iu);
  });
}
