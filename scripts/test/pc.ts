import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LINUX_NATIVE_FILES, NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES } from "./ci-files.js";
import { isDirectExecution } from "./scope-files.js";
import { buildPcSource } from "./pc-source.js";
import type { PcSource } from "./pc-source.js";

const projects = ["--project", "unit", "--project", "integration", "--project", "architecture"];
const nativeFiles = new Set([...NATIVE_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES].filter(file => !LINUX_NATIVE_FILES.includes(file)));
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export const pcDurationScript = "process.stdout.write(String(Number(process.hrtime.bigint() - BigInt(process.argv[1])) / 1e6))";

const timingSchema = z.object({
  phase: z.enum(["listing", "source-capture", "admission", "source-sync", "request-sync", "source-prepare", "install", "build", "test", "cleanup", "lease-release"]),
  startedAt: z.iso.datetime(),
  durationMs: z.number().finite().nonnegative(),
  outcome: z.enum(["completed", "failed", "skipped"]),
}).strict();
type PcTiming = z.infer<typeof timingSchema>;

export async function measurePcPhase<T>(phase: PcTiming["phase"], record: (timing: PcTiming) => void, operation: () => Promise<T>): Promise<T> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let outcome: PcTiming["outcome"] = "failed";
  try {
    const value = await operation();
    outcome = typeof value === "number" && value !== 0 ? "failed" : "completed";
    return value;
  } finally {
    record({ phase, startedAt, durationMs: performance.now() - started, outcome });
  }
}

export function readPcTiming(line: string, runId: string): PcTiming | undefined {
  if (!line.startsWith("RELAY_PC_TIMING=")) return undefined;
  const event = z.object({ runId: z.uuid(), timing: timingSchema }).strict().parse(JSON.parse(line.slice("RELAY_PC_TIMING=".length)));
  if (event.runId !== runId) throw new Error("PC timing invocation mismatch");
  return event.timing;
}

export function pcListingArgs(patterns: readonly string[]): string[][] {
  return patterns.length > 0 ? [[...projects]] : [
    ["--project", "architecture"],
    ["--project", "unit", "--project", "integration", "--changed=origin/staging"],
  ];
}

export function selectPcFiles(listed: readonly string[], patterns: readonly string[]) {
  const normalized = listed.map(file => file.replaceAll("\\", "/").replace(/^\.\//u, ""));
  for (const pattern of patterns) {
    if (!normalized.some(file => file === pattern || matchesGlob(file, pattern))) {
      throw new Error(`No unit, integration or architecture file matches: ${pattern}`);
    }
  }
  const selected = [...new Set(normalized)].filter(file => patterns.length === 0
    || patterns.some(pattern => file === pattern || matchesGlob(file, pattern))).sort();
  return { files: selected.filter(file => !nativeFiles.has(file)), skipped: selected.filter(file => nativeFiles.has(file)) };
}

export function pcVitestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, RELAY_TEST_NATIVE: "1" };
}

async function command(program: string, args: string[], cwd: string, log?: string, input?: Buffer, env?: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(program, args, { cwd, stdio: ["pipe", "pipe", "pipe"], ...(env ? { env } : {}) });
  child.stdout.on("data", (chunk: Buffer) => { process.stdout.write(chunk); if (log) appendFileSync(log, chunk); });
  child.stderr.on("data", (chunk: Buffer) => { process.stderr.write(chunk); if (log) appendFileSync(log, chunk); });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.stdin.once("error", reject);
    child.stdin.end(input);
    child.once("close", (code, signal) => signal ? reject(new Error(`${program} stopped by ${signal}`)) : resolveExit(code ?? 1));
  });
}

async function checked(program: string, args: string[], cwd: string, log?: string, input?: Buffer, env?: NodeJS.ProcessEnv) {
  const code = await command(program, args, cwd, log, input, env);
  if (code !== 0) throw new Error(`${program} exited ${code}`);
}

const requestSchema = z.object({
  runId: z.uuid(),
  files: z.array(z.string().startsWith("tests/")).min(1),
  tracked: z.string(),
  source: z.object({
    baseCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    tree: z.string().regex(/^[a-f0-9]{40}$/u),
    identity: z.string().regex(/^[a-f0-9]{64}$/u),
    deltaBytes: z.number().int().nonnegative(),
  }).strict(),
}).strict();

