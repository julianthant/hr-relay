import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeProfileAtStartup } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { manualClock, systemClock } from "../../../../src/rules/time/clock.js";
import { restoreSchema42AssistantStorage } from "../../../support/fixtures/storage/historical-run-schema.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { seedRegisteredBrowserProfiles } from "../../../support/helpers/browser/browser-roots.js";

// Each probe launch rewrites RunningChromeVersion and Chrome leaves it on close, as the native probe does on macOS.
const leaves = { "chrome-version": "159.0.8154.6", "outside-target": "/var/folders/chrome/SingletonSocket", "nested-target": "../159.0.8154.6" } as const;

for (const link of ["chrome-version", "outside-target", "nested-target", "elsewhere"] as const) it(`${link === "chrome-version" ? "upgrades" : "refuses"} a startup profile whose browser probe leaves ${link} links`, async () => {
  const profile = await createBoundProfileFixture();
  const profileId = profile.admission.profileBinding.profileId;
  const probe = vi.spyOn(profileBrowserClosure, "probeClosed").mockImplementation(async profiles => {
    for (const { profileDirectory } of profiles) {
      const path = join(profileDirectory, link === "elsewhere" ? "Default" : "", "RunningChromeVersion");
      mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
      rmSync(path, { force: true }); symlinkSync(link === "elsewhere" ? leaves["chrome-version"] : leaves[link], path);
    }
  });
  try {
    const { paths } = await seedRegisteredBrowserProfiles(profile, manualClock(new Date("2026-11-26T12:00:00.000Z")), ["ucpath", "crm"]);
    for (const path of paths) mkdirSync(path, { recursive: true, mode: 0o700 });
    profile.admission.release();
    { using raw = new DatabaseSync(profile.path); restoreSchema42AssistantStorage(raw); }
    const upgrade = upgradeProfileAtStartup(profileBrowserClosure, profile.machine, profileId, { primaryDisplay: null }, systemClock);
    if (link === "chrome-version") {
      assert.deepEqual(await upgrade, { state: "upgraded", fromSchemaVersion: 42, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
      assert.ok(probe.mock.calls.length > 0);
    } else {
      await assert.rejects(upgrade, function causes(error: unknown): boolean {
        return error instanceof Error && (error.message === "profile-inventory-path-unsafe" || causes(error.cause)
          || error instanceof AggregateError && error.errors.some(causes));
      });
    }
    using upgraded = new DatabaseSync(profile.path, { readOnly: true });
    const expected = link === "chrome-version" ? CURRENT_AUTHORITY_SCHEMA_VERSION : 42;
    assert.equal(inspectNativeAuthority(upgraded, expected).schemaVersion, expected);
  } finally { probe.mockRestore(); await profile.close(); }
});
