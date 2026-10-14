import { withSynchronousMutexDeadline } from "../../../support/helpers/storage/synchronous-mutex-deadline.js";
import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireInstallation, recoverAbandonedAdmissionMutex } from "../../../../src/backend/storage/admission/installation.js";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

const {fixture, restore, adoptSynthetic, relocationPlan, prepareDestination, staged, cleanup } = createInstallationControlTestWorld();

afterEach(cleanup);
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

it("refuses a duplicate managed entry in a partially retained lock shell", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  lease.recordVerifiedStage(staged(lease, destination, operationId, plan));
  lease.fenceRelocationSource();
  const journalPath = join(workspace, ".tracker/control", "journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
  writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
  const retained = join(workspace, ".tracker", `.data.retained-${operationId}-state`);
  mkdirSync(retained, { mode: 0o700 });
  copyFileSync(join(pair.stateRoot, ".runtime-owner.json"), join(retained, ".runtime-owner.json"));
  copyFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), join(retained, ".runtime-source-fence.json"));
  copyFileSync(join(pair.stateRoot, "state.db"), join(retained, "state.db"));
  expect(() => lease.retainRelocationSources()).toThrow(/duplicate retained managed entry|tombstone/u);
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("source");
  lease.release(); held.release();
});

it("recovers empty and first-witness retained shells, but refuses foreign entries", () => {
  for (const partial of ["empty", "marker", "foreign"] as const) {
    const { workspace, pair } = fixture();
    const initial = adoptSynthetic(workspace, pair); initial.release();
    writeFileSync(join(pair.stateRoot, "state.db"), "source");
    writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
    const lease = acquireInstallation(workspace, "exclusive");
    const held = restore(workspace);
    const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
    const plan = relocationPlan(lease, destination);
    const operationId = lease.beginRelocation(destination, plan, held);
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan);
    lease.recordVerifiedStage(verify);
    lease.fenceRelocationSource();
    const journalPath = join(workspace, ".tracker/control", "journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
    writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
    const retained = join(workspace, ".tracker", `.data.retained-${operationId}-state`);
    mkdirSync(retained, { mode: 0o700 });
    if (partial === "marker") copyFileSync(join(pair.stateRoot, ".runtime-owner.json"), join(retained, ".runtime-owner.json"));
    if (partial === "foreign") writeFileSync(join(retained, "foreign"), "unknown");
    lease.release(); held.release();
    const recoveredHeld = restore(workspace);
    const recovered = acquireInstallation(workspace, "exclusive", { recoverRelocation: {
      installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: recoveredHeld,
    } });
    if (partial === "foreign") {
      expect(() => recovered.retainRelocationSources()).toThrow(/ambiguous retained shell/u);
      expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("source");
    } else {
      recovered.retainRelocationSources();
      recovered.switchRelocationLocator(verify);
      recovered.settleRelocation(verify);
      expect(existsSync(join(workspace, ".tracker/control", "journal.json"))).toBe(false);
    }
    recovered.release(); recoveredHeld.release();
  }
});

it("refuses unknown managed state entries before source fencing", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  const verify = staged(lease, destination, operationId, plan);
  writeFileSync(join(pair.stateRoot, "unlisted.log"), "unknown");
  expect(() => lease.recordVerifiedStage(verify)).toThrow(/managed state entry membership mismatch/u);
  expect(existsSync(join(pair.stateRoot, ".runtime-source-fence.json"))).toBe(false);
  lease.release(); held.release();
});

it("keeps low-level installation admission from reaping a crashed child's mutex", async () => {
  const { workspace, pair } = fixture();
  const lease = adoptSynthetic(workspace, pair); lease.release();
  const mutex = join(workspace, ".tracker/control", "admission-mutex");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync(${JSON.stringify(mutex)}, {mode:0o700}); writeFileSync(${JSON.stringify(join(mutex, "owner.json"))}, JSON.stringify({schemaVersion:1,acquisitionId:'00000000-0000-4000-8000-000000000000',phase:'admitting',pid:process.pid,processIdentity:{platform:process.platform,startToken:'synthetic'}}), {mode:0o600}); process.stdout.write('READY\\n'); setInterval(()=>{},1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => data.toString().includes("READY") ? resolve() : reject(new Error(String(data)))); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
  } finally { await stopChild(child); }
  withSynchronousMutexDeadline(() => {
    expect(() => acquireInstallation(workspace, "shared")).toThrow(/admission mutex remained busy after 5000ms/u);
  });
});