async function remote(slot: string): Promise<number> {
  const cwd = process.cwd();
  const request = requestSchema.parse(JSON.parse(readFileSync(join(slot, "request.json"), "utf8")));
  const record = (timing: PcTiming) => process.stdout.write(`RELAY_PC_TIMING=${JSON.stringify({ runId: request.runId, timing })}\n`);
  const manifest = z.object({ engines: z.object({ node: z.string() }) }).parse(JSON.parse(readFileSync("package.json", "utf8")));
  const required = /^>=(\d+)\.0\.0$/u.exec(manifest.engines.node);
  if (!required || Number(process.versions.node.split(".")[0]) < Number(required[1])) {
    throw new Error(`PC Node ${process.versions.node} does not satisfy ${manifest.engines.node}`);
  }
  const ci = readFileSync(".github/workflows/checks.yml", "utf8");
  for (const key of ["RELAY_TEST_RAM_MB", "RELAY_TEST_TIME_SCALE"]) {
    const value = new RegExp(`^  ${key}: "([0-9.]+)"$`, "mu").exec(ci)?.[1];
    if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error(`Missing CI test environment: ${key}`);
    process.env[key] = value;
  }
  const temp = execFileSync("mktemp", ["-d", "/dev/shm/relay-tmp.XXXXXXXX"], { encoding: "utf8" }).trim();
  process.env.TMPDIR = temp;
  process.env.TEMP = temp;
  process.env.TMP = temp;
  try {
    await checked("git", ["init", "--quiet"], cwd);
    execFileSync("git", ["update-index", "--info-only", "-z", "--index-info"], { input: Buffer.from(request.tracked, "base64") });
    if (request.files.some(file => file.endsWith(".integration.test.ts"))) {
      await measurePcPhase("build", record, () => checked("npm", ["run", "web:build"], cwd));
    } else record({ phase: "build", startedAt: new Date().toISOString(), durationMs: 0, outcome: "skipped" });
    process.stdout.write(`test:pc slot=${slot} files=${request.files.length} node=${process.versions.node} tmpfs=${temp}\n`);
    return await measurePcPhase("test", record, () => command("npx", ["--no-install", "vitest", "run", ...projects, "--maxWorkers=2", "--passWithNoTests=false", ...request.files], cwd, undefined, undefined, pcVitestEnv(process.env)));
  } finally {
    await measurePcPhase("cleanup", record, () => checked("rm", ["-rf", "--", temp], cwd));
    writeFileSync(join(slot, "completed"), "done\n");
  }
}

const leaseScript = `set -eu
umask 077
run_id="$1"
phase_start() {
  phase_clock=$(node -e 'process.stdout.write(process.hrtime.bigint().toString() + " " + new Date().toISOString())')
  read -r phase_ns phase_at <<< "$phase_clock"
}
phase_end() {
  duration=$(node -e ${quote(pcDurationScript)} "$phase_ns")
  printf 'RELAY_PC_TIMING={"runId":"%s","timing":{"phase":"%s","startedAt":"%s","durationMs":%s,"outcome":"%s"}}\\n' "$run_id" "$1" "$phase_at" "$duration" "$2"
}
root="$HOME/.cache/relay-test-pc"
mkdir -p "$root"
slots=3
if [ -f "$HOME/.config/relay-test-pc/slots" ]; then slots=$(cat "$HOME/.config/relay-test-pc/slots"); fi
case "$slots" in [1-9]|1[0-6]) ;; *) echo 'Invalid PC slot count (1..16)' >&2; exit 2;; esac
while :; do
  for number in $(seq 1 "$slots"); do
    slot="$root/slot-$number"
    mkdir -p "$slot/work"
    exec 9>"$slot/lock"
    if flock -n 9 && mkdir "$slot/lease" 2>/dev/null; then
      rm -f "$slot/completed"
      find "$slot/work" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf -- {} +
      printf 'RELAY_PC_SLOT=%s\\n' "$slot"
      if ! read -r ready; then echo "Interrupted sync: retained lease $slot/lease" >&2; exit 1; fi
      if [ "$ready" = abort ]; then rmdir "$slot/lease"; exit 1; fi
      [ "$ready" = synced ]
      phase_start
      set +e
      (cd "$slot" && node --input-type=module -e 'import { preparePcSource } from "./pc-source.ts"; preparePcSource(process.argv[1])' "$slot")
      source_status=$?
      set -e
      if [ "$source_status" -ne 0 ]; then phase_end source-prepare failed; rmdir "$slot/lease"; exit "$source_status"; fi
      phase_end source-prepare completed
      cd "$slot/work"
      hash=$(sha256sum package-lock.json | cut -d' ' -f1)
      phase_start
      if [ ! -f node_modules/.package-lock.json ] || [ ! -f "$slot/lockfile.sha256" ] || [ "$(cat "$slot/lockfile.sha256")" != "$hash" ]; then
        set +e
        npm ci && npx --no-install playwright install chromium
        install_status=$?
        set -e
        if [ "$install_status" -ne 0 ]; then phase_end install failed; exit "$install_status"; fi
        printf '%s' "$hash" > "$slot/lockfile.sha256"
        phase_end install completed
      else
        phase_end install skipped
      fi
      set +e
      node --import tsx scripts/test/pc.ts --remote "$slot"
      status=$?
      phase_start
      if [ ! -f "$slot/completed" ]; then phase_end lease-release failed; echo "Interrupted run: retained lease $slot/lease" >&2; exit 1; fi
      if ! rmdir "$slot/lease"; then phase_end lease-release failed; exit 1; fi
      phase_end lease-release completed
      exit "$status"
    fi
    exec 9>&-
  done
  sleep 1
done`;

