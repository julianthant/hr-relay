import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import * as privatePath from "../../../../src/backend/storage/private-path.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { createProfileSessionWorld } from "../../../support/helpers/backend/profile-session-world.js";

const DocumentSchema = z.looseObject({ schemaVersion: z.number(), profiles: z.array(z.looseObject({ profileId: z.uuid(),
  registration: z.looseObject({ onboardingCompletion: z.looseObject({}).optional() }) })) });
const sha256 = (value: unknown) => createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
const TOUCH_RECEIPT = { receiptDigest: "c".repeat(64), softwareInterceptionDisabled: true, operatorConfirmedAt: "2026-09-06T12:05:00.000Z" };

type Paths = { registry: string; control: string; marker: string; intent: string; operations: string };

/** Rewrites the registry and every operation file, then the witness that binds them, so only the stored formats can refuse. */
function writeStore(paths: Paths, document: unknown, operations: readonly { operationId: string }[]): void {
  writeFileSync(paths.registry, JSON.stringify(document));
  mkdirSync(paths.operations, { recursive: true, mode: 0o700 });
  for (const operation of operations) writeFileSync(join(paths.operations, `${operation.operationId}.json`), JSON.stringify(operation), { mode: 0o600 });
  const inventory = readdirSync(paths.operations).filter(name => name.endsWith(".json")).sort()
    .map(name => ({ operationId: name.slice(0, -5), digest: sha256(JSON.parse(readFileSync(join(paths.operations, name), "utf8"))) }));
  const witness = z.looseObject({}).parse(JSON.parse(readFileSync(paths.control, "utf8")));
  writeFileSync(paths.control, JSON.stringify({ ...witness, digest: sha256(document), operations: inventory }));
}

