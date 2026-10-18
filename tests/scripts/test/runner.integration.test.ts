import assert from "node:assert/strict";
import { spawn,spawnSync } from "node:child_process";
import { existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,realpathSync,rmSync,statSync,symlinkSync,utimesSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join,resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { describe,it } from "vitest";
import { acquireSuiteLock,hasTestFilter,reapTestRuns,runTestProcess } from "../../../scripts/test/runner.js";


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
async function untilGroupId(path: string): Promise<number> {
  let group = Number.NaN;
  await until(() => {
    if (!existsSync(path)) return false;
    group = Number(readFileSync(path, "utf8"));
    return Number.isSafeInteger(group) && group > 1;
  });
  return group;
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
    const result = spawnSync(process.execPath, ["--import", fileURLToPath(import.meta.resolve("tsx")), fileURLToPath(new URL("../../../scripts/test/runner.ts", import.meta.url)), "run", "--config", join(root, "vitest.config.ts"), "proof.test.ts"], { cwd: root, env: process.env, encoding: "utf8", timeout: 15000 });
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

  it.each(["0", "1"])("makes the empty architecture command fail with FORCE_COLOR=%s", (forceColor) => {
    const result = spawnSync(
      "npm",
      [
        "run", "test:architecture", "--",
        "tests/architecture/fixtures/does-not-exist.test.ts",
      ],
      {
        cwd: REPO_ROOT, encoding: "utf8",
        env: {
          ...process.env, FORCE_COLOR: forceColor, NO_COLOR: forceColor === "0" ? "1" : undefined, TERM: "xterm",
          // Vitest disables colors when std-env detects an agent.
          CODEX_SANDBOX: undefined, CODEX_THREAD_ID: undefined, AI_AGENT: undefined, CURSOR_AGENT: undefined,
        },
      },
    );
    const rawOutput = `${result.stdout}\n${result.stderr}`;
    const output = stripVTControlCharacters(rawOutput);
    assert.equal(result.status, 1, rawOutput);
    assert.equal(rawOutput !== output, forceColor === "1", rawOutput);
    assert.match(output, /No test files found, exiting with code 1/);
    assert.match(output, /projects: architecture/);
    assert.match(output, /filter: tests\/architecture\/fixtures\/does-not-exist\.test\.ts/);
  });
});

