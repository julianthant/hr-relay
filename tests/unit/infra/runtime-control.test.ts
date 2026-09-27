import { spawn } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireInstallation, type RuntimePair } from "../../../src/infra/runtime-control/installation.js";

const workspaces: string[] = [];
function fixture(): { workspace: string; pair: RuntimePair } {
  const workspace = mkdtempSync(join(tmpdir(), "runtime-control-"));
  workspaces.push(workspace);
  return { workspace, pair: { stateRoot: join(workspace, ".tracker"), artifactRoot: join(workspace, ".tracker", "artifacts") } };
}
afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); });
async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("owned child did not exit after SIGKILL")), 5000);
    const done = () => { clearTimeout(timeout); resolve(); };
    child.once("exit", done);
    child.kill("SIGKILL");
    if (child.exitCode !== null || child.signalCode !== null) done();
  });
}

it("adopts empty defaults, admits shared readers, and refuses lost locator and owner mismatch", () => {
  const { workspace, pair } = fixture();
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair });
  expect(first.locator.generation).toBe(0);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/lease busy/u);
  first.release();
  const one = acquireInstallation(workspace, "shared");
  const two = acquireInstallation(workspace, "shared");
  expect(one.locator).toEqual(two.locator);
  one.release(); two.release();
  const locator = join(workspace, ".runtime-control", "locator.json");
  unlinkSync(locator);
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/locator missing/u);
  expect(existsSync(join(pair.stateRoot, ".runtime-owner.json"))).toBe(true);
});

it("does not silently re-adopt defaults after control is lost", () => {
  const { workspace, pair } = fixture();
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); first.release();
  rmSync(join(workspace, ".runtime-control"), { recursive: true });
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/existing ownership witness without locator/u);
});

it("refuses a retained default-source fence after control and owner markers are lost", () => {
  const { workspace, pair } = fixture();
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "valid synthetic authority");
  writeFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), "synthetic retained fence", { mode: 0o600 });
  rmSync(join(workspace, ".runtime-control"), { recursive: true });
  unlinkSync(join(pair.stateRoot, ".runtime-owner.json"));
  unlinkSync(join(pair.artifactRoot, ".runtime-owner.json"));
  let verifierCalled = false;
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair, verifyExisting: (candidate) => {
    verifierCalled = true;
    return { kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-database" };
  } })).toThrow(/retained source fence without locator/u);
  expect(verifierCalled).toBe(false);
  expect(existsSync(join(workspace, ".runtime-control", "installation.json"))).toBe(false);
});

it("requires typed validation for existing defaults and refuses interrupted adoption", () => {
  const { workspace, pair } = fixture();
  mkdirSync(pair.stateRoot, { mode: 0o700 });
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic");
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/requires verifier/u);
  const lease = acquireInstallation(workspace, "exclusive", { defaultPair: pair, verifyExisting: (candidate) => ({ kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-identity" }) });
  lease.release();
  const journal = join(workspace, ".runtime-control", "journal.json");
  writeFileSync(journal, JSON.stringify({ schemaVersion: 1, phase: "adopting", installationId: lease.locator.installationId }), { mode: 0o600 });
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished adopting/u);
});

it("adopts owner-owned 0755 existing roots and preflights unsafe 0777 roots before recording installation", () => {
  const valid = fixture();
  mkdirSync(valid.pair.stateRoot, { mode: 0o755 });
  mkdirSync(valid.pair.artifactRoot, { mode: 0o755 });
  writeFileSync(join(valid.pair.stateRoot, "state.db"), "synthetic");
  const adopted = acquireInstallation(valid.workspace, "exclusive", { defaultPair: valid.pair, verifyExisting: (pair) => {
    expect(Object.isFrozen(pair)).toBe(true);
    return { kind: "verified-existing", pair, authorityGeneration: 3, databaseIdentity: "synthetic-database" };
  } });
  expect(adopted.locator.generation).toBe(0); adopted.release();
  const unsafe = fixture();
  mkdirSync(unsafe.pair.stateRoot, { mode: 0o700 }); chmodSync(unsafe.pair.stateRoot, 0o777);
  expect(() => acquireInstallation(unsafe.workspace, "exclusive", { defaultPair: unsafe.pair })).toThrow(/unsafe data root/u);
  expect(existsSync(join(unsafe.workspace, ".runtime-control", "installation.json"))).toBe(false);
  expect(existsSync(join(unsafe.pair.stateRoot, ".runtime-owner.json"))).toBe(false);
});

it("rejects unsafe private files, root ownership, and invalid overlap", () => {
  const { workspace, pair } = fixture();
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: { stateRoot: pair.stateRoot, artifactRoot: workspace } })).toThrow(/root|overlap|default/u);
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: { stateRoot: join(workspace, "other-state"), artifactRoot: join(workspace, "other-artifacts") } })).toThrow(/known default root pair/u);
  const lease = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); lease.release();
  const exclusive = acquireInstallation(workspace, "exclusive");
  expect(() => exclusive.beginRelocation({ stateRoot: join(workspace, ".runtime-control", "new-state"), artifactRoot: join(workspace, "new-artifacts") })).toThrow(/control overlaps/u);
  exclusive.release();
  const locator = join(workspace, ".runtime-control", "locator.json");
  chmodSync(locator, 0o644);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unsafe file/u);
  chmodSync(locator, 0o600);
  const hardlink = join(workspace, "locator-hardlink"); linkSync(locator, hardlink);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unsafe file/u);
  unlinkSync(hardlink);
  const bytes = readFileSync(locator); unlinkSync(locator); symlinkSync(join(pair.stateRoot, ".runtime-owner.json"), locator);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unsafe file/u);
  unlinkSync(locator); writeFileSync(locator, bytes, { mode: 0o600 });
  const marker = join(pair.stateRoot, ".runtime-owner.json");
  const foreign = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
  foreign.installationId = "00000000-0000-4000-8000-000000000000";
  writeFileSync(marker, JSON.stringify(foreign));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/root ownership mismatch/u);
});