/** A stopped machine with one profile, rewritten to the version 4 registry an older build left: each completion holds a Touch ID receipt, marker 9. */
async function versionFourMachine(operations: (profileId: string) => readonly { operationId: string }[] = () => []) {
  const world = await createProfileSessionWorld();
  const session = world.open();
  const alex = await world.signUp(session, { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" });
  const lifetime = world.machine.lifetime, workspace = world.machine.readInstallationContext()?.workspace;
  assert.ok(lifetime instanceof RuntimeLifetimeLock); assert.ok(workspace !== undefined);
  await session.close(); world.machine.release();
  onTestFinished(() => rmSync(workspace, { recursive: true, force: true }));
  const machine = join(world.machineRoot, "machine"), control = join(workspace, ".tracker", "control");
  const paths: Paths = { registry: join(machine, "profiles.json"), marker: join(machine, "profile-registry-version.json"), operations: join(machine, "operations"),
    control: join(control, "profile-registry.json"), intent: join(control, "security-key-only-upgrade.json") };
  const expected = DocumentSchema.parse(JSON.parse(readFileSync(paths.registry, "utf8")));
  assert.equal(expected.schemaVersion, 5);
  assert.ok(expected.profiles.every(row => row.registration.onboardingCompletion !== undefined));
  const prior = { ...expected, schemaVersion: 4, profiles: expected.profiles.map(row => ({ ...row,
    registration: { ...row.registration, onboardingCompletion: { ...row.registration.onboardingCompletion, touch: TOUCH_RECEIPT } } })) };
  writeStore(paths, prior, operations(alex.profileId));
  writeFileSync(paths.marker, JSON.stringify({ schemaVersion: 9 }));
  return { lifetime, workspace, paths, expected, profileId: alex.profileId };
}

function startup(machine: { workspace: string; lifetime: RuntimeLifetimeLock }): void {
  RuntimeAdmission.acquireStoppedMachineControlMaintenance(machine.workspace, machine.lifetime).release();
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function attempt(method: "key" | "touch", state: "pending" | "complete" | "unknown" | "closed", ceremony?: "fast-duo" | "chromium-platform") {
  return { attemptId: randomUUID(), generation: 1, method, expiresAt: "2026-09-06T13:10:00.000Z", state,
    ...(ceremony === undefined ? {} : { ceremony: { credentialId: `${method}-credential`, requestId: `${method}-request`, mechanism: ceremony, softwareInterceptionDisabled: ceremony !== "fast-duo" } }) };
}

function reenrol(profileId: string, attempts: readonly ReturnType<typeof attempt>[], aborted = false) {
  return { schemaVersion: 1, kind: "duo-reenrol", operationId: randomUUID(), profileId, createdAt: "2026-09-06T13:00:00.000Z",
    draft: { accountId: randomUUID(), generation: 1, attempts }, ...(aborted ? { abort: { abortedAt: "2026-09-06T13:05:00.000Z" } } : {}) };
}

/** The security-key attempt as the current schema stores it: the retired ceremony mechanism fields are gone. */
function keyOnly(row: ReturnType<typeof attempt>) {
  const { ceremony, ...rest } = row;
  return { ...rest, ...(ceremony === undefined ? {} : { ceremony: { credentialId: ceremony.credentialId, requestId: ceremony.requestId } }) };
}

function assertUpgraded(machine: Awaited<ReturnType<typeof versionFourMachine>>): void {
  assert.deepEqual(readJson(machine.paths.registry), machine.expected);
  assert.deepEqual(readJson(machine.paths.marker), { schemaVersion: 10 });
  assert.equal(existsSync(machine.paths.intent), false);
}

describe("profile registry version 4 to 5 upgrade (security key only)", () => {
  it("drops each completion's Touch ID receipt at startup and changes nothing else", async () => {
    const machine = await versionFourMachine();
    assert.throws(() => acquireEntrypointAdmission(machine.workspace, "shared", machine.lifetime), /profile-control-upgrade-required/u);
    startup(machine);
    assertUpgraded(machine);
    const live = acquireEntrypointAdmission(machine.workspace, "shared", machine.lifetime);
    try { assert.deepEqual(live.readProfileRegistry(), machine.expected); }
    finally { live.release(); }
  });

  it("rewrites stored re-enrol operations to key-only attempts and binds their new digests", async () => {
    let aborted: ReturnType<typeof reenrol> | undefined, open: ReturnType<typeof reenrol> | undefined;
    const key = attempt("key", "complete", "fast-duo");
    const machine = await versionFourMachine(profileId => {
      aborted = reenrol(profileId, [attempt("touch", "pending", "chromium-platform")], true);
      open = reenrol(profileId, [key, attempt("touch", "closed")]);
      return [aborted, open];
    });
    assert.ok(aborted !== undefined && open !== undefined);
    startup(machine);
    assertUpgraded(machine);
    const abortedNext = { ...aborted, draft: { ...aborted.draft, attempts: [] } }, openNext = { ...open, draft: { ...open.draft, attempts: [keyOnly(key)] } };
    assert.deepEqual(readJson(join(machine.paths.operations, `${aborted.operationId}.json`)), abortedNext);
    assert.deepEqual(readJson(join(machine.paths.operations, `${open.operationId}.json`)), openNext);
    const witness = z.looseObject({ operations: z.array(z.strictObject({ operationId: z.uuid(), digest: z.string() })) }).parse(readJson(machine.paths.control));
    for (const next of [abortedNext, openNext]) assert.deepEqual(witness.operations.find(row => row.operationId === next.operationId), { operationId: next.operationId, digest: sha256(next) });
  });

  it("refuses an open operation that still holds a live Touch ID attempt and leaves every file as it was", async () => {
    const machine = await versionFourMachine(profileId => [reenrol(profileId, [attempt("key", "complete", "fast-duo"), attempt("touch", "pending")])]);
    const files = [machine.paths.registry, machine.paths.control, machine.paths.marker].map(path => readFileSync(path));
    assert.throws(() => startup(machine), /security-key-upgrade-touch-attempt-in-flight/u);
    assert.deepEqual([machine.paths.registry, machine.paths.control, machine.paths.marker].map(path => readFileSync(path)), files);
    assert.equal(existsSync(machine.paths.intent), false);
  });

  it("reads the version 5 registry unchanged at the next startup", async () => {
    const machine = await versionFourMachine(profileId => [reenrol(profileId, [attempt("key", "pending"), attempt("touch", "closed")])]);
    startup(machine);
    const paths = [machine.paths.registry, machine.paths.control, machine.paths.marker, ...readdirSync(machine.paths.operations).map(name => join(machine.paths.operations, name))];
    const files = paths.map(path => readFileSync(path));
    startup(machine);
    assert.deepEqual(paths.map(path => readFileSync(path)), files);
    assertUpgraded(machine);
  });

  for (const [file, moment] of [["operation", "before"], ["operation", "after"], ["registry", "before"], ["control", "before"], ["marker", "before"], ["marker", "after"]] as const) {
    it(`finishes the same upgrade at the next startup after a stop ${moment} the ${file} file is replaced`, async () => {
      let operation: ReturnType<typeof reenrol> | undefined;
      const key = attempt("key", "pending");
      const machine = await versionFourMachine(profileId => { operation = reenrol(profileId, [key, attempt("touch", "closed")]); return [operation]; });
      assert.ok(operation !== undefined);
      const replace = privatePath.replacePrivateFile;
      const target = file === "operation" ? join(machine.paths.operations, `${operation.operationId}.json`) : machine.paths[file];
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
      assert.deepEqual(readJson(join(machine.paths.operations, `${operation.operationId}.json`)), { ...operation, draft: { ...operation.draft, attempts: [keyOnly(key)] } });
    });
  }
});