function suiteProcess(root: string, script: string, suiteLock: boolean | "borrowed" = true, waitTimeoutMs = 5_000, detached = false, idleTimeoutMs: number | false = 500) {
  const module = fileURLToPath(new URL("../../../scripts/test/runner.ts", import.meta.url));
  const options = {
    command: process.execPath, args: ["-e", script], cwd: root, env: {},
    rootDirectory: join(root, "runs"), suiteLock: suiteLock === "borrowed" ? undefined : suiteLock, suiteLockRetryIntervalMs: 20,
    suiteLockWaitTimeoutMs: waitTimeoutMs, ...(idleTimeoutMs === false ? {} : { idleTimeoutMs }),
  };
  const source = `import {acquireSuiteLock,runTestProcess} from ${JSON.stringify(module)};const options=${JSON.stringify(options)};${suiteLock === "borrowed" ? "options.suiteLock=await acquireSuiteLock({directory:options.rootDirectory});" : ""}try{process.exitCode=(await runTestProcess(options)).code}catch(e){console.error(e.name+': '+e.message);process.exitCode=1}finally{${suiteLock === "borrowed" ? "await options.suiteLock.release();" : ""}}`;
  const child = spawn(process.execPath, ["--import", fileURLToPath(import.meta.resolve("tsx")), "--input-type=module", "-e", source], { detached, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
  const closed = new Promise<number | null>((done) => child.once("close", done));
  return { child, closed, output: () => output };
}

it("classifies whole suites after option values while retaining actual positional filters", () => {
  for (const args of [[], ["--coverage", "--project", "unit", "--project", "integration", "--project", "architecture"], ["--project=perf", "--passWithNoTests=false"], ["--config", "custom.ts"], ["--testTimeout", "60000", "--bail", "1", "--project", "unit"], ["--testTimeout=60000", "--bail=1"], ["--", "proof.test.ts"]]) {
    assert.equal(hasTestFilter(args), false, JSON.stringify(args));
  }
  for (const args of [["run"], ["--project", "unit", "proof.test.ts"], ["--config", "custom.ts", "proof.test.ts"], ["--project=unit", "proof.test.ts"], ["--testTimeout", "60000", "--bail", "1", "--project", "unit", "proof.test.ts"], ["-t", "heading", "proof.test.ts"]]) {
    assert.equal(hasTestFilter(args), true, JSON.stringify(args));
  }
});

it("serializes whole-suite children, lets a focused child pass, and reports only the anonymous wait", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-suite-proof-")));
  const ready = join(root, "ready"), release = join(root, "release"), secondReady = join(root, "second"), focusedReady = join(root, "focused");
  const first = suiteProcess(root, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{console.log('progress');if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},50)`);
  let second: ReturnType<typeof suiteProcess> | undefined;
  try {
    await until(() => existsSync(ready));
    second = suiteProcess(root, `require('node:fs').writeFileSync(${JSON.stringify(secondReady)},'started')`);
    await until(() => second!.output().includes("waiting for another"));
    assert.equal(existsSync(secondReady), false);
    const focused = suiteProcess(root, `require('node:fs').writeFileSync(${JSON.stringify(focusedReady)},'started')`, false);
    assert.equal(await focused.closed, 0);
    assert.equal(existsSync(focusedReady), true);
    await sleep(600);
    const waitLines = second.output().split("\n").filter((line) => line.includes("waiting for another"));
    assert.equal(waitLines.length, 1);
    assert.match(waitLines[0], /^\[test-run\] waiting for another Relay test suite \(since \d{2}:\d{2}\)$/);
    assert.equal(waitLines[0].includes(root), false);
    assert.equal(waitLines[0].includes(String(first.child.pid)), false);
    assert.equal(waitLines[0].includes("test-lock"), false);
    writeFileSync(release, "go");
    assert.equal(await first.closed, 0);
    assert.equal(await second.closed, 0);
    assert.equal(existsSync(secondReady), true);
    assert.deepEqual(readdirSync(join(root, "runs")), ["suite.lock"]);
    assert.deepEqual(reapTestRuns(join(root, "runs")), { removed: [], retained: [] });
    assert.equal(existsSync(join(root, "runs", "suite.lock")), true);
  } finally {
    first.child.kill("SIGTERM"); second?.child.kill("SIGTERM");
    await first.closed; await second?.closed;
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses an expired suite wait with the named error, exit 1, and no child", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-suite-proof-")));
  const lease = await acquireSuiteLock({ directory: join(root, "runs") });
  try {
    const marker = join(root, "forbidden-child");
    const waiter = suiteProcess(root, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`, true, 100);
    assert.equal(await waiter.closed, 1);
    assert.match(waiter.output(), /TestSuiteWaitTimeoutError: Another Relay test suite is still running; this run waited 45 minutes and did not start\./);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(readdirSync(join(root, "runs")), ["suite.lock"]);
  } finally { await lease.release(); rmSync(root, { recursive: true, force: true }); }
});