async function mac(patterns: string[]): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const host = process.env.RELAY_TEST_HOST;
  if (!host || !/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(host)) {
    throw new Error("Set RELAY_TEST_HOST to your tailnet SSH host (optionally user@host).");
  }
  const runId = randomUUID();
  const run = join(resolve(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(), ".."), ".work/test-pc", runId);
  mkdirSync(run, { recursive: true, mode: 0o700 });
  const log = join(run, "output.log");
  const started = Date.now();
  const result: { exitCode: number; slot?: string; files?: string[]; error?: string; runId: string; timings: PcTiming[]; timingErrors: string[]; source?: PcSource } = { exitCode: 1, runId, timings: [], timingErrors: [] };
  const record = (timing: PcTiming) => { result.timings.push(timing); };
  process.stdout.write(`test:pc result: ${join(run, "result.json")}\n`);
  try {
    const listed = await measurePcPhase("listing", record, async () => {
      const files: string[] = [];
      for (const [index, args] of pcListingArgs(patterns).entries()) {
        const listing = join(run, `listed-${index}.json`);
        await checked(process.execPath, ["node_modules/vitest/vitest.mjs", "list", ...args, "--filesOnly", `--json=${listing}`], root, log, undefined, pcVitestEnv(process.env));
        files.push(...z.array(z.object({ file: z.string() })).parse(JSON.parse(readFileSync(listing, "utf8")))
          .map(({ file }) => relative(root, file).replaceAll("\\", "/")));
      }
      return files;
    });
    const selected = selectPcFiles(listed, patterns.map(pattern => isAbsolute(pattern) ? relative(root, pattern) : pattern.replace(/^\.\//u, "")));
    result.files = selected.files;
    if (selected.skipped.length) process.stdout.write(`test:pc skipping ${selected.skipped.length} native file(s); GitHub CI owns them.\n`);
    if (selected.files.length === 0) {
      process.stdout.write("test:pc no portable affected files.\n");
      result.exitCode = 0;
      return 0;
    }
    result.source = await measurePcPhase("source-capture", record, async () => buildPcSource(root, run));
    writeFileSync(join(run, "request.json"), JSON.stringify({ runId, files: selected.files, source: result.source, tracked: Buffer.from(git(["ls-files", "--stage", "-z"])).toString("base64") }));
    const sshArgs = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
    const child = spawn("ssh", [...sshArgs, host, `bash -c ${quote(leaseScript)} -- ${quote(runId)}`], { stdio: ["pipe", "pipe", "pipe"] });
    const closed = new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", code => resolveExit(code ?? 1));
    });
    const lines = createInterface({ input: child.stdout });
    const ready = new Promise<string>(resolveSlot => lines.on("line", line => {
      if (line.startsWith("RELAY_PC_SLOT=")) resolveSlot(line.slice("RELAY_PC_SLOT=".length));
      try {
        const timing = readPcTiming(line, runId);
        if (timing) record(timing);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.timingErrors.push(message);
        process.stderr.write(`test:pc telemetry: ${message}\n`);
      }
    }));
    child.stdout.on("data", (chunk: Buffer) => { process.stdout.write(chunk); appendFileSync(log, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { process.stderr.write(chunk); appendFileSync(log, chunk); });
    try {
      const slot = await measurePcPhase("admission", record, () => Promise.race([ready, closed.then(code => { throw new Error(`SSH exited ${code} before acquiring a slot`); })]));
      if (!/^\/home\/[a-zA-Z0-9_.-]+\/\.cache\/relay-test-pc\/slot-\d+$/u.test(slot)) throw new Error("Unexpected remote slot path");
      result.slot = slot;
      await measurePcPhase("source-sync", record, () => checked("ssh", [...sshArgs, host, `cat > ${quote(join(slot, "source.patch"))}`], root, log, readFileSync(join(run, "source.patch"))));
      const envelope = Buffer.from(JSON.stringify({ request: readFileSync(join(run, "request.json"), "utf8"), bootstrap: readFileSync(join(root, "scripts/test/pc-source.ts"), "utf8") }));
      const receive = 'const fs = require("node:fs"); const input = JSON.parse(fs.readFileSync(0, "utf8")); fs.writeFileSync(process.argv[1] + "/request.json", input.request); fs.writeFileSync(process.argv[1] + "/pc-source.ts", input.bootstrap);';
      await measurePcPhase("request-sync", record, () => checked("ssh", [...sshArgs, host, `node -e ${quote(receive)} ${quote(slot)}`], root, log, envelope));
      child.stdin.end("synced\n");
      result.exitCode = await closed;
      return result.exitCode;
    } finally {
      lines.close();
      if (!child.stdin.writableEnded) child.stdin.end("abort\n");
      await closed;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    writeFileSync(join(run, "result.json"), JSON.stringify({ ...result, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, log }, null, 2) + "\n");
  }
}

if (isDirectExecution(import.meta.url)) {
  try {
    process.exitCode = process.argv[2] === "--remote"
      ? await remote(z.string().parse(process.argv[3])) : await mac(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`test:pc: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
