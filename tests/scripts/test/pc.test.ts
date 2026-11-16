import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPcSource, pcSyncFiles, preparePcSource } from "../../../scripts/test/pc-source.js";
import { runInNewContext } from "node:vm";
import { LINUX_NATIVE_FILES, NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES } from "../../../scripts/test/ci-files.js";
import { measurePcPhase, pcDurationScript, pcListingArgs, pcVitestEnv, readPcTiming, selectPcFiles } from "../../../scripts/test/pc.js";

describe("PC test selection", () => {
  const portable = ["tests/models/a.test.ts", "tests/backend/a.integration.test.ts", "tests/architecture/a.test.ts"];

  it("lists the whole architecture project and changed unit and integration projects by default", () => {
    expect(pcListingArgs([])).toEqual([
      ["--project", "architecture"],
      ["--project", "unit", "--project", "integration", "--changed=origin/staging"],
    ]);
  });

  it("lists all three projects without a changed filter for explicit file requests", () => {
    expect(pcListingArgs([portable[0]])).toEqual([
      ["--project", "unit", "--project", "integration", "--project", "architecture"],
    ]);
  });

  it("keeps affected portable files and removes every native list", () => {
    const all = [...new Set([...NATIVE_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES])];
    const native = all.filter(file => !LINUX_NATIVE_FILES.includes(file));
    expect(selectPcFiles([...portable, ...all], [])).toEqual({ files: [...portable, ...LINUX_NATIVE_FILES].sort(), skipped: native.sort() });
    expect(selectPcFiles([], [])).toEqual({ files: [], skipped: [] });
  });

  it("selects literal paths or quoted globs and reports native requests", () => {
    expect(selectPcFiles(portable, ["tests/backend/**/*.test.ts"]).files).toEqual([portable[1]]);
    expect(selectPcFiles([".\\tests\\models\\a.test.ts"], [portable[0]]).files).toEqual([portable[0]]);
    expect(selectPcFiles(NATIVE_FILES, [NATIVE_FILES[0]]).files).toEqual([]);
    expect(() => selectPcFiles(portable, ["tests/missing.test.ts"])).toThrow(/No unit, integration or architecture file/u);
  });

  it("excludes private inputs, state, dependencies and build output from sync", () => {
    expect(pcSyncFiles(["src/a.ts", ".env", ".env.local", "config/test-data.local.json", ".tracker/x", ".work/evidence", "credentials/x", ".local-private/x", "node_modules/x", "dist/x", ".git/config", ".worktrees/peer/x", "tests/fixtures/a.json"]))
      .toEqual(["src/a.ts", "tests/fixtures/a.json"]);
  });

  it("sets RELAY_TEST_NATIVE for the PC Vitest listing and the remote run", () => {
    expect(pcVitestEnv({ PATH: "keep" })).toEqual({ PATH: "keep", RELAY_TEST_NATIVE: "1" });
    const source = readFileSync(new URL("../../../scripts/test/pc.ts", import.meta.url), "utf8");
    const carries = (marker: string) => {
      const at = source.indexOf(marker);
      const envAt = source.indexOf("pcVitestEnv(process.env)", at);
      expect(at, marker).toBeGreaterThanOrEqual(0);
      expect(envAt - at, marker).toBeGreaterThan(0);
      expect(envAt - at, marker).toBeLessThan(280);
    };
    carries('vitest.mjs", "list"');
    carries('"vitest", "run"');
    expect(source.match(/pcVitestEnv\(process\.env\)/g)).toHaveLength(2);
  });
});