it("releases the kernel suite lock after the holding runner is killed with SIGKILL", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-suite-proof-")));
  const module = fileURLToPath(new URL("../../../scripts/test/runner.ts", import.meta.url));
  const source = `import {acquireSuiteLock} from ${JSON.stringify(module)};await acquireSuiteLock({directory:${JSON.stringify(join(root, "runs"))}});console.log('ready');setInterval(()=>{},1000)`;
  const holder = spawn(process.execPath, ["--import", fileURLToPath(import.meta.resolve("tsx")), "--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  holder.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  const closed = new Promise<void>((done) => holder.once("close", () => done()));
  let waiter: ReturnType<typeof suiteProcess> | undefined;
  try {
    await until(() => output.includes("ready"));
    const marker = join(root, "waiter-started");
    waiter = suiteProcess(root, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`);
    await until(() => waiter!.output().includes("waiting for another"));
    assert.equal(existsSync(marker), false);
    holder.kill("SIGKILL"); await closed;
    assert.equal(await waiter.closed, 0);
    assert.equal(existsSync(marker), true);
  } finally {
    holder.kill("SIGKILL"); waiter?.child.kill("SIGTERM");
    await closed; await waiter?.closed;
    rmSync(root, { recursive: true, force: true });
  }
});

it("shuts down a whole-suite descendant before releasing the suite lease", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-suite-proof-")));
  const ready = join(root, "ready");
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const leader = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});const check=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(ready)}))process.exit(0)},10)`;
  try {
    const result = await runTestProcess({ command: process.execPath, args: ["-e", leader], cwd: root, env: {}, rootDirectory: join(root, "runs"), suiteLock: true });
    assert.equal(result.code, 1);
    assert.match(result.detail, /child process group remains active/);
    const run = readdirSync(join(root, "runs")).find((name) => name.startsWith("run-"));
    assert.ok(run);
    const owner = JSON.parse(readFileSync(join(root, "runs", run, "owner.json"), "utf8")) as { groupId: number };
    assert.equal(alive(owner.groupId), false);
    assert.equal(existsSync(join(root, "runs", run, "tmp")), false);
    const lease = await acquireSuiteLock({ directory: join(root, "runs"), waitTimeoutMs: 100 });
    await lease.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const ownership of [true, "borrowed"] as const) {
  it(`keeps the ${ownership === true ? "owned" : "borrowed"} suite lease through terminal-group SIGINT until detached tests stop`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-suite-proof-")));
    const ready = join(root, "ready"), marker = join(root, "waiter-started");
    const holder = suiteProcess(root, `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>console.log('progress'),50)`, ownership, 5_000, true);
    let waiter: ReturnType<typeof suiteProcess> | undefined;
    let group: number | undefined;
    try {
      group = await untilGroupId(ready);
      assert.ok(Number.isSafeInteger(group) && group > 1);
      const wrapperGroup = holder.child.pid;
      assert.ok(wrapperGroup !== undefined && wrapperGroup > 1);
      assert.notEqual(wrapperGroup, group);
      waiter = suiteProcess(root, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`);
      await until(() => waiter!.output().includes("waiting for another"));
      assert.equal(existsSync(marker), false);
      process.kill(-wrapperGroup, "SIGINT");
      await sleep(200);
      assert.equal(alive(wrapperGroup), true, "wrapper must be draining its detached group");
      assert.equal(alive(group), true, "test leader must survive TERM until forced cleanup");
      assert.equal(existsSync(marker), false, "waiter started while terminal-interrupted tests still ran");
      assert.equal(await holder.closed, 1);
      assert.equal(alive(group), false, "runner must finish group cleanup before releasing the lease");
      assert.equal(await waiter.closed, 0);
      assert.equal(existsSync(marker), true);
    } finally {
      holder.child.kill("SIGKILL");
      if (group !== undefined && alive(group)) {
        process.kill(-group, "SIGKILL");
        await until(() => !alive(group!));
      }
      waiter?.child.kill("SIGTERM");
      await holder.closed; await waiter?.closed;
      rmSync(root, { recursive: true, force: true });
    }
  });
  it(`keeps the ${ownership === true ? "owned" : "borrowed"} suite lease until the detached child exits after runner SIGKILL`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-suite-proof-")));
    const ready = join(root, "ready"), marker = join(root, "waiter-started");
    const idleTimeoutMs = false;
    const holder = suiteProcess(root, `require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`, ownership, 5_000, false, idleTimeoutMs);
    let waiter: ReturnType<typeof suiteProcess> | undefined;
    let group: number | undefined;
    try {
      group = await untilGroupId(ready);
      assert.ok(Number.isSafeInteger(group) && group > 1);
      waiter = suiteProcess(root, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`);
      await until(() => waiter!.output().includes("waiting for another"));
      holder.child.kill("SIGKILL"); await holder.closed;
      await sleep(200);
      assert.equal(alive(group), true, "detached leader must outlive the runner");
      assert.equal(existsSync(marker), false, "waiter started while the detached leader still held its lease");
      process.kill(-group, "SIGTERM");
      await until(() => !alive(group!));
      assert.equal(await waiter.closed, 0);
      assert.equal(existsSync(marker), true);
    } finally {
      holder.child.kill("SIGKILL");
      if (group !== undefined && alive(group)) {
        process.kill(-group, "SIGKILL");
        await until(() => !alive(group!));
      }
      waiter?.child.kill("SIGTERM");
      await holder.closed; await waiter?.closed;
      rmSync(root, { recursive: true, force: true });
    }
  });
}
