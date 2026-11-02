import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MACOS_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES } from "./ci-files.js";
import { isDirectExecution } from "./scope-files.js";

const projects = ["--project", "unit", "--project", "integration", "--project", "architecture"];
const macosFiles = new Set([...MACOS_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES]);
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export function selectPcFiles(listed: readonly string[], patterns: readonly string[]) {
  const normalized = listed.map(file => file.replaceAll("\\", "/").replace(/^\.\//u, ""));
  for (const pattern of patterns) {
    if (!normalized.some(file => file === pattern || matchesGlob(file, pattern))) {
      throw new Error(`No unit, integration or architecture file matches: ${pattern}`);
    }
  }
  const selected = [...new Set(normalized)].filter(file => patterns.length === 0
    || patterns.some(pattern => file === pattern || matchesGlob(file, pattern))).sort();
  return { files: selected.filter(file => !macosFiles.has(file)), skipped: selected.filter(file => macosFiles.has(file)) };
}

export function pcSyncFiles(files: readonly string[]): string[] {
  return files.filter(file => !file.split("/").some(part =>
    [".git", "node_modules", "dist", ".work", ".worktrees", ".tracker", "credentials", ".local-private"].includes(part)
    || part === ".env" || part.startsWith(".env."))
    && file !== "config/test-data.local.json");
}

async function command(program: string, args: string[], cwd: string, log?: string): Promise<number> {
  const child = spawn(program, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => { process.stdout.write(chunk); if (log) appendFileSync(log, chunk); });
  child.stderr.on("data", (chunk: Buffer) => { process.stderr.write(chunk); if (log) appendFileSync(log, chunk); });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => signal ? reject(new Error(`${program} stopped by ${signal}`)) : resolveExit(code ?? 1));
  });
}

async function checked(program: string, args: string[], cwd: string, log?: string) {
  const code = await command(program, args, cwd, log);
  if (code !== 0) throw new Error(`${program} exited ${code}`);
}

const requestSchema = z.object({ files: z.array(z.string().startsWith("tests/")).min(1), tracked: z.string() });

async function remote(slot: string): Promise<number> {
  const cwd = process.cwd();
  const request = requestSchema.parse(JSON.parse(readFileSync(join(slot, "request.json"), "utf8")));
  const manifest = z.object({ engines: z.object({ node: z.string() }) }).parse(JSON.parse(readFileSync("package.json", "utf8")));
  const required = /^>=(\d+)\.0\.0$/u.exec(manifest.engines.node);
  if (!required || Number(process.versions.node.split(".")[0]) < Number(required[1])) {
    throw new Error(`PC Node ${process.versions.node} does not satisfy ${manifest.engines.node}`);
  }
  const ci = readFileSync(".github/workflows/ci-checks.yml", "utf8");
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
    if (request.files.some(file => file.endsWith(".integration.test.ts"))) await checked("npm", ["run", "web:build"], cwd);
    process.stdout.write(`test:pc slot=${slot} files=${request.files.length} node=${process.versions.node} tmpfs=${temp}\n`);
    return await command("npx", ["--no-install", "vitest", "run", ...projects, "--maxWorkers=2", "--passWithNoTests=false", ...request.files], cwd);
  } finally {
    await checked("rm", ["-rf", "--", temp], cwd);
  }
}

