import assert from "node:assert/strict";
import { mkdirSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { BrowserRootsSchema } from "../../../../src/backend/storage/browser-root-contract.js";
import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import type { BrowserProfileProbeFactory } from "../../../../src/backend/storage/browser-roots.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import * as custody from "../../../../src/backend/storage/maintenance/custody-availability.js";
import { initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";

const io = vi.hoisted(() => ({ afterMove: undefined as ((source: string, target: string) => void) | undefined,
  afterPublish: undefined as ((target: string) => void) | undefined, queries: 0, moves: 0, startupProbes: [] as string[] }));
vi.mock("../../../../src/backend/runtime/browser/native-browser.js", async load => ({
  ...await load<typeof import("../../../../src/backend/runtime/browser/native-browser.js")>(),
  createNativeBrowserProbe(input: { signal: AbortSignal }) { return { signal: input.signal, async probe(_root: string, directory: string) { io.startupProbes.push(directory); } }; },
}));
vi.mock("../../../../src/backend/storage/maintenance/process-closure.js", async load => ({
  ...await load<typeof import("../../../../src/backend/storage/maintenance/process-closure.js")>(),
  proveProfileRootsUnused() { io.queries++; },
}));
vi.mock("../../../../src/backend/storage/private-path.js", async load => {
  const actual = await load<typeof import("../../../../src/backend/storage/private-path.js")>();
  return { ...actual,
    movePrivateDirectoryExclusive(source: string, target: string) {
      if (existsSync(target)) throw new Error("fixture exclusive target exists");
      renameSync(source, target); io.moves++; io.afterMove?.(source, target);
    },
    replacePrivateFile(source: string, target: string) { actual.replacePrivateFile(source, target); io.afterPublish?.(target); },
  };
});
afterEach(() => { io.afterMove = undefined; io.afterPublish = undefined; io.moves = 0; io.queries = 0; io.startupProbes = []; vi.restoreAllMocks(); });
const clock = manualClock(new Date("2026-11-04T12:00:00.000Z"));

async function priorFixture() {
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const fixture = await createBoundProfileFixture({ pending: "onboarding", lifetime });
  assert.equal(fixture.draft?.state, "onboarding");
  const operationPath = join(fixture.machine.stateRoot, "machine", "operations", `${fixture.draft.operationId}.json`);
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))); assert.ok(operation.onboarding);
  const roots = createBrowserRoots(fixture.machine), profileRoot = join(fixture.machine.stateRoot, "browsers", "onboarding");
  const request = { profileId: operation.profileId, profileRoot, credentialFingerprint: null,
    owner: { kind: "signup" as const, operationId: operation.operationId, accountId: operation.onboarding.accountId, providerGeneration: operation.onboarding.generation } };
  const allocated = roots.beginSignupLaunch(request);
  mkdirSync(allocated.input.profileDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(join(allocated.input.profileDirectory, "owned.txt"), "preserved auth fixture", { mode: 0o600 });
  allocated.opened(); allocated.closing(); allocated.closed();
  const current = roots.inventory();
  const priorDirectory = `onboarding-${operation.operationId}-${operation.profileId}-${operation.onboarding.accountId}-g${operation.onboarding.generation}`;
  const directory = join(profileRoot, priorDirectory);
  renameSync(allocated.input.profileDirectory, directory);
  const { nextHandle: _nextHandle, ...prior } = current;
  const document = { ...prior, schemaVersion: 1, roots: prior.roots.map(({ handle: _handle, ...row }) => ({ ...row, directory: `browsers/onboarding/${priorDirectory}` })) };
  const path = join(fixture.machine.stateRoot, "machine", "browser-roots.json");
  writeFileSync(path, JSON.stringify(document), { mode: 0o600 });
  await fixture.closeController();
  let stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace, lifetime);
  const probes: string[] = [];
  const probe: BrowserProfileProbeFactory = input => ({ signal: input.signal, async probe(_root, directory) {
    const intent: unknown = JSON.parse(readFileSync(join(fixture.workspace, ".tracker", "control", "browser-root-upgrade.json"), "utf8"));
    assert.ok(typeof intent === "object" && intent !== null && "phase" in intent);
    assert.equal(intent.phase, "probing", "native acquisition must have a durable intent before it opens Chromium");
    probes.push(directory);
  } });
  return { ...fixture, lifetime, path, directory, document, request, probes, probe,
    get stopped() { return stopped; },
    reopen() { stopped.release(); stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace, lifetime); },
    async cleanup() { stopped.release(); await lifetime.close(); rmSync(fixture.workspace, { recursive: true, force: true }); } };
}

