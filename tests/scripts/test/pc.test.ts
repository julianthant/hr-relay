import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { MACOS_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES } from "../../../scripts/test/ci-files.js";
import { measurePcPhase, pcDurationScript, pcSyncFiles, readPcTiming, selectPcFiles } from "../../../scripts/test/pc.js";

describe("PC test selection", () => {
  const portable = ["tests/models/a.test.ts", "tests/backend/a.integration.test.ts", "tests/architecture/a.test.ts"];

  it("keeps affected portable files and removes every macOS list", () => {
    const native = [...new Set([...MACOS_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES])];
    expect(selectPcFiles([...portable, ...native], [])).toEqual({ files: [...portable].sort(), skipped: native.sort() });
    expect(selectPcFiles([], [])).toEqual({ files: [], skipped: [] });
  });

  it("selects literal paths or quoted globs and reports macOS-only requests", () => {
    expect(selectPcFiles(portable, ["tests/backend/**/*.test.ts"]).files).toEqual([portable[1]]);
    expect(selectPcFiles([".\\tests\\models\\a.test.ts"], [portable[0]]).files).toEqual([portable[0]]);
    expect(selectPcFiles(MACOS_FILES, [MACOS_FILES[0]]).files).toEqual([]);
    expect(() => selectPcFiles(portable, ["tests/missing.test.ts"])).toThrow(/No unit, integration or architecture file/u);
  });

  it("excludes private inputs, state, dependencies and build output from sync", () => {
    expect(pcSyncFiles(["src/a.ts", ".env", ".env.local", "config/test-data.local.json", ".tracker/x", ".work/evidence", "credentials/x", ".local-private/x", "node_modules/x", "dist/x", ".git/config", ".worktrees/peer/x", "tests/fixtures/a.json"]))
      .toEqual(["src/a.ts", "tests/fixtures/a.json"]);
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
