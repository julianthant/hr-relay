/**
 * D281 item 7: authority loss is the one storage state that mounts an app-wide
 * hazard, and that hazard is a band rather than the default in-surface card.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { StorageHealthSummaryWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { Banner } from "../../../src/dashboard/ds/ui.js";
import { StorageBanner } from "../../../src/dashboard/surfaces/settings.js";

const CHECKED_AT = "2026-08-27T16:00:00.000Z";

function storage(authority: "healthy" | "unavailable") {
  return StorageHealthSummaryWireSchema.parse({
    authority,
    backup: "current",
    checkedAt: CHECKED_AT,
  });
}

function liveRegionClasses(markup: string, role: "alert" | "status"): string {
  const match = new RegExp(`<div role="${role}" class="([^"]+)">`, "u").exec(markup);
  assert.ok(match?.[1] !== undefined, markup);
  return match[1];
}

describe("the app-wide storage band (D281 item 7)", () => {
  it("renders only when authority storage is unavailable", () => {
    const healthy = renderToStaticMarkup(createElement(StorageBanner, {
      storage: storage("healthy"),
      onOpenSettings: () => undefined,
    }));
    const unavailable = renderToStaticMarkup(createElement(StorageBanner, {
      storage: storage("unavailable"),
      onOpenSettings: () => undefined,
    }));

    assert.equal(healthy, "");
    assert.match(unavailable, /Authority storage is unavailable/u);
    assert.match(unavailable, /Storage health/u);
  });

  it("uses the bottom-edge-only, radius-free band arm", () => {
    const markup = renderToStaticMarkup(createElement(StorageBanner, {
      storage: storage("unavailable"),
      onOpenSettings: () => undefined,
    }));
    const classes = liveRegionClasses(markup, "alert");

    assert.match(classes, /(?:^| )border-b(?: |$)/u);
    assert.doesNotMatch(classes, /(?:^| )border(?: |$)/u);
    assert.doesNotMatch(classes, /rounded/u);
  });

  it("leaves every ordinary Banner on the bordered, rounded card shape", () => {
    const markup = renderToStaticMarkup(createElement(Banner, { title: "Ordinary message" }));
    const classes = liveRegionClasses(markup, "status");

    assert.match(classes, /(?:^| )border(?: |$)/u);
    assert.match(classes, /rounded-\[var\(--ds-radius-md\)\]/u);
    assert.doesNotMatch(classes, /(?:^| )border-b(?: |$)/u);
  });
});