const leaseScript = `set -eu
umask 077
root="$HOME/.cache/relay-test-pc"
mkdir -p "$root"
slots=3
if [ -f "$HOME/.config/relay-test-pc/slots" ]; then slots=$(cat "$HOME/.config/relay-test-pc/slots"); fi
case "$slots" in [1-9]|1[0-6]) ;; *) echo 'Invalid PC slot count (1..16)' >&2; exit 2;; esac
while :; do
  for number in $(seq 1 "$slots"); do
    slot="$root/slot-$number"
    mkdir -p "$slot/work"
    if mkdir "$slot/lease" 2>/dev/null; then
      find "$slot/work" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf -- {} +
      printf 'RELAY_PC_SLOT=%s\\n' "$slot"
      if ! read -r ready; then echo "Interrupted sync: retained lease $slot/lease" >&2; exit 1; fi
      if [ "$ready" = abort ]; then rmdir "$slot/lease"; exit 1; fi
      [ "$ready" = synced ]
      cd "$slot/work"
      hash=$(sha256sum package-lock.json | cut -d' ' -f1)
      if [ ! -f node_modules/.package-lock.json ] || [ ! -f "$slot/lockfile.sha256" ] || [ "$(cat "$slot/lockfile.sha256")" != "$hash" ]; then
        npm ci
        npx --no-install playwright install chromium
        printf '%s' "$hash" > "$slot/lockfile.sha256"
      fi
      set +e
      node --import tsx scripts/test/pc.ts --remote "$slot"
      status=$?
      rmdir "$slot/lease"
      exit "$status"
    fi
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
  const run = join(resolve(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(), ".."), ".work/test-pc", randomUUID());
  mkdirSync(run, { recursive: true, mode: 0o700 });
  const log = join(run, "output.log");
  const started = Date.now();
  const result: { exitCode: number; slot?: string; files?: string[]; error?: string } = { exitCode: 1 };
  process.stdout.write(`test:pc result: ${join(run, "result.json")}\n`);
  try {
    const listing = join(run, "listed.json");
    await checked(process.execPath, ["node_modules/vitest/vitest.mjs", "list", ...projects, "--filesOnly", `--json=${listing}`,
      ...(patterns.length === 0 ? ["--changed=origin/staging"] : [])], root, log);
    const listed = z.array(z.object({ file: z.string() })).parse(JSON.parse(readFileSync(listing, "utf8")))
      .map(({ file }) => relative(root, file).replaceAll("\\", "/"));
    const selected = selectPcFiles(listed, patterns.map(pattern => isAbsolute(pattern) ? relative(root, pattern) : pattern.replace(/^\.\//u, "")));
    result.files = selected.files;
    if (selected.skipped.length) process.stdout.write(`test:pc skipping ${selected.skipped.length} macOS-only file(s); GitHub CI owns them.\n`);
    if (selected.files.length === 0) {
      process.stdout.write("test:pc no portable affected files.\n");
      result.exitCode = 0;
      return 0;
    }
    const files = pcSyncFiles(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(file => file && existsSync(join(root, file))));
    writeFileSync(join(run, "sync-files"), files.join("\0") + "\0");
    writeFileSync(join(run, "request.json"), JSON.stringify({ files: selected.files, tracked: Buffer.from(git(["ls-files", "--stage", "-z"])).toString("base64") }));
    const sshArgs = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
    const child = spawn("ssh", [...sshArgs, host, `bash -c ${quote(leaseScript)}`], { stdio: ["pipe", "pipe", "pipe"] });
    const closed = new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", code => resolveExit(code ?? 1));
    });
    const lines = createInterface({ input: child.stdout });
    const ready = new Promise<string>(resolveSlot => lines.on("line", line => {
      if (line.startsWith("RELAY_PC_SLOT=")) resolveSlot(line.slice("RELAY_PC_SLOT=".length));
    }));
    child.stdout.on("data", (chunk: Buffer) => { process.stdout.write(chunk); appendFileSync(log, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { process.stderr.write(chunk); appendFileSync(log, chunk); });
    try {
      const slot = await Promise.race([ready, closed.then(code => { throw new Error(`SSH exited ${code} before acquiring a slot`); })]);
      if (!/^\/home\/[a-zA-Z0-9_.-]+\/\.cache\/relay-test-pc\/slot-\d+$/u.test(slot)) throw new Error("Unexpected remote slot path");
      result.slot = slot;
      await checked("rsync", ["-rlpt", "--safe-links", "--from0", `--files-from=${join(run, "sync-files")}`, "-e", "ssh " + sshArgs.join(" "), root + "/", `${host}:${slot}/work/`], root, log);
      await checked("rsync", ["-t", "-e", "ssh " + sshArgs.join(" "), join(run, "request.json"), `${host}:${slot}/request.json`], root, log);
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
