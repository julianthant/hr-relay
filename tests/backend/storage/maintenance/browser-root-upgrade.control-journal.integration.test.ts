import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { BrowserRootsSchema, StoppedBrowserRootsV1Schema } from "../../../../src/backend/storage/browser-root-contract.js";
import { upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

const probe = (input: { signal: AbortSignal }) => ({ signal: input.signal, async probe() { assert.fail("an empty installation must not open Chromium"); } });
const read = (path: string) => z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, "utf8")));
const write = (path: string, value: unknown) => writeFileSync(path, canonicalJsonStringify(value), { mode: 0o600 });

for (const boundary of ["preparing", "browser", "registry", "control", "marker"] as const)
it(`continues a captured V1 browser journal at cold stopped startup after ${boundary} publication`, async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "predecessor-browser-journal-")));
  let lifetime = await RuntimeLifetimeLock.acquire(0);
  let stopped: RuntimeAdmission | undefined;
  const rename = fs.renameSync;
  let fired = false;
  const machine = RuntimeAdmission.acquireMachine(workspace, "exclusive", lifetime), state = machine.stateRoot;
  machine.release();
  const controlRoot = join(workspace, ".tracker", "control"), control = join(controlRoot, "profile-registry.json");
  const registry = join(state, "machine", "profiles.json"), marker = join(state, "machine", "profile-registry-version.json"), browsers = join(state, "machine", "browser-roots.json");
  const intent = join(controlRoot, "profile-control-upgrade.json"), archives = join(controlRoot, "profile-control-upgrades");
  const initial = read(control);
  write(control, { ...initial, schemaVersion: 5, completedRestores: [] }); write(marker, { schemaVersion: 6 }); fs.unlinkSync(browsers);
  for (const name of ["credential-keys", "duo-credentials"]) mkdirSync(join(state, "machine", name), { recursive: true, mode: 0o700 });
  if (!existsSync(join(state, "machine", "profile-pepper"))) writeFileSync(join(state, "machine", "profile-pepper"), randomBytes(32), { mode: 0o600 });
  const fault = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
    rename(source, target);
    const path = String(target);
    if (!fired && (boundary === "preparing" ? path === intent && read(intent).phase === "preparing"
      : path === (boundary === "browser" ? browsers : boundary === "registry" ? registry : boundary === "control" ? control : marker))) {
      fired = true; throw new Error("fixture captured predecessor publication");
    }
  }); syncBuiltinESMExports();
  try {
    stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime);
    await assert.rejects(upgradeStoppedMachineControl(stopped, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock, composeStoppedControlCredentialInventory, probe));
    fault.mockRestore(); syncBuiltinESMExports(); assert.equal(fired, true);
    stopped.release(); stopped = undefined;
    const captured = read(intent), current = BrowserRootsSchema.parse(captured.browsers);
    assert.equal(current.roots.length, 0);
    const { nextHandle: _nextHandle, ...prior } = current;
    const predecessor = StoppedBrowserRootsV1Schema.parse({ ...prior, schemaVersion: 1, roots: [] });
    const old: Record<string, unknown> = { ...captured, browsers: predecessor };
    const operationId = z.uuid().parse(captured.operationId), stage = join(archives, `${operationId}.browser.stage`);
    if (boundary !== "preparing") {
      const path = existsSync(stage) ? stage : browsers;
      write(path, predecessor);
      old.browserStage = { ...z.record(z.string(), z.unknown()).parse(captured.browserStage), digest: createHash("sha256").update(readFileSync(path)).digest("hex") };
    }
    write(intent, old);
    const saved = fs.readdirSync(archives).filter(name => name.endsWith(".before.json")).map(name => ({ name, bytes: readFileSync(join(archives, name)), inode: fs.lstatSync(join(archives, name)).ino }));
    assert.equal(saved.length, 3);
    await lifetime.close(); lifetime = await RuntimeLifetimeLock.acquire(0);
    stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime);
    assert.equal(await stopped.upgradeBrowserRoots(probe, systemClock), "deferred");
    const result = await upgradeStoppedMachineControl(stopped, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock, composeStoppedControlCredentialInventory, probe);
    assert.equal(result.state, "upgraded"); assert.equal(result.profileCount, 0); assert.equal(existsSync(intent), false);
    assert.equal(BrowserRootsSchema.safeParse(read(browsers)).success, false);
    assert.equal(StoppedBrowserRootsV1Schema.parse(read(browsers)).schemaVersion, 1);
    for (const savedFile of saved) {
      assert.deepEqual(readFileSync(join(archives, savedFile.name)), savedFile.bytes);
      assert.equal(fs.lstatSync(join(archives, savedFile.name)).ino, savedFile.inode);
    }
    assert.equal(await stopped.upgradeBrowserRoots(probe, systemClock), "upgraded");
    stopped.release(); stopped = undefined;
    const currentMachine = RuntimeAdmission.acquireMachine(workspace, "exclusive", lifetime);
    try { assert.deepEqual(currentMachine.readProfileRegistry().profiles, []); assert.equal(BrowserRootsSchema.parse(read(browsers)).schemaVersion, 3); }
    finally { currentMachine.release(); }
  } finally { fault.mockRestore(); syncBuiltinESMExports(); stopped?.release(); await lifetime.close(); rmSync(workspace, { recursive: true, force: true }); }
});