describe("PC phase receipts", () => {
  const runId = "6af4b351-cbb7-4d3e-a782-edb5831d493b";
  const timing = { phase: "test", startedAt: "2026-11-03T00:00:00.000Z", durationMs: 25, outcome: "completed" };
  const line = (value: unknown) => `RELAY_PC_TIMING=${JSON.stringify(value)}`;
  afterEach(() => { vi.useRealTimers(); });

  it("converts shell monotonic nanoseconds to milliseconds", () => {
    let output = "";
    runInNewContext(pcDurationScript, { process: {
      argv: ["node", "1000000000"],
      hrtime: { bigint: () => 1025000000n },
      stdout: { write: (chunk: string) => { output += chunk; } },
    } });
    expect(output).toBe("25");
  });

  it("measures the awaited operation and preserves its result", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout"] });
    vi.setSystemTime(new Date(timing.startedAt));
    const record = vi.fn();
    const result = measurePcPhase("admission", record, async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      return "slot-4";
    });
    expect(record).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toBe("slot-4");
    expect(record).toHaveBeenCalledExactlyOnceWith({ ...timing, phase: "admission" });
  });

  it("records a nonzero command result without changing its exit code", async () => {
    const record = vi.fn<Parameters<typeof measurePcPhase>[1]>();
    await expect(measurePcPhase("test", record, async () => 7)).resolves.toBe(7);
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ phase: "test", outcome: "failed" }));
    expect(record.mock.calls[0]?.[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records a failed phase and rethrows the original error", async () => {
    const error = new Error("source sync failed");
    const record = vi.fn();
    await expect(measurePcPhase("source-sync", record, async () => { throw error; })).rejects.toBe(error);
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ phase: "source-sync", outcome: "failed" }));
  });

  it("reads invocation-bound remote phases without treating ordinary output as telemetry", () => {
    expect(readPcTiming(line({ runId, timing }), runId)).toEqual(timing);
    expect(readPcTiming(line({ runId, timing: { ...timing, phase: "install", outcome: "skipped", durationMs: 0 } }), runId))
      .toEqual({ ...timing, phase: "install", outcome: "skipped", durationMs: 0 });
    expect(readPcTiming(" Test Files 3 passed (3)", runId)).toBeUndefined();
    expect(() => readPcTiming(line({ runId, timing }), "7af4b351-cbb7-4d3e-a782-edb5831d493b")).toThrow("PC timing invocation mismatch");
  });

  it("refuses malformed, unknown or negative remote phase data", () => {
    expect(() => readPcTiming("RELAY_PC_TIMING={", runId)).toThrow();
    for (const change of [{ durationMs: -1 }, { durationMs: "25" }, { phase: "fallback" }, { startedAt: "not-a-date" }, { outcome: "unknown" }]) {
      expect(() => readPcTiming(line({ runId, timing: { ...timing, ...change } }), runId)).toThrow();
    }
  });
});


