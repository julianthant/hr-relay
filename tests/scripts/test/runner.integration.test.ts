import assert from "node:assert/strict";
import { spawn,spawnSync } from "node:child_process";
import { existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,realpathSync,rmSync,statSync,symlinkSync,utimesSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join,resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe,it } from "vitest";
import { reapTestRuns,runTestProcess } from "../../../scripts/test/runner.js";


it("contains inherited temporary files and removes them after a successful run", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    const output = join(root, "path.txt");
    const runs = join(root, "runs");
    const result = await runTestProcess({
      command: process.execPath,
      args: ["-e", `const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const p=fs.mkdtempSync(path.join(os.tmpdir(),'leaked-'));fs.writeFileSync(${JSON.stringify(output)},p);`],
      cwd: root, env: { ...process.env, TMPDIR: root }, rootDirectory: runs,
    });
    assert.equal(result.code, 0);
    assert.equal(statSync(output).mode & 0o777, 0o600, "child must retain private evidence permissions");
    const allocated = readFileSync(output, "utf8");
    assert.notEqual(dirname(allocated), root, "child still allocates outside its owned run root");
    assert.deepEqual(readdirSync(runs), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("preserves a failing exit and diagnostics until explicit reclamation", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    const result = await runTestProcess({ command: process.execPath, args: ["-e", "require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(),'scratch-payload'),'sentinel');console.error('sentinel-failure');process.exitCode=23"], cwd: root, env: process.env, rootDirectory: join(root, "runs") });
    assert.equal(result.code, 23);
    const run = join(root, "runs", readdirSync(join(root, "runs"))[0]);
    assert.match(readFileSync(join(run, "failure.txt"), "utf8"), /sentinel-failure/);
    assert.equal(existsSync(join(run, "tmp")), false);
    assert.deepEqual(reapTestRuns(join(root, "runs")), { removed: [run], retained: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("fails and retains diagnostics for a silent stalled process", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    const result = await runTestProcess({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: root, env: process.env, rootDirectory: join(root, "runs"), idleTimeoutMs: 200 });
    assert.equal(result.code, 1);
    assert.match(result.detail, /no test output for 200ms/);
    assert.equal(reapTestRuns(join(root, "runs")).removed.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("retains a killed worker's scratch for verified reclamation", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  const ready = join(root, "ready");
  const descendant = `require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`;
  const worker = `const {spawn}=require('node:child_process'),fs=require('node:fs');spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});const check=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(check);process.kill(process.pid,'SIGKILL')}},10)`;
  let group: number | undefined;
  try {
    const result = await runTestProcess({ command: process.execPath, args: ["-e", worker], cwd: root, env: process.env, rootDirectory: join(root, "runs") });
    const run = join(root, "runs", readdirSync(join(root, "runs"))[0]);
    const claimed = (JSON.parse(readFileSync(join(run, "owner.json"), "utf8")) as { groupId: unknown }).groupId;
    assert.ok(typeof claimed === "number" && Number.isSafeInteger(claimed) && claimed > 1);
    group = claimed;
    const ownedGroup = claimed;
    assert.equal(result.code, 1);
    assert.match(result.detail, /SIGKILL/);
    assert.equal(readFileSync(ready, "utf8"), "ready");
    assert.equal(existsSync(join(run, "tmp")), true);
    assert.equal(existsSync(join(run, "failure.txt")), true);
    assert.deepEqual(reapTestRuns(join(root, "runs")), { removed: [], retained: [run] });
    process.kill(-ownedGroup, "SIGKILL");
    await until(() => !alive(ownedGroup));
    assert.equal(reapTestRuns(join(root, "runs")).removed.length, 1);
  } finally {
    const groupToClean = group;
    if (groupToClean !== undefined && alive(groupToClean)) {
      process.kill(-groupToClean, "SIGKILL");
      await until(() => !alive(groupToClean));
    }
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses symlinked run directories and leaves the target intact", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    const runs = join(root, "runs"), target = join(root, "other-run");
    mkdirSync(runs, { mode: 0o700 }); mkdirSync(target, { mode: 0o700 });
    writeFileSync(join(target, "keep"), "active data"); symlinkSync(target, join(runs, "run-abc"));
    assert.throws(() => reapTestRuns(runs), /Unsafe test-run directory/);
    assert.equal(readFileSync(join(target, "keep"), "utf8"), "active data");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

async function until(check: () => boolean): Promise<void> {
  for (let n = 0; n < 1000; n++) { if (check()) return; await sleep(10); }
  throw new Error("Timed out waiting for test-process proof");
}
function alive(group: number): boolean {
  const result = spawnSync("/bin/ps", ["-axo", "pgid="], { encoding: "utf8" });
  assert.equal(result.status, 0);
  return result.stdout.trim().split(/\s+/).includes(String(group));
}

it("finishes forced group shutdown after the leader closes its output", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  const runs = join(root, "runs"), ready = join(root, "ready");
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`;
  const leader = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  let group: number | undefined;
  try {
    const result = await runTestProcess({ command: process.execPath, args: ["-e", leader], cwd: root, env: {}, rootDirectory: runs, idleTimeoutMs: 500 });
    assert.equal(result.code, 1);
    assert.equal(readFileSync(ready, "utf8"), "ready");
    const claimed = (JSON.parse(readFileSync(join(runs, readdirSync(runs)[0], "owner.json"), "utf8")) as { groupId: unknown }).groupId;
    assert.ok(typeof claimed === "number" && Number.isSafeInteger(claimed) && claimed > 1);
    group = claimed;
    await sleep(100);
    assert.equal(alive(group), false, "leader close canceled forced shutdown of its surviving descendant");
    assert.equal(reapTestRuns(runs).removed.length, 1);
  } finally {
    if (group !== undefined && alive(group)) {
      process.kill(-group, "SIGKILL");
      await until(() => !alive(group!));
    }
    rmSync(root, { recursive: true, force: true });
  }
});

it("after parent SIGKILL, preserves the live child group and reclaims only after it dies", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  const runs = join(root, "runs"), ready = join(root, "ready");
  const module = fileURLToPath(new URL("../../../scripts/test/runner.ts", import.meta.url));
  const options = { command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`], cwd: root, env: {}, rootDirectory: runs };
  const parent = spawn(process.execPath, ["--import", fileURLToPath(import.meta.resolve("tsx")), "--input-type=module", "-e", `import {runTestProcess} from ${JSON.stringify(module)}; await runTestProcess(${JSON.stringify(options)});`], { stdio: "ignore" });
  const closed = new Promise<void>((done) => parent.once("close", () => done()));
  let group: number | undefined;
  try {
    await until(() => existsSync(ready));
    const run = join(runs, readdirSync(runs)[0]);
    const claimed = (JSON.parse(readFileSync(join(run, "owner.json"), "utf8")) as { groupId: unknown }).groupId;
    assert.ok(typeof claimed === "number" && Number.isSafeInteger(claimed) && claimed > 1);
    group = claimed;
    parent.kill("SIGKILL"); await closed;
    assert.deepEqual(reapTestRuns(runs), { removed: [], retained: [run] });
    assert.equal(existsSync(join(run, "tmp")), true);
    process.kill(-group, "SIGTERM");
    await until(() => !alive(group!));
    assert.deepEqual(reapTestRuns(runs), { removed: [run], retained: [] });
  } finally {
    parent.kill("SIGKILL");
    if (group !== undefined && alive(group)) process.kill(-group, "SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});

it("executes the actual Vitest CLI with unchanged selection and a failing exit", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-cli-")));
  try {
    symlinkSync(fileURLToPath(new URL("../../../node_modules", import.meta.url)), join(root, "node_modules"));
    writeFileSync(join(root, "vitest.config.ts"), 'export default {test:{include:["proof.test.ts"],maxWorkers:1}};');
    writeFileSync(join(root, "proof.test.ts"), 'import {it} from "vitest";it("real CLI proof",()=>{throw new Error("intentional-cli-red")});');
    const result = spawnSync(process.execPath, ["--import", fileURLToPath(import.meta.resolve("tsx")), fileURLToPath(new URL("../../../scripts/test/runner.ts", import.meta.url)), "run", "--config", join(root, "vitest.config.ts")], { cwd: root, env: process.env, encoding: "utf8", timeout: 15000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /intentional-cli-red/);
    assert.match(result.stdout + result.stderr, /1 failed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("retains malformed ownership and unrelated files instead of guessing they are abandoned", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    const run = join(root, "run-broken"); mkdirSync(run, { mode: 0o700 });
    writeFileSync(join(run, "owner.json"), '{"version":1,"groupId":1}', { mode: 0o600 });
    writeFileSync(join(run, "keep"), "unknown ownership");
    assert.throws(() => reapTestRuns(root));
    assert.equal(readFileSync(join(run, "keep"), "utf8"), "unknown ownership");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("removes old empty owner-less runs, including an empty tmp directory", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    for (const withTmp of [false, true]) {
      const run = join(root, withTmp ? "run-emptytmp" : "run-empty");
      mkdirSync(run, { mode: 0o700 });
      if (withTmp) mkdirSync(join(run, "tmp"), { mode: 0o700 });
      const old = new Date(Date.now() - 11 * 60_000);
      utimesSync(run, old, old);
      assert.deepEqual(reapTestRuns(root), { removed: [run], retained: [] });
      assert.equal(existsSync(run), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("retains fresh owner-less runs during startup", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    const run = join(root, "run-starting"); mkdirSync(run, { mode: 0o700 });
    assert.deepEqual(reapTestRuns(root), { removed: [], retained: [run] });
    assert.equal(existsSync(run), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("retains owner-less runs with other content", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-runner-proof-")));
  try {
    for (const location of ["root", "tmp", "tmpfile"]) {
      const inTmp = location === "tmp";
      const run = join(root, `run-${location}`);
      mkdirSync(run, { mode: 0o700 });
      if (inTmp) mkdirSync(join(run, "tmp"), { mode: 0o700 });
      const content = join(inTmp ? join(run, "tmp") : run, location === "tmpfile" ? "tmp" : "keep");
      writeFileSync(content, "unknown ownership");
      const old = new Date(Date.now() - 11 * 60_000);
      utimesSync(run, old, old);
      assert.deepEqual(reapTestRuns(root), { removed: [], retained: [run] });
      assert.equal(readFileSync(content, "utf8"), "unknown ownership");
      rmSync(run, { recursive: true });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("architecture project empty collection", () => {

  it("makes the public architecture command exit nonzero when its project collects no tests", () => {
    const result = spawnSync(
      "npm",
      [
        "run", "test:architecture", "--",
        "tests/architecture/fixtures/does-not-exist.test.ts",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /No test files found, exiting with code 1/);
    assert.match(output, /projects: architecture/);
    assert.match(output, /filter: tests\/architecture\/fixtures\/does-not-exist\.test\.ts/);
  });
});