it("migrates a retained root with its owner and bytes intact, and the current reader rejects the predecessor", async () => {
  const f = await priorFixture();
  try {
    const before = readFileSync(f.path);
    assert.equal(BrowserRootsSchema.safeParse(f.document).success, false);
    assert.throws(() => createBrowserRoots(f.stopped).inventory());
    assert.equal(await f.stopped.upgradeBrowserRoots(f.probe, clock), "upgraded");
    const current = BrowserRootsSchema.parse(JSON.parse(readFileSync(f.path, "utf8"))), row = current.roots[0]; assert.ok(row);
    assert.equal(row.directory, "browsers/onboarding/r1"); assert.equal(row.handle, 1); assert.equal(current.nextHandle, 2);
    assert.deepEqual(row.owner, f.document.roots[0]?.owner); assert.equal(row.profileId, f.request.profileId);
    assert.deepEqual(row.launch, f.document.roots[0]?.launch);
    const target = join(f.stopped.stateRoot, ...row.directory.split("/"));
    assert.equal(readFileSync(join(target, "owned.txt"), "utf8"), "preserved auth fixture");
    assert.equal(existsSync(f.directory), false); assert.deepEqual(f.probes, [f.directory]);
    const control = join(f.workspace, ".tracker", "control"), backups = join(control, "browser-root-upgrades");
    const backupNames = readdirSync(backups); assert.equal(backupNames.length, 1); assert.ok(backupNames[0]);
    assert.deepEqual(readFileSync(join(backups, backupNames[0])), before);
    assert.equal(existsSync(join(control, "browser-root-upgrade.json")), false);
    assert.equal(await f.stopped.upgradeBrowserRoots(f.probe, clock), "current");
    assert.equal(f.probes.length, 1); assert.equal(io.moves, 1);
  } finally { await f.cleanup(); }
});

it("runs the forward conversion during real stopped startup before admitting current readers", async () => {
  const f = await priorFixture();
  try {
    f.stopped.release();
    await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
    const machine = RuntimeAdmission.acquireMachine(f.workspace, "exclusive", f.lifetime);
    try { assert.equal(createBrowserRoots(machine).inventory().roots[0]?.directory, "browsers/onboarding/r1"); }
    finally { machine.release(); }
    assert.deepEqual(io.startupProbes, [f.directory]); assert.equal(io.moves, 1);
  } finally { await f.cleanup(); }
});

it("refuses a pre-existing compact target without overwriting either directory or publishing an intent", async () => {
  const f = await priorFixture();
  try {
    const before = readFileSync(f.path), target = join(f.request.profileRoot, "r1");
    mkdirSync(target, { mode: 0o700 }); writeFileSync(join(target, "foreign.txt"), "keep foreign bytes", { mode: 0o600 });
    await assert.rejects(f.stopped.upgradeBrowserRoots(f.probe, clock));
    assert.deepEqual(readFileSync(f.path), before); assert.equal(readFileSync(join(target, "foreign.txt"), "utf8"), "keep foreign bytes");
    assert.equal(readFileSync(join(f.directory, "owned.txt"), "utf8"), "preserved auth fixture");
    assert.equal(io.moves, 0); assert.equal(io.queries, 0); assert.deepEqual(f.probes, []);
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "browser-root-upgrade.json")), false);
  } finally { await f.cleanup(); }
});