describe("PC Git source transport", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "relay-pc-source-"));
    roots.push(root);
    const origin = join(root, "origin.git");
    const work = join(root, "mac");
    const run = join(root, "run");
    const slot = join(root, "slot");
    for (const path of [origin, work, run, join(slot, "work/node_modules")]) mkdirSync(path, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
    execFileSync("git", ["init", "--bare", "--quiet", origin]);
    git("init", "--quiet");
    git("config", "user.name", "PC fixture");
    git("config", "user.email", "pc@example.invalid");
    git("config", "core.autocrlf", "false");
    git("remote", "add", "origin", origin);
    for (const [path, bytes] of Object.entries({ "deleted.txt": "delete", "renamed.txt": "rename", "mode.sh": "echo ok\n", "staged.txt": "base", "unstaged.txt": "base", ".gitattributes": "*.txt text eol=crlf\n", ".gitignore": "ignored.txt\n" })) writeFileSync(join(work, path), bytes);
    writeFileSync(join(work, "binary.bin"), Buffer.from([0, 1, 2, 255]));
    git("add", ".");
    git("commit", "--quiet", "-m", "base");
    const base = git("rev-parse", "HEAD");
    git("push", "--quiet", "origin", "HEAD:refs/heads/staging");
    writeFileSync(join(slot, "work/node_modules/retained"), "installed");
    return { origin, work, run, slot, git, base };
  }
  function apply(f: ReturnType<typeof fixture>, source: ReturnType<typeof buildPcSource>) {
    writeFileSync(join(f.slot, "request.json"), JSON.stringify({ source }));
    writeFileSync(join(f.slot, "source.patch"), readFileSync(join(f.run, "source.patch")));
    preparePcSource(f.slot, f.origin);
  }

  it("recreates committed, staged, unstaged, untracked, deleted, renamed, binary and mode changes", () => {
    const f = fixture();
    writeFileSync(join(f.work, "committed.txt"), "unpushed\n");
    f.git("add", "committed.txt");
    f.git("commit", "--quiet", "-m", "unpushed");
    writeFileSync(join(f.work, "staged.txt"), "staged\n");
    f.git("add", "staged.txt");
    writeFileSync(join(f.work, "unstaged.txt"), "unstaged\r\n");
    writeFileSync(join(f.work, "untracked space\tname.txt"), "untracked\n");
    writeFileSync(join(f.work, "ignored.txt"), "ignored private input");
    writeFileSync(join(f.work, ".env.local"), "excluded private input");
    rmSync(join(f.work, "deleted.txt"));
    renameSync(join(f.work, "renamed.txt"), join(f.work, "new-name.txt"));
    writeFileSync(join(f.work, "binary.bin"), Buffer.from([0, 9, 128, 255, 0]));
    chmodSync(join(f.work, "mode.sh"), 0o755);
    symlinkSync("new-name.txt", join(f.work, "safe-link"));
    const indexBefore = f.git("ls-files", "--stage");
    const source = buildPcSource(f.work, f.run, f.base);
    apply(f, source);
    const remote = join(f.slot, "work");
    for (const path of ["committed.txt", "staged.txt", "unstaged.txt", "untracked space\tname.txt", "binary.bin", "new-name.txt"]) expect(readFileSync(join(remote, path))).toEqual(readFileSync(join(f.work, path)));
    for (const path of ["deleted.txt", "renamed.txt", "ignored.txt", ".env.local"]) expect(existsSync(join(remote, path))).toBe(false);
    expect(readFileSync(join(remote, "safe-link"), "utf8")).toBe("rename");
    expect(execFileSync("git", ["ls-files", "--stage"], { cwd: join(f.slot, "source.git"), encoding: "utf8" })).toMatch(/100755 .*\tmode.sh/u);
    expect(readFileSync(join(remote, "node_modules/retained"), "utf8")).toBe("installed");
    expect(f.git("ls-files", "--stage")).toBe(indexBefore);
    expect(source.deltaBytes).toBeGreaterThan(0);
  });

  it("selects the live published staging base and supports an empty delta", () => {
    const f = fixture();
    const source = buildPcSource(f.work, f.run);
    expect(source.baseCommit).toBe(f.base);
    expect(source.deltaBytes).toBe(0);
    apply(f, source);
  });

  it("refuses a base that exists only in the local repository", () => {
    const f = fixture();
    writeFileSync(join(f.work, "local.txt"), "local");
    f.git("add", "local.txt");
    f.git("commit", "--quiet", "-m", "local only");
    expect(() => buildPcSource(f.work, f.run, f.git("rev-parse", "HEAD"))).toThrow("not advertised on origin");
    expect(existsSync(join(f.run, "source.patch"))).toBe(false);
  });

  it.each(["identity", "extra-file", "patch"])("refuses mismatched %s before execution", fault => {
    const f = fixture();
    writeFileSync(join(f.work, "delta.txt"), "delta");
    const source = buildPcSource(f.work, f.run, f.base);
    if (fault === "identity") source.identity = "0".repeat(64);
    if (fault === "extra-file") writeFileSync(join(f.slot, "work/stale.txt"), "stale");
    if (fault === "patch") source.tree = f.base;
    expect(() => apply(f, source)).toThrow("PC source tree identity mismatch");
    expect(existsSync(join(f.slot, "completed"))).toBe(false);
  });

  it.each(["../outside", "/absolute", ".env.local"])("refuses unsafe source symlink %s", target => {
    const f = fixture();
    symlinkSync(target, join(f.work, "unsafe"));
    expect(() => buildPcSource(f.work, f.run, f.base)).toThrow(/Unsafe PC source link|Excluded PC source path/u);
  });
});
