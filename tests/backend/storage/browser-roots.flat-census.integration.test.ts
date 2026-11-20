import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { BrowserRootUnavailableError, createProfileBrowserClosure } from "../../../src/backend/storage/browser-roots.js";
import * as processClosure from "../../../src/backend/storage/maintenance/process-closure.js";
import { prepareStoppedBackupClosure, type ProfileBrowserClosure } from "../../../src/backend/storage/maintenance/profile-inventory.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { createHistoricalFlatProfileFixture } from "../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { acquireFlatArchiveFixture } from "../../support/helpers/storage/flat-archive-admission.js";

it("rechecks the operation's flat browser census on both sides of the native probe", async () => {
  const f = await createHistoricalFlatProfileFixture({ closedBrowser: true });
  const proveUnused = vi.spyOn(processClosure, "proveProfileRootsUnused").mockImplementation(() => {});
  try {
    const admission = await acquireFlatArchiveFixture(f.workspace, f.lifetime);
    try {
      const operation = admission.maintenanceOperation();
      for (const replace of [false, true]) {
        const snapshots: string[] = [];
        const nativeProbe = vi.fn(async (_root: string, directory: string) => {
          if (replace) {
            renameSync(directory, join(f.stateRoot, "previous-browser"));
            mkdirSync(directory, { mode: 0o700 });
          }
        });
        const closure = createProfileBrowserClosure(({ signal }) => ({ signal, probe: nativeProbe }));
        const observed: ProfileBrowserClosure = {
          ...closure,
          probeClosed(profiles, timing, clock, signal, owner, source) {
            assert.ok(source);
            assert.equal(source.operation, operation);
            return closure.probeClosed(profiles, timing, clock, signal, owner, { ...source,
              capture() {
                const census = source.capture();
                snapshots.push(census.identity);
                return census;
              },
            });
          },
        };
        const prepare = prepareStoppedBackupClosure(observed, admission, operation, systemClock, f.processLockRoot);
        if (replace) await assert.rejects(prepare, BrowserRootUnavailableError);
        else await prepare;
        assert.deepEqual(nativeProbe.mock.calls, [[join(f.stateRoot, "browsers"), join(f.stateRoot, "browsers", "w1", "ucpath")]]);
        assert.equal(snapshots.length, 2);
        assert.equal(snapshots[0] !== snapshots[1], replace);
      }
    } finally { admission.release(); }
  } finally {
    proveUnused.mockRestore();
    await f.close();
  }
});
