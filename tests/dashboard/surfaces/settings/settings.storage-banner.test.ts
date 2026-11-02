import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import { StorageBanner } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";

const CHECKED_AT = "2026-08-27T16:00:00.000Z";

function storage(authority: "healthy" | "unavailable") {
  return StorageHealthSummaryWireSchema.parse({
    authority,
    automaticRepair: { state: "none" },
    backup: "current",
    checkedAt: CHECKED_AT,
  });
}

function liveRegionClasses(markup: string, role: "alert" | "status"): string {
  const match = new RegExp(`<div class="([^"]+)"(?: [^>]*)? role="${role}"`, "u").exec(markup);
  assert.ok(match?.[1] !== undefined, markup);
  return match[1];
}

describe("the app-wide storage band", () => {
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
    assert.match(unavailable, /Storage checks/u);
  });

  it("uses the bottom-edge-only, radius-free band arm", () => {
    const markup = renderToStaticMarkup(createElement(StorageBanner, {
      storage: storage("unavailable"),
      onOpenSettings: () => undefined,
    }));
    const classes = liveRegionClasses(markup, "alert");

    assert.match(classes, /(?:^| )border-b(?: |$)/u);
    assert.doesNotMatch(classes, /(?:^| )border(?: |$)/u);
    assert.match(classes, /(?:^| )rounded-none(?: |$)/u);
  });
});

for (const authority of ["healthy", "unavailable"] as const) {
  for (const backup of ["current", "stale", "missing"] as const) it(`keeps ${authority}/${backup} summary claims independent`, () => {
    const markup = renderToStaticMarkup(createElement(StorageBanner, {storage: {...storage(authority), backup}, onOpenSettings: () => undefined}));
    if (authority === "healthy") assert.equal(markup, "");
    else assert.match(markup, /Authority storage is unavailable/u);
    assert.doesNotMatch(markup, /backup|restore/iu);
    assert.doesNotMatch(markup, /unaffected|cadence allows|read-write/iu);
  });
}

it("shows the verified repair time as a read-only notice without backup or restore controls", () => {
  const markup = renderToStaticMarkup(createElement(StorageBanner, { storage: { ...storage("healthy"), automaticRepair: {
    state: "restored", backupTime: IsoInstantSchema.parse(CHECKED_AT), restoredAt: IsoInstantSchema.parse("2026-08-28T16:00:00.000Z") } }, onOpenSettings: () => assert.fail("readonly notice dispatched an action") }));
  assert.match(markup, /Person data restored automatically/u);
  assert.ok(markup.includes(`dateTime="${CHECKED_AT}"`) || markup.includes(`datetime="${CHECKED_AT}"`));
  assert.match(markup, /Changes after that backup may be missing/u);
  assert.match(markup, /Current credentials were kept/u);
  assert.doesNotMatch(markup, /<(?:button|input|select)\b/u);
});

it("keeps unavailable repair evidence distinct from a verified absence", () => {
  const markup = renderToStaticMarkup(createElement(StorageBanner, { storage: { ...storage("healthy"), automaticRepair: {
    state: "unavailable", message: "Repair evidence unavailable" } }, onOpenSettings: () => undefined }));
  assert.match(markup, /Repair notice unavailable/u); assert.match(markup, /Repair evidence unavailable/u);
  assert.doesNotMatch(markup, /Person data restored automatically/u);
});
