import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { runtimeHelp, startRebuildRuntime } from "../../src/core/runtime-composition.js";

describe("isolated rebuild runtime composition after the Phase-1 exit", () => {
  it("binds the exact rebuild-only resources", () => {
    assert.deepEqual(rebuildRuntimeIsolation, {
      stateRoot: ".tracker-rebuild",
      artifactRoot: ".tracker-rebuild/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      processLockRoot: ".tracker-rebuild/locks",
      browserProfileRoot: ".auth",
      browserSessionNamespace: "hrauto-rebuild",
    });
    assert.match(runtimeHelp(rebuildRuntimeIsolation), /1g-spine/);
    // The transaction proof (D135) and tail 2g (D134–D145) completed
    // 2026-08-04; the marker advanced with the first 2h-A slice (D160) and
    // again at 2j, which CLOSED Phase 2 (D181–D189). `active` names the PHASE,
    // not a workflow: doc 03c §Recommended migration order orders the migrations but the operator picks
    // which one starts, so a workflow id here would be the runtime asserting a
    // decision it does not own.
    assert.match(
      runtimeHelp(rebuildRuntimeIsolation),
      /complete through 2j; active 3-workflow-migration/,
    );
  });

  it("executes only the currently owned CLI surface and fails loud for future runtime work", () => {
    const output: string[] = [];
    startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["phase"], write: (value) => output.push(value) });
    assert.deepEqual(JSON.parse(output[0] ?? ""), {
      completedThrough: "2j",
      active: "3-workflow-migration",
      stateRoot: ".tracker-rebuild",
      artifactRoot: ".tracker-rebuild/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      browserSessionNamespace: "hrauto-rebuild",
    });
    startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["--help"], write: (value) => output.push(value) });
    assert.match(output[1] ?? "", /Commands/);
    assert.throws(
      () => startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined }),
      /needs its composition seam/,
    );
    assert.throws(
      () => startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["unknown"], write: () => undefined }),
      /unknown rebuild command/,
    );
  });

  it("routes `explain` through its injected seam and refuses without one", () => {
    const output: string[] = [];
    const seen: string[][] = [];
    startRebuildRuntime({
      isolation: rebuildRuntimeIsolation,
      args: ["explain", "run", "pl-000619-4ebf", "--json"],
      write: (value) => output.push(value),
      explain: (isolation, args) => {
        assert.equal(isolation.stateRoot, ".tracker-rebuild");
        seen.push([...args]);
        return "the explanation";
      },
    });
    assert.deepEqual(seen, [["run", "pl-000619-4ebf", "--json"]]);
    assert.deepEqual(output, ["the explanation"]);
    assert.throws(
      () => startRebuildRuntime({
        isolation: rebuildRuntimeIsolation,
        args: ["explain", "run", "pl-000619-4ebf"],
        write: () => undefined,
      }),
      /needs its composition seam/,
    );
  });

  it("routes `storage doctor` through its injected seam and refuses without one", async () => {
    const output: string[] = [];
    const seen: string[][] = [];
    startRebuildRuntime({
      isolation: rebuildRuntimeIsolation,
      args: ["storage", "doctor", "--json"],
      write: (value) => output.push(value),
      storage: (isolation, args) => {
        assert.equal(isolation.stateRoot, ".tracker-rebuild");
        seen.push([...args]);
        return Promise.resolve({ output: "the doctor report", exitCode: 0 });
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [["doctor", "--json"]]);
    assert.deepEqual(output, ["the doctor report"]);
    assert.throws(
      () => startRebuildRuntime({
        isolation: rebuildRuntimeIsolation,
        args: ["storage", "doctor"],
        write: () => undefined,
      }),
      /needs its composition seam/,
    );
  });

  it("starts the dashboard through the injected 1g-spine composition seam", async () => {
    const output: string[] = [];
    const seen: number[] = [];
    let resolveStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    startRebuildRuntime({
      isolation: rebuildRuntimeIsolation,
      args: ["dashboard"],
      write: (value) => {
        output.push(value);
        resolveStarted();
      },
      dashboard: (isolation) => {
        seen.push(isolation.backendPort);
        return Promise.resolve({ port: isolation.backendPort, stop: () => Promise.resolve() });
      },
    });
    await started;
    assert.deepEqual(seen, [3938]);
    assert.match(output[0] ?? "", /127\.0\.0\.1:3938/);
  });

  it("falls back to the real process argv and stdout writer the entrypoint relies on", () => {
    // `src/cli.ts` calls `startRebuildRuntime` with neither `args` nor
    // `write`, so both defaults ARE the production path — they must be
    // exercised here or the only executed CLI surface would be the injected one.
    const written: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalArgv = process.argv;
    process.stdout.write = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    process.argv = [originalArgv[0] ?? "node", "src/cli.ts", "phase"];
    try {
      startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
    } finally {
      process.stdout.write = originalWrite;
      process.argv = originalArgv;
    }
    assert.equal(written.length, 1);
    assert.equal(written[0]?.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(written[0] ?? ""), {
      completedThrough: "2j",
      active: "3-workflow-migration",
      stateRoot: ".tracker-rebuild",
      artifactRoot: ".tracker-rebuild/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      browserSessionNamespace: "hrauto-rebuild",
    });
  });

  it("defaults an empty argv to the help contract surface", () => {
    const output: string[] = [];
    startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: [], write: (value) => output.push(value) });
    assert.equal(output[0], runtimeHelp(rebuildRuntimeIsolation));
  });
});