it("keeps locator and destination snapshots immutable and preflights bad destinations", () => {
  const { workspace, pair } = fixture();
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); first.release();
  const lease = acquireInstallation(workspace, "exclusive");
  expect(() => Object.assign(lease.locator, { generation: 99, stateRoot: join(workspace, "wrong") })).toThrow(TypeError);
  const dangling = join(workspace, "dangling-state"); symlinkSync(join(workspace, "absent"), dangling);
  expect(() => lease.beginRelocation({ stateRoot: dangling, artifactRoot: join(workspace, "dangling-artifacts") })).toThrow(/symlink in root path/u);
  const unsafe = join(workspace, "unsafe-state"); mkdirSync(unsafe, { mode: 0o700 }); chmodSync(unsafe, 0o777);
  expect(() => lease.beginRelocation({ stateRoot: unsafe, artifactRoot: join(workspace, "unsafe-artifacts") })).toThrow(/unsafe data root/u);
  expect(existsSync(join(workspace, ".runtime-control", "journal.json"))).toBe(false);
  expect(existsSync(join(pair.stateRoot, ".runtime-source-fence.json"))).toBe(false);
  const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-artifacts") };
  lease.beginRelocation(destination);
  destination.stateRoot = join(workspace, "mutated-state");
  const journal = JSON.parse(readFileSync(join(workspace, ".runtime-control", "journal.json"), "utf8")) as { destination: RuntimePair };
  expect(journal.destination.stateRoot).toBe(join(workspace, "new-state"));
  expect(lease.locator.generation).toBe(0);
  lease.fenceRelocationSource((source, target) => ({ installationId: source.installationId, sourceGeneration: source.generation, destination: target, backupReceiptId: "synthetic-backup", stagingReceiptId: "synthetic-stage" }));
  expect(lease.switchRelocationLocator().stateRoot).toBe(join(workspace, "new-state"));
  lease.settleRelocation();
  expect(() => lease.beginRelocation({ stateRoot: join(workspace, "third-state"), artifactRoot: join(workspace, "third-artifacts") })).toThrow(/one relocation per exclusive lease/u);
  lease.release();
});

it("keeps a durable source fence before the atomic pair switch and refuses interruption", () => {
  const { workspace, pair } = fixture();
  const source = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); source.release();
  const moving = acquireInstallation(workspace, "exclusive");
  const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-artifacts") };
  moving.beginRelocation(destination);
  expect(() => moving.switchRelocationLocator()).toThrow(/source fence required/u);
  moving.fenceRelocationSource((current, target) => ({ installationId: current.installationId, sourceGeneration: current.generation, destination: target, backupReceiptId: "synthetic-backup", stagingReceiptId: "synthetic-stage" }));
  expect(existsSync(join(pair.stateRoot, ".runtime-source-fence.json"))).toBe(true);
  moving.release();
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished fenced/u);
  mkdirSync(destination.stateRoot, { mode: 0o700 });
  writeFileSync(join(destination.stateRoot, ".runtime-owner.json"), JSON.stringify({ schemaVersion: 1, installationId: source.locator.installationId, workspace, role: "state", generation: 1 }), { mode: 0o600 });
  const resume = acquireInstallation(workspace, "exclusive", { recoverRelocation: { installationId: source.locator.installationId, fromGeneration: 0 } });
  const fencedJournal = readFileSync(join(workspace, ".runtime-control", "journal.json"));
  const next = resume.switchRelocationLocator();
  expect(next.generation).toBe(1);
  expect(next.stateRoot).toBe(destination.stateRoot);
  expect(next.artifactRoot).toBe(destination.artifactRoot);
  resume.release();
  writeFileSync(join(workspace, ".runtime-control", "journal.json"), fencedJournal);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished fenced/u);
  const afterSwitchCrash = acquireInstallation(workspace, "exclusive", { recoverRelocation: { installationId: source.locator.installationId, fromGeneration: 0 } });
  expect(afterSwitchCrash.switchRelocationLocator()).toEqual(next);
  afterSwitchCrash.settleRelocation();
  expect(() => afterSwitchCrash.beginRelocation({ stateRoot: join(workspace, "third-state"), artifactRoot: join(workspace, "third-artifacts") })).toThrow(/one relocation per exclusive lease/u);
  afterSwitchCrash.release();
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.locator).toEqual(next); reader.release();
});

