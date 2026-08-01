import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { runtimeHelp, startRebuildRuntime } from "../../src/core/runtime-composition.js";

describe("isolated rebuild runtime composition after Phase 1c", () => {
  it("binds the exact rebuild-only resources", () => {
    assert.deepEqual(rebuildRuntimeIsolation, {
      stateRoot: ".tracker-rebuild",
      artifactRoot: ".tracker-rebuild/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      processLockRoot: ".tracker-rebuild/locks",
      browserProfileRoot: ".auth-rebuild",
      browserSessionNamespace: "hrauto-rebuild",
    });
    assert.match(runtimeHelp(rebuildRuntimeIsolation), /1g-spine/);
    assert.match(runtimeHelp(rebuildRuntimeIsolation), /completed through 1e; active 1f/);
  });

  it("executes only the currently owned CLI surface and fails loud for future runtime work", () => {
    const output: string[] = [];
    startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["phase"], write: (value) => output.push(value) });
    assert.deepEqual(JSON.parse(output[0] ?? ""), {
      completedThrough: "1e",
      active: "1f",
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
      /unavailable until.*1g-spine/,
    );
    assert.throws(
      () => startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["unknown"], write: () => undefined }),
      /unknown rebuild command/,
    );
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
      completedThrough: "1e",
      active: "1f",
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
