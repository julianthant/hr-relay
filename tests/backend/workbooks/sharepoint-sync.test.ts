import { expect, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import type { CommandBrowserCommands } from "../../../src/backend/systems/browser-shared/command-session.js";
import { createSharePointWorkbookSync } from "../../../src/backend/workbooks/sharepoint-sync.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord, ProtectedStoreRecordSchema } from "../../../src/models/config/protected-settings.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import type { WorkbookSyncCommand } from "../../../src/backend/workbooks/workbook-library-service.js";

const clock = manualClock(new Date("2026-11-02T00:00:00.000Z"));
const base = resolveConfigWithProvenance({}, hostConfigFacts({}), clock).config;
const config = { ...base, features: { ...base.features, duoWebAuthn: false } };
const command = (url = "https://ucsdcloud.sharepoint.com/sites/hr/Documents/Roster.xlsx"): WorkbookSyncCommand => ({
  libraryId: "library", operationId: "operation", expectedVersion: 3,
  link: { url, verifiedAt: IsoInstantSchema.parse(clock.now().toISOString()) }, signal: new AbortController().signal,
});
const noUse = async () => { throw new Error("No download should have completed"); };

it.each([
  "https://other.sharepoint.com/sites/hr/Documents/Roster.xlsx",
  "https://ucsdcloud.sharepoint.com/:x:/s/hr/opaque",
  "https://ucsdcloud.sharepoint.com/sites/hr/Documents/Roster.xlsx?token=private",
])("rejects unsupported sources before protected access or browser admission: %s", async url => {
  let protectedReads = 0, commands = 0;
  const sync = createSharePointWorkbookSync({
    captureConfiguration: () => ({ config, assertCurrent() {} }),
    protectedSecrets: { read: () => { protectedReads++; return initialProtectedStoreRecord(); } },
    createDuoSource: () => { throw new Error("Must not acquire Duo"); },
    commands: { withCommand: () => { commands++; throw new Error("Must not acquire browser"); } },
  });
  await expect(sync.withDownload(command(url), noUse)).rejects.toMatchObject({ code: "SHAREPOINT_LINK_UNSUPPORTED" });
  expect(protectedReads).toBe(0); expect(commands).toBe(0);
});

it.each(["profile", "settings", "protected"] as const)("rechecks captured %s authority at command boundaries", async changed => {
  const refused = new Error("fake selected context changed");
  let current = true, record = initialProtectedStoreRecord(), admitted = 0;
  const commands: CommandBrowserCommands = {
    withCommand: input => {
      admitted++;
      if (changed === "protected") record = ProtectedStoreRecordSchema.parse({ ...record, revision: record.revision + 1,
        lastApplied: { commandId: "00000000-0000-4000-8000-000000000001", writeId: "00000000-0000-4000-8000-000000000002",
          commandFingerprint: "0".repeat(64), expectedRevision: record.revision, protectedSchemaHash: record.protectedSchemaHash } });
      else current = false;
      input.assertCurrent();
      throw new Error("Stale command was admitted");
    },
  };
  const sync = createSharePointWorkbookSync({ commands,
    captureConfiguration: () => ({ config, assertCurrent: () => { if (!current) throw refused; } }),
    protectedSecrets: { read: () => record }, createDuoSource: () => { throw new Error("Duo disabled in fixture"); },
  });
  if (changed === "protected") await expect(sync.withDownload(command(), noUse)).rejects.toMatchObject({ code: "WORKBOOK_SYNC_CONTEXT_CHANGED" });
  else await expect(sync.withDownload(command(), noUse)).rejects.toBe(refused);
  expect(admitted).toBe(1);
});

it("does not capture configuration or read protected values for an already aborted request", async () => {
  const controller = new AbortController(); controller.abort();
  let effects = 0;
  const sync = createSharePointWorkbookSync({
    captureConfiguration: () => { effects++; throw new Error("Must not capture"); },
    protectedSecrets: { read: () => { effects++; throw new Error("Must not read"); } },
    createDuoSource: () => { effects++; throw new Error("Must not acquire Duo"); },
    commands: { withCommand: () => { effects++; throw new Error("Must not acquire browser"); } },
  });
  await expect(sync.withDownload({ ...command(), signal: controller.signal }, noUse)).rejects.toThrow();
  expect(effects).toBe(0);
});