it("keeps the source fence as a negative witness if its journal is lost", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  const moving = acquireInstallation(workspace, "exclusive");
  moving.beginRelocation({ stateRoot: join(workspace, "moved-state"), artifactRoot: join(workspace, "moved-artifacts") });
  moving.fenceRelocationSource((source, destination) => ({ installationId: source.installationId, sourceGeneration: source.generation, destination, backupReceiptId: "synthetic-backup", stagingReceiptId: "synthetic-stage" }));
  moving.release();
  unlinkSync(join(workspace, ".runtime-control", "journal.json"));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/fenced source/u);
});

it("refuses a mutex left by a crashed child without automatic reaping", async () => {
  const { workspace, pair } = fixture();
  const lease = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); lease.release();
  const mutex = join(workspace, ".runtime-control", "admission-mutex");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync(${JSON.stringify(mutex)}, {mode:0o700}); writeFileSync(${JSON.stringify(join(mutex, "owner.json"))}, JSON.stringify({schemaVersion:1,acquisitionId:'00000000-0000-4000-8000-000000000000',phase:'admitting',pid:process.pid,processIdentity:{platform:process.platform,startToken:'synthetic'}}), {mode:0o600}); process.stdout.write('READY\\n'); setInterval(()=>{},1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => data.toString().includes("READY") ? resolve() : reject(new Error(String(data)))); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
  } finally { await stopChild(child); }
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/admission mutex busy or abandoned; offline recovery required/u);
});

it("ignores a dead process lease after a crash outside the mutex", async () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  const moduleUrl = new URL("../../../src/infra/runtime-control/installation.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { acquireInstallation } from ${JSON.stringify(moduleUrl)}; acquireInstallation(${JSON.stringify(workspace)}, 'shared'); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => data.toString().includes("READY") ? resolve() : reject(new Error(String(data)))); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
    expect(() => acquireInstallation(workspace, "exclusive")).toThrow(/lease busy/u);
  } finally { await stopChild(child); }
  const afterCrash = acquireInstallation(workspace, "exclusive"); afterCrash.release();
});

it("serializes simultaneous shared and exclusive child-process admission", async () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  const gate = join(workspace, "go");
  const moduleUrl = new URL("../../../src/infra/runtime-control/installation.ts", import.meta.url).href;
  const launch = (mode: "shared" | "exclusive") => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { existsSync } from 'node:fs'; import { acquireInstallation } from ${JSON.stringify(moduleUrl)}; const tick=setInterval(()=>{if(!existsSync(${JSON.stringify(gate)}))return;clearInterval(tick);try{acquireInstallation(${JSON.stringify(workspace)},${JSON.stringify(mode)});process.stdout.write('ACQUIRED');setInterval(()=>{},1000);}catch(error){process.stdout.write('REFUSED:'+String(error));}},1);`], { stdio: ["ignore", "pipe", "pipe"] });
  const shared = launch("shared");
  const exclusive = launch("exclusive");
  try {
    const output = (child: typeof shared) => new Promise<string>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => resolve(data.toString())); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
    const sharedOutput = output(shared);
    const exclusiveOutput = output(exclusive);
    writeFileSync(gate, "go");
    const results = await Promise.all([sharedOutput, exclusiveOutput]);
    expect(results.filter((result) => result === "ACQUIRED")).toHaveLength(1);
    expect(results.filter((result) => result.startsWith("REFUSED:") && result.includes("runtime-control:"))).toHaveLength(1);
  } finally {
    await Promise.all([stopChild(shared), stopChild(exclusive)]);
  }
});