for (const phase of ["directory-move", "registry-publication"] as const) it(`resumes the exact journal prefix after a ${phase} interruption`, async () => {
  const f = await priorFixture(), interrupted = new Error("fixture interrupted upgrade");
  try {
    if (phase === "directory-move") io.afterMove = () => { throw interrupted; };
    else io.afterPublish = target => { if (target === f.path) throw interrupted; };
    await assert.rejects(f.stopped.upgradeBrowserRoots(f.probe, clock), error => error === interrupted);
    const control = join(f.workspace, ".tracker", "control");
    assert.equal(existsSync(join(control, "browser-root-upgrade.json")), true);
    assert.equal(existsSync(f.directory), false);
    assert.equal(readFileSync(join(f.request.profileRoot, "r1", "owned.txt"), "utf8"), "preserved auth fixture");
    io.afterMove = undefined; io.afterPublish = undefined;
    f.reopen();
    assert.equal(await f.stopped.upgradeBrowserRoots(f.probe, clock), "upgraded");
    assert.equal(BrowserRootsSchema.parse(JSON.parse(readFileSync(f.path, "utf8"))).roots[0]?.directory, "browsers/onboarding/r1");
    assert.equal(existsSync(join(control, "browser-root-upgrade.json")), false); assert.equal(io.moves, 1);
    assert.equal(f.probes.length, 1, "recovery must use the recorded closure prefix rather than reopening a moved profile");
  } finally { await f.cleanup(); }
});

it("resumes a recorded probe intent before any native acquisition or directory move", async () => {
  const f = await priorFixture(), interrupted = new Error("fixture probe-intent interruption");
  try {
    const intentPath = join(f.workspace, ".tracker", "control", "browser-root-upgrade.json"), before = readFileSync(f.path);
    io.afterPublish = target => { if (target === intentPath) throw interrupted; };
    await assert.rejects(f.stopped.upgradeBrowserRoots(f.probe, clock), error => error === interrupted);
    assert.equal(existsSync(intentPath), true); assert.deepEqual(readFileSync(f.path), before);
    assert.equal(existsSync(f.directory), true); assert.equal(existsSync(join(f.request.profileRoot, "r1")), false);
    assert.deepEqual(f.probes, []); assert.equal(io.moves, 0);
    io.afterPublish = undefined; f.reopen();
    assert.equal(await f.stopped.upgradeBrowserRoots(f.probe, clock), "upgraded");
    assert.deepEqual(f.probes, [f.directory]); assert.equal(io.moves, 1); assert.equal(existsSync(intentPath), false);
  } finally { await f.cleanup(); }
});

it("keeps the Windows layout-migration refusal ahead of every probe, backup and move", async () => {
  const f = await priorFixture();
  try {
    const before = readFileSync(f.path);
    vi.spyOn(custody, "assertMaintenanceCustodyAvailable").mockImplementation(operation => { throw new custody.StorageMaintenanceCustodyUnavailableError(operation); });
    await assert.rejects(f.stopped.upgradeBrowserRoots(f.probe, clock), error => error instanceof custody.StorageMaintenanceCustodyUnavailableError && error.operation === "layout-migration");
    assert.deepEqual(readFileSync(f.path), before); assert.equal(io.moves, 0); assert.equal(io.queries, 0); assert.deepEqual(f.probes, []);
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "browser-root-upgrades")), false);
  } finally { await f.cleanup(); }
});

it("rejects an unknown directory beside the retained source without hiding it in the new registry", async () => {
  const f = await priorFixture();
  try {
    const before = readFileSync(f.path), unknown = join(f.request.profileRoot, "unbound"); mkdirSync(unknown, { mode: 0o700 });
    await assert.rejects(f.stopped.upgradeBrowserRoots(f.probe, clock));
    assert.deepEqual(readFileSync(f.path), before); assert.equal(existsSync(unknown), true); assert.equal(io.moves, 0);
  } finally { await f.cleanup(); }
});
