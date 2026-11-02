import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { readAutomaticRepairNotice } from "../../../../src/backend/storage/maintenance/automatic-repair-notice.js";

vi.mock("../../../../src/backend/storage/admission/admission-identity.js", () => ({ requireRuntimeAdmission: (input: unknown) => input }));

it("projects only this person's verified repair metadata and preserves malformed notices as unavailable", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "automatic-repair-notice-"))), profileId = randomUUID(), installationId = randomUUID();
  const control = join(workspace, ".tracker", "control"), path = join(control, `automatic-repair-${profileId}.json`);
  mkdirSync(control, { recursive: true, mode: 0o700 });
  let stale = false;
  const owner = { assertProfileRuntime() { if (stale) throw new Error("stale person"); }, profileBinding: { installationId, profileId },
    readInstallationContext: () => ({ workspace }), retainSourceClosure: () => assert.fail("ordinary invalid metadata is not native custody") };
  // @ts-expect-error This pure filesystem test replaces only the issued admission boundary.
  const read = () => readAutomaticRepairNotice(owner);
  const record = { schemaVersion: 1, profileId, installationId, operationId: randomUUID(), backupTime: "2026-11-01T12:00:00.000Z",
    restoredAt: "2026-11-02T12:00:00.000Z", authorityGeneration: 1, manifestFileName: `authority-g1-20261101120000000-${randomUUID()}.sqlite.manifest.json` };
  const write = (value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  try {
    assert.deepEqual(read(), { state: "none" }); write(record);
    assert.deepEqual(read(), { state: "restored", backupTime: record.backupTime, restoredAt: record.restoredAt });
    for (const mutation of [{ ...record, profileId: randomUUID() }, { ...record, installationId: randomUUID() },
      { ...record, backupTime: "2026-11-03T12:00:00.000Z" }, { ...record, manifestFileName: "../foreign.manifest.json" }, { ...record, extra: true }]) {
      write(mutation); const bytes = readFileSync(path); assert.equal(read().state, "unavailable"); assert.deepEqual(readFileSync(path), bytes);
    }
    write(record); chmodSync(path, 0o666); assert.equal(read().state, "unavailable"); chmodSync(path, 0o600);
    stale = true; assert.throws(read, /stale person/u); assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), record);
  } finally { rmSync(workspace, { recursive: true }); }
});
