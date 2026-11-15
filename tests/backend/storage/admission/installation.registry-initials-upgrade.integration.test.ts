import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import * as privatePath from "../../../../src/backend/storage/private-path.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { createProfileSessionWorld } from "../../../support/helpers/backend/profile-session-world.js";

const RowSchema = z.looseObject({ profileId: z.uuid(), timekeeperName: z.string() });
const DocumentSchema = z.looseObject({ schemaVersion: z.number(), revision: z.number(), profiles: z.array(RowSchema) });

/** Writes a registry document and the witness digest that binds it, so only the document's own format can refuse it. */
function writeRegistry(paths: { registry: string; control: string }, document: unknown): void {
  writeFileSync(paths.registry, JSON.stringify(document));
  const witness = z.looseObject({ digest: z.string() }).parse(JSON.parse(readFileSync(paths.control, "utf8")));
  writeFileSync(paths.control, JSON.stringify({ ...witness, digest: createHash("sha256").update(canonicalJsonStringify(document)).digest("hex") }));
}

/** A stopped machine with two profiles, rewritten to the version 3 registry an older build left: no timekeeperInitials, marker 8. */
async function versionThreeMachine() {
  const world = await createProfileSessionWorld();
  const session = world.open();
  const sam = await world.signUp(session, { firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-sam", createdAt: "2026-09-06T11:00:00.000Z" });
  assert.equal((await world.logOut(session, sam.token, "2026-09-06T11:30:00.000Z")).state, "signed-out");
  const alex = await world.signUp(session, { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" });
  assert.equal(session.changeDetails(alex.token, { timekeeperName: "Lex Rivers Day" }).state, "changed");
  const lifetime = world.machine.lifetime, workspace = world.machine.readInstallationContext()?.workspace;
  assert.ok(lifetime instanceof RuntimeLifetimeLock); assert.ok(workspace !== undefined);
  await session.close(); world.machine.release();
  onTestFinished(() => rmSync(workspace, { recursive: true, force: true }));
  const paths = { registry: join(world.machineRoot, "machine", "profiles.json"), marker: join(world.machineRoot, "machine", "profile-registry-version.json"),
    control: join(workspace, ".tracker", "control", "profile-registry.json"), intent: join(workspace, ".tracker", "control", "registry-initials-upgrade.json") };
  const current = DocumentSchema.parse(JSON.parse(readFileSync(paths.registry, "utf8")));
  const prior = { ...current, schemaVersion: 3, profiles: current.profiles.map(({ timekeeperInitials: _seeded, ...row }) => row) };
  writeRegistry(paths, prior);
  writeFileSync(paths.marker, JSON.stringify({ schemaVersion: 8 }));
  const expected = { ...prior, schemaVersion: 4, profiles: prior.profiles.map(row => ({ ...row, timekeeperInitials: row.profileId === sam.profileId ? "SO" : "LRD" })) };
  return { lifetime, workspace, paths, prior, expected, sam, alex };
}

function startup(machine: { workspace: string; lifetime: RuntimeLifetimeLock }): void {
  RuntimeAdmission.acquireStoppedMachineControlMaintenance(machine.workspace, machine.lifetime).release();
}

function assertUpgraded(machine: Awaited<ReturnType<typeof versionThreeMachine>>): void {
  assert.deepEqual(JSON.parse(readFileSync(machine.paths.registry, "utf8")), machine.expected);
  assert.deepEqual(JSON.parse(readFileSync(machine.paths.marker, "utf8")), { schemaVersion: 9 });
  assert.equal(existsSync(machine.paths.intent), false);
  const live = acquireEntrypointAdmission(machine.workspace, "shared", machine.lifetime);
  try { assert.deepEqual(live.readProfileRegistry(), machine.expected); }
  finally { live.release(); }
}

describe("profile registry version 3 to 4 upgrade", () => {
  it("seeds each row's timekeeper initials from its timekeeper name at startup and changes nothing else", async () => {
    const machine = await versionThreeMachine();
    assert.throws(() => acquireEntrypointAdmission(machine.workspace, "shared", machine.lifetime), /profile-control-upgrade-required/u);
    startup(machine);
    assertUpgraded(machine);
  });

  it("reads a version 4 registry unchanged at the next startup", async () => {
    const machine = await versionThreeMachine();
    startup(machine);
    const files = [machine.paths.registry, machine.paths.control, machine.paths.marker].map(path => readFileSync(path));
    startup(machine);
    assert.deepEqual([machine.paths.registry, machine.paths.control, machine.paths.marker].map(path => readFileSync(path)), files);
    assertUpgraded(machine);
  });

  for (const [file, moment] of [["registry", "before"], ["control", "before"], ["marker", "before"], ["marker", "after"]] as const) {
    it(`finishes the same upgrade at the next startup after a stop ${moment} the ${file} file is replaced`, async () => {
      const machine = await versionThreeMachine();
      const replace = privatePath.replacePrivateFile, target = machine.paths[file];
      const crash = vi.spyOn(privatePath, "replacePrivateFile").mockImplementation((stage, path) => {
        if (path === target && moment === "before") throw new Error("injected stop");
        replace(stage, path);
        if (path === target) throw new Error("injected stop");
      });
      assert.throws(() => startup(machine), /injected stop/u);
      crash.mockRestore();
      assert.equal(existsSync(machine.paths.intent), true);
      startup(machine);
      assertUpgraded(machine);
    });
  }

  it("refuses a version 3 registry under the version 9 marker", async () => {
    const machine = await versionThreeMachine();
    startup(machine);
    writeRegistry(machine.paths, machine.prior);
    assert.throws(() => startup(machine), /schemaVersion/u);
    assert.throws(() => acquireEntrypointAdmission(machine.workspace, "shared", machine.lifetime));
  });

  it("refuses a registry newer than this build as before", async () => {
    const machine = await versionThreeMachine();
    startup(machine);
    writeFileSync(machine.paths.marker, JSON.stringify({ schemaVersion: 10 }));
    assert.throws(() => startup(machine), /profile-control-upgrade-pending-conversion-unsupported/u);
    assert.throws(() => acquireEntrypointAdmission(machine.workspace, "shared", machine.lifetime), /profile-control-upgrade-required/u);
    writeFileSync(machine.paths.marker, JSON.stringify({ schemaVersion: 9 }));
    writeRegistry(machine.paths, { ...machine.expected, schemaVersion: 5 });
    assert.throws(() => startup(machine), /schemaVersion/u);
  });
});