it.each(["temporary", "published"])('startup recovers a proven abandoned %s mutex owner', (kind) => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  const mutex = join(workspace, ".tracker/control", "admission-mutex");
  mkdirSync(mutex, { mode: 0o700 });
  const owner = { schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: 99999999,
    processIdentity: { platform: process.platform, startToken: "synthetic-dead-owner" } };
  const ownerName = kind === "temporary" ? `.${randomUUID()}.tmp` : "owner.json";
  writeFileSync(join(mutex, ownerName), `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  const admitted = withSynchronousMutexDeadline(() => acquireEntrypointAdmission(workspace, "shared"));
  admitted.release();
  expect(existsSync(mutex)).toBe(false);
  const history = join(workspace, ".tracker/control", "admission-mutex-recovery");
  expect(JSON.parse(readFileSync(join(history, `${owner.acquisitionId}.json`), "utf8"))).toMatchObject({
    acquisitionId: owner.acquisitionId, pid: owner.pid, ownerFile: ownerName,
  });
  const next = acquireEntrypointAdmission(workspace, "shared"); next.release();
});

it.each(["live owner", "pending journal", "live lease", "malformed owner"])(
  "startup preserves an occupied mutex with %s", (condition) => {
    const { workspace, pair } = fixture();
    const initial = adoptSynthetic(workspace, pair); initial.release();
    const control = join(workspace, ".tracker/control");
    const mutex = join(control, "admission-mutex");
    mkdirSync(mutex, { mode: 0o700 });
    const current = observeProcessIdentity(process.pid);
    if (current.state !== "alive") throw new Error("current process identity unavailable");
    const owner = { schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting",
      pid: condition === "live owner" ? process.pid : 99999999,
      processIdentity: condition === "live owner" ? current.identity
        : { platform: process.platform, startToken: "synthetic-dead-owner" } };
    const ownerPath = join(mutex, "owner.json");
    writeFileSync(ownerPath, condition === "malformed owner" ? "not-json" : `${JSON.stringify(owner)}\n`, { mode: 0o600 });
    if (condition === "pending journal") writeFileSync(join(control, "journal.json"), JSON.stringify({
      schemaVersion: 1, phase: "adopting", installationId: initial.locator.installationId,
    }), { mode: 0o600 });
    if (condition === "live lease") {
      const admissionId = randomUUID();
      writeFileSync(join(control, "leases", `${admissionId}.json`), JSON.stringify({ schemaVersion: 1,
        admissionId, mode: "shared", pid: process.pid, processIdentity: current.identity }), { mode: 0o600 });
    }
    withSynchronousMutexDeadline(() => {
      expect(() => acquireEntrypointAdmission(workspace, "shared")).toThrow();
    });
    expect(existsSync(ownerPath)).toBe(true);
    expect(existsSync(join(control, "admission-mutex-recovery"))).toBe(false);
  },
);

it.each(["temporary", "published"])("recovers an exact abandoned %s mutex owner under held offline restore admission", (kind) => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  const mutex = join(workspace, ".tracker/control", "admission-mutex");
  mkdirSync(mutex, { mode: 0o700 });
  const owner = { schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: 99999999,
    processIdentity: { platform: process.platform, startToken: "synthetic-dead-owner" } };
  const ownerPath = join(mutex, kind === "temporary" ? `.${randomUUID()}.tmp` : "owner.json");
  writeFileSync(ownerPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  const held = restore(workspace);
  try {
    expect(() => recoverAbandonedAdmissionMutex(workspace, held, 99999998)).toThrow(/expected pid mismatch/u);
    writeFileSync(join(mutex, "unexpected"), "unknown", { mode: 0o600 });
    expect(() => recoverAbandonedAdmissionMutex(workspace, held, owner.pid)).toThrow(/unexpected entries/u);
    unlinkSync(join(mutex, "unexpected"));
    if (kind === "published") {
      const history = join(workspace, ".tracker/control", "admission-mutex-recovery");
      mkdirSync(history, { mode: 0o700 });
      writeFileSync(join(history, `${owner.acquisitionId}.json`), JSON.stringify({
        schemaVersion: 1, acquisitionId: owner.acquisitionId, pid: owner.pid,
        processIdentity: owner.processIdentity, installationId: initial.locator.installationId,
        generation: 0, ownerFile: basename(ownerPath),
        ownerSha256: createHash("sha256").update(readFileSync(ownerPath)).digest("hex"),
        recoveredAt: "2026-09-26T00:00:00.000Z",
      }), { mode: 0o600 });
    }
    const result = recoverAbandonedAdmissionMutex(workspace, held, owner.pid);
    expect(result.acquisitionId).toBe(owner.acquisitionId);
    expect(existsSync(mutex)).toBe(false);
    expect(readFileSync(join(workspace, ".tracker/control", "admission-mutex-recovery", owner.acquisitionId,
      basename(ownerPath)), "utf8")).toBe(`${JSON.stringify(owner)}\n`);
    expect(JSON.parse(readFileSync(result.receiptPath, "utf8"))).toMatchObject({ pid: owner.pid,
      acquisitionId: owner.acquisitionId, ownerFile: basename(ownerPath) });
    if (kind === "published") expect(JSON.parse(readFileSync(result.receiptPath, "utf8"))).toHaveProperty(
      "recoveredAt", "2026-09-26T00:00:00.000Z");
    const after = acquireInstallation(workspace, "shared"); after.release();
  } finally { held.release(); }
});

it.each(["live lease", "pending journal", "symlink owner", "public owner"])("refuses mutex recovery with %s", (condition) => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  const control = join(workspace, ".tracker/control");
  const mutex = join(control, "admission-mutex");
  mkdirSync(mutex, { mode: 0o700 });
  const owner = { schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: 99999999,
    processIdentity: { platform: process.platform, startToken: "synthetic-dead-owner" } };
  const ownerPath = join(mutex, "owner.json");
  writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
  if (condition === "live lease") {
    const current = observeProcessIdentity(process.pid);
    if (current.state !== "alive") throw new Error("current process identity unavailable");
    const admissionId = randomUUID();
    writeFileSync(join(control, "leases", `${admissionId}.json`), JSON.stringify({ schemaVersion: 1,
      admissionId, mode: "shared", pid: process.pid, processIdentity: current.identity }), { mode: 0o600 });
  } else if (condition === "pending journal") {
    writeFileSync(join(control, "journal.json"), JSON.stringify({ schemaVersion: 1, phase: "adopting",
      installationId: initial.locator.installationId }), { mode: 0o600 });
  } else if (condition === "symlink owner") {
    const target = join(dirname(workspace), "preserved-owner.json");
    renameSync(ownerPath, target);
    symlinkSync(target, ownerPath);
  } else chmodSync(ownerPath, 0o644);
  const held = restore(workspace);
  try {
    expect(() => recoverAbandonedAdmissionMutex(workspace, held, owner.pid)).toThrow(
      /lease may still be live|unexpected installation control entry|unsafe file/u);
    expect(existsSync(ownerPath)).toBe(true);
    expect(existsSync(join(control, "admission-mutex-recovery"))).toBe(false);
  } finally { held.release(); }
});

it("refuses offline mutex recovery while its recorded owner is live", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  const mutex = join(workspace, ".tracker/control", "admission-mutex");
  mkdirSync(mutex, { mode: 0o700 });
  const current = observeProcessIdentity(process.pid);
  if (current.state !== "alive") throw new Error("current process identity unavailable");
  const owner = { schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: process.pid,
    processIdentity: current.identity };
  const ownerPath = join(mutex, "owner.json");
  writeFileSync(ownerPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  const held = restore(workspace);
  try {
    expect(() => recoverAbandonedAdmissionMutex(workspace, held, process.pid)).toThrow(/may still be live/u);
    expect(existsSync(ownerPath)).toBe(true);
  } finally { held.release(); }
});

it("ignores a dead process lease after a crash outside the mutex", async () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  const moduleUrl = new URL("../../../../src/backend/storage/admission/installation.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { acquireInstallation } from ${JSON.stringify(moduleUrl)}; acquireInstallation(${JSON.stringify(workspace)}, 'shared'); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => data.toString().includes("READY") ? resolve() : reject(new Error(String(data)))); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
    expect(() => acquireInstallation(workspace, "exclusive")).toThrow(/lease busy/u);
  } finally { await stopChild(child); }
  const afterCrash = acquireInstallation(workspace, "exclusive"); afterCrash.release();
});

it("serializes simultaneous shared and exclusive child-process admission", async () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  const gate = join(dirname(workspace), "go");
  const moduleUrl = new URL("../../../../src/backend/storage/admission/installation.ts", import.meta.url).href;
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
