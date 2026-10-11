import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { spawn as spawn_m0,spawnSync as spawnSync_m0,spawnSync as spawnSync_m1 } from "node:child_process";
import { existsSync as existsSync_m0,mkdirSync as mkdirSync_m0,mkdtempSync as mkdtempSync_m0,readdirSync as readdirSync_m0,readFileSync as readFileSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0,statSync as statSync_m0,symlinkSync as symlinkSync_m0,utimesSync as utimesSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { dirname as dirname_m0,join as join_m0,resolve as resolve_m1 } from "node:path";
import { setTimeout as sleep_m0 } from "node:timers/promises";
import { fileURLToPath as fileURLToPath_m0 } from "node:url";
import { describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { reapTestRuns as reapTestRuns_m0,runTestProcess as runTestProcess_m0 } from "../../../scripts/test/runner.js";


{


it_m0("contains inherited temporary files and removes them after a successful run", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    const output = join_m0(root, "path.txt");
    const runs = join_m0(root, "runs");
    const result = await runTestProcess_m0({
      command: process.execPath,
      args: ["-e", `const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const p=fs.mkdtempSync(path.join(os.tmpdir(),'leaked-'));fs.writeFileSync(${JSON.stringify(output)},p);`],
      cwd: root, env: { ...process.env, TMPDIR: root }, rootDirectory: runs,
    });
    assert_m0.equal(result.code, 0);
    assert_m0.equal(statSync_m0(output).mode & 0o777, 0o600, "child must retain private evidence permissions");
    const allocated = readFileSync_m0(output, "utf8");
    assert_m0.notEqual(dirname_m0(allocated), root, "child still allocates outside its owned run root");
    assert_m0.deepEqual(readdirSync_m0(runs), []);
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("preserves a failing exit and diagnostics until explicit reclamation", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    const result = await runTestProcess_m0({ command: process.execPath, args: ["-e", "console.error('sentinel-failure'); process.exit(23)"], cwd: root, env: process.env, rootDirectory: join_m0(root, "runs") });
    assert_m0.equal(result.code, 23);
    const run = join_m0(root, "runs", readdirSync_m0(join_m0(root, "runs"))[0]);
    assert_m0.match(readFileSync_m0(join_m0(run, "failure.txt"), "utf8"), /sentinel-failure/);
    assert_m0.deepEqual(reapTestRuns_m0(join_m0(root, "runs")), { removed: [run], retained: [] });
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("fails and retains diagnostics for a silent stalled process", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    const result = await runTestProcess_m0({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: root, env: process.env, rootDirectory: join_m0(root, "runs"), idleTimeoutMs: 200 });
    assert_m0.equal(result.code, 1);
    assert_m0.match(result.detail, /no test output for 200ms/);
    assert_m0.equal(reapTestRuns_m0(join_m0(root, "runs")).removed.length, 1);
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("retains a killed worker's scratch for verified reclamation", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    const result = await runTestProcess_m0({ command: process.execPath, args: ["-e", "process.kill(process.pid,'SIGKILL')"], cwd: root, env: process.env, rootDirectory: join_m0(root, "runs") });
    assert_m0.equal(result.code, 1);
    assert_m0.match(result.detail, /SIGKILL/);
    assert_m0.equal(reapTestRuns_m0(join_m0(root, "runs")).removed.length, 1);
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("refuses symlinked run directories and leaves the target intact", () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    const runs = join_m0(root, "runs"), target = join_m0(root, "other-run");
    mkdirSync_m0(runs, { mode: 0o700 }); mkdirSync_m0(target, { mode: 0o700 });
    writeFileSync_m0(join_m0(target, "keep"), "active data"); symlinkSync_m0(target, join_m0(runs, "run-abc"));
    assert_m0.throws(() => reapTestRuns_m0(runs), /Unsafe test-run directory/);
    assert_m0.equal(readFileSync_m0(join_m0(target, "keep"), "utf8"), "active data");
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

async function until(check: () => boolean): Promise<void> {
  for (let n = 0; n < 1000; n++) { if (check()) return; await sleep_m0(10); }
  throw new Error("Timed out waiting for test-process proof");
}
function alive(group: number): boolean {
  const result = spawnSync_m0("/bin/ps", ["-axo", "pgid="], { encoding: "utf8" });
  assert_m0.equal(result.status, 0);
  return result.stdout.trim().split(/\s+/).includes(String(group));
}

it_m0("finishes forced group shutdown after the leader closes its output", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  const runs = join_m0(root, "runs"), ready = join_m0(root, "ready");
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`;
  const leader = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  let group: number | undefined;
  try {
    const result = await runTestProcess_m0({ command: process.execPath, args: ["-e", leader], cwd: root, env: {}, rootDirectory: runs, idleTimeoutMs: 500 });
    assert_m0.equal(result.code, 1);
    assert_m0.equal(readFileSync_m0(ready, "utf8"), "ready");
    const claimed = (JSON.parse(readFileSync_m0(join_m0(runs, readdirSync_m0(runs)[0], "owner.json"), "utf8")) as { groupId: unknown }).groupId;
    assert_m0.ok(typeof claimed === "number" && Number.isSafeInteger(claimed) && claimed > 1);
    group = claimed;
    await sleep_m0(100);
    assert_m0.equal(alive(group), false, "leader close canceled forced shutdown of its surviving descendant");
    assert_m0.equal(reapTestRuns_m0(runs).removed.length, 1);
  } finally {
    if (group !== undefined && alive(group)) {
      process.kill(-group, "SIGKILL");
      await until(() => !alive(group!));
    }
    rmSync_m0(root, { recursive: true, force: true });
  }
});

it_m0("after parent SIGKILL, preserves the live child group and reclaims only after it dies", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  const runs = join_m0(root, "runs"), ready = join_m0(root, "ready");
  const module = fileURLToPath_m0(new URL("../../../scripts/test/runner.ts", import.meta.url));
  const options = { command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`], cwd: root, env: {}, rootDirectory: runs };
  const parent = spawn_m0(process.execPath, ["--import", fileURLToPath_m0(import.meta.resolve("tsx")), "--input-type=module", "-e", `import {runTestProcess} from ${JSON.stringify(module)}; await runTestProcess(${JSON.stringify(options)});`], { stdio: "ignore" });
  const closed = new Promise<void>((done) => parent.once("close", () => done()));
  let group: number | undefined;
  try {
    await until(() => existsSync_m0(ready));
    const run = join_m0(runs, readdirSync_m0(runs)[0]);
    const claimed = (JSON.parse(readFileSync_m0(join_m0(run, "owner.json"), "utf8")) as { groupId: unknown }).groupId;
    assert_m0.ok(typeof claimed === "number" && Number.isSafeInteger(claimed) && claimed > 1);
    group = claimed;
    parent.kill("SIGKILL"); await closed;
    assert_m0.deepEqual(reapTestRuns_m0(runs), { removed: [], retained: [run] });
    assert_m0.equal(existsSync_m0(join_m0(run, "tmp")), true);
    process.kill(-group, "SIGTERM");
    await until(() => !alive(group!));
    assert_m0.deepEqual(reapTestRuns_m0(runs), { removed: [run], retained: [] });
  } finally {
    parent.kill("SIGKILL");
    if (group !== undefined && alive(group)) process.kill(-group, "SIGKILL");
    rmSync_m0(root, { recursive: true, force: true });
  }
});

it_m0("executes the actual Vitest CLI with unchanged selection and a failing exit", () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-cli-")));
  try {
    symlinkSync_m0(fileURLToPath_m0(new URL("../../../node_modules", import.meta.url)), join_m0(root, "node_modules"));
    writeFileSync_m0(join_m0(root, "vitest.config.ts"), 'export default {test:{include:["proof.test.ts"],maxWorkers:1}};');
    writeFileSync_m0(join_m0(root, "proof.test.ts"), 'import {it} from "vitest";it("real CLI proof",()=>{throw new Error("intentional-cli-red")});');
    const result = spawnSync_m0(process.execPath, ["--import", fileURLToPath_m0(import.meta.resolve("tsx")), fileURLToPath_m0(new URL("../../../scripts/test/runner.ts", import.meta.url)), "run", "--config", join_m0(root, "vitest.config.ts")], { cwd: root, env: process.env, encoding: "utf8", timeout: 15000 });
    assert_m0.equal(result.error, undefined);
    assert_m0.equal(result.status, 1);
    assert_m0.match(result.stdout + result.stderr, /intentional-cli-red/);
    assert_m0.match(result.stdout + result.stderr, /1 failed/);
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("retains malformed ownership and unrelated files instead of guessing they are abandoned", () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    const run = join_m0(root, "run-broken"); mkdirSync_m0(run, { mode: 0o700 });
    writeFileSync_m0(join_m0(run, "owner.json"), '{"version":1,"groupId":1}', { mode: 0o600 });
    writeFileSync_m0(join_m0(run, "keep"), "unknown ownership");
    assert_m0.throws(() => reapTestRuns_m0(root));
    assert_m0.equal(readFileSync_m0(join_m0(run, "keep"), "utf8"), "unknown ownership");
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("removes old empty owner-less runs, including an empty tmp directory", () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    for (const withTmp of [false, true]) {
      const run = join_m0(root, withTmp ? "run-emptytmp" : "run-empty");
      mkdirSync_m0(run, { mode: 0o700 });
      if (withTmp) mkdirSync_m0(join_m0(run, "tmp"), { mode: 0o700 });
      const old = new Date(Date.now() - 11 * 60_000);
      utimesSync_m0(run, old, old);
      assert_m0.deepEqual(reapTestRuns_m0(root), { removed: [run], retained: [] });
      assert_m0.equal(existsSync_m0(run), false);
    }
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("retains fresh owner-less runs during startup", () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    const run = join_m0(root, "run-starting"); mkdirSync_m0(run, { mode: 0o700 });
    assert_m0.deepEqual(reapTestRuns_m0(root), { removed: [], retained: [run] });
    assert_m0.equal(existsSync_m0(run), true);
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("retains owner-less runs with other content", () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-runner-proof-")));
  try {
    for (const location of ["root", "tmp", "tmpfile"]) {
      const inTmp = location === "tmp";
      const run = join_m0(root, `run-${location}`);
      mkdirSync_m0(run, { mode: 0o700 });
      if (inTmp) mkdirSync_m0(join_m0(run, "tmp"), { mode: 0o700 });
      const content = join_m0(inTmp ? join_m0(run, "tmp") : run, location === "tmpfile" ? "tmp" : "keep");
      writeFileSync_m0(content, "unknown ownership");
      const old = new Date(Date.now() - 11 * 60_000);
      utimesSync_m0(run, old, old);
      assert_m0.deepEqual(reapTestRuns_m0(root), { removed: [], retained: [run] });
      assert_m0.equal(readFileSync_m0(content, "utf8"), "unknown ownership");
      rmSync_m0(run, { recursive: true });
    }
  } finally { rmSync_m0(root, { recursive: true, force: true }); }
});
}

{

const REPO_ROOT = resolve_m1(import.meta.dirname, "../../..");

function runArchitectureProjectWithNoMatchingFile() {
  return spawnSync_m1(
    "npm",
    [
      "run", "test:architecture", "--",
      "tests/architecture/fixtures/does-not-exist.test.ts",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
}

describe_m1("architecture project empty collection", () => {

  it_m1("makes the public architecture command exit nonzero when its project collects no tests", () => {
    const result = runArchitectureProjectWithNoMatchingFile();
    const output = `${result.stdout}\n${result.stderr}`;
    assert_m1.equal(result.status, 1, output);
    assert_m1.match(output, /No test files found, exiting with code 1/);
    assert_m1.match(output, /projects: architecture/);
    assert_m1.match(output, /filter: tests\/architecture\/fixtures\/does-not-exist\.test\.ts/);
  });
});
}
