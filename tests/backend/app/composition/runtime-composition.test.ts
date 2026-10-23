import { default as assert } from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { runtimeHelp, startRebuildRuntime as startRebuildRuntime_m0 } from "../../../../src/backend/app/composition/runtime-composition.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { type WorkerLoopReport } from "../../../../src/backend/runtime/workers/worker-loop.js";

{

describe("dashboard readiness publication", () => {
  it("publishes only after composition and shutdown subscription, so immediate frontend failure drains", async () => {
    const events: string[] = [];
    let shutdown: (() => void) | undefined;
    await startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
      dashboard: async () => { events.push("listening"); return { port: 3938, stop: async () => { events.push("stopped"); } }; },
      signals: { subscribe: handler => {
        events.push("subscribed"); shutdown = () => handler("SIGTERM");
        return () => { events.push("disposed"); };
      } },
      dashboardReady: () => { events.push("ready"); assert.ok(shutdown); shutdown(); },
    });
    assert.deepEqual(events, ["listening", "subscribed", "ready", "stopped", "disposed"]);
  });

  it("never announces readiness after failed composition", async () => {
    let published = false;
    await assert.rejects(startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: ["dashboard"],
      dashboard: async () => { throw new Error("bind refused"); },
      dashboardReady: () => { published = true; },
    }), /bind refused/u);
    assert.equal(published, false);
  });

  it("drains and disposes listeners when readiness publication throws", async () => {
    let stopped = false; let disposed = false;
    await assert.rejects(startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
      dashboard: async () => ({ port: 3938, stop: async () => { stopped = true; } }),
      signals: { subscribe: () => () => { disposed = true; } },
      dashboardReady: () => { throw new Error("IPC refused"); },
    }), /IPC refused/u);
    assert.equal(stopped, true); assert.equal(disposed, true);
  });
});
}

{

/** Let every queued microtask and immediate callback run before observing state. */
async function settleEventLoop(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

interface SignalSeamFake {
  readonly seam: {
    subscribe(handler: (signal: "SIGINT" | "SIGTERM") => void): () => void;
  };
  emit(signal: "SIGINT" | "SIGTERM"): void;
  readonly counts: { subscriptions: number; disposals: number };
}

function signalSeamFake(): SignalSeamFake {
  const handlers: ((signal: "SIGINT" | "SIGTERM") => void)[] = [];
  const counts = { subscriptions: 0, disposals: 0 };
  return {
    seam: {
      subscribe(handler): () => void {
        counts.subscriptions += 1;
        handlers.push(handler);
        return (): void => {
          counts.disposals += 1;
        };
      },
    },
    emit(signal): void {
      for (const handler of handlers) handler(signal);
    },
    counts,
  };
}

// Use an injected signal seam when observing real-process listener counts.
function assertNoProcessSignalListeners(): void {
  assert.equal(
    process.listenerCount("SIGINT"),
    0,
    "this test observes the dashboard's own SIGINT registration; the test process must hold none of its own",
  );
  assert.equal(
    process.listenerCount("SIGTERM"),
    0,
    "this test observes the dashboard's own SIGTERM registration; the test process must hold none of its own",
  );
}

describe("isolated runtime composition", () => {
  it("binds the exact rebuild-only resources", () => {
    assert.deepEqual(rebuildRuntimeIsolation, {
      stateRoot: ".tracker/data",
      artifactRoot: ".tracker/data/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      processLockRoot: ".tracker/data/locks",
      browserProfileRoot: ".tracker/data/browsers",
      browserSessionNamespace: "hrauto-rebuild",
    });
    assert.match(runtimeHelp(rebuildRuntimeIsolation), /1g-spine/);

    assert.match(
      runtimeHelp(rebuildRuntimeIsolation),
      /complete through 2j; active 3-workflow-migration/,
    );
  });

  it("executes only the currently owned CLI surface and fails loud for future runtime work", async () => {
    const output: string[] = [];
    await startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: ["phase"], write: (value) => output.push(value) });
    assert.deepEqual(JSON.parse(output[0] ?? ""), {
      completedThrough: "2j",
      active: "3-workflow-migration",
      stateRoot: ".tracker/data",
      artifactRoot: ".tracker/data/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      browserSessionNamespace: "hrauto-rebuild",
    });
    await startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: ["--help"], write: (value) => output.push(value) });
    assert.match(output[1] ?? "", /Commands/);
    await assert.rejects(
      startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined }),
      /needs its composition seam/,
    );
    await assert.rejects(
      startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: ["unknown"], write: () => undefined }),
      /unknown rebuild command/,
    );
  });

  it("routes `explain` through its injected seam and refuses without one", async () => {
    const output: string[] = [];
    const seen: string[][] = [];
    await startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation,
      args: ["explain", "run", "pl-000619-4ebf", "--json"],
      write: (value) => output.push(value),
      explain: (isolation, args) => {
        assert.equal(isolation.stateRoot, ".tracker/data");
        seen.push([...args]);
        return "the explanation";
      },
    });
    assert.deepEqual(seen, [["run", "pl-000619-4ebf", "--json"]]);
    assert.deepEqual(output, ["the explanation"]);
    await assert.rejects(
      startRebuildRuntime_m0({
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
    await startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation,
      args: ["storage", "doctor", "--json"],
      write: (value) => output.push(value),
      storage: (isolation, args) => {
        assert.equal(isolation.stateRoot, ".tracker/data");
        seen.push([...args]);
        return Promise.resolve({ output: "the doctor report", exitCode: 0 });
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [["doctor", "--json"]]);
    assert.deepEqual(output, ["the doctor report"]);
    await assert.rejects(
      startRebuildRuntime_m0({
        isolation: rebuildRuntimeIsolation,
        args: ["storage", "doctor"],
        write: () => undefined,
      }),
      /needs its composition seam/,
    );
  });

  for (const command of ["storage", "test-data"] as const) {
    it(`awaits ${command} output, forwards exact isolation and arguments, and propagates exit status`, async () => {
      const previousExitCode = process.exitCode;
      const output: string[] = [];
      const args = ["check", "--json"];
      try {
        for (const exitCode of [0, 2] as const) {
          process.exitCode = 7;
          let finish: ((outcome: { output: string; exitCode: 0 | 2 }) => void) | undefined;
          const outcome = new Promise<{ output: string; exitCode: 0 | 2 }>(resolve => { finish = resolve; });
          let settled = false;
          const before = output.length;
          const running = startRebuildRuntime_m0({
            isolation: rebuildRuntimeIsolation, args: [command, ...args], write: value => output.push(value),
            [command === "storage" ? "storage" : "testData"]: (isolation: typeof rebuildRuntimeIsolation, rest: readonly string[]) => {
              assert.equal(isolation, rebuildRuntimeIsolation);
              assert.deepEqual(rest, args);
              return outcome;
            },
          }).then(() => { settled = true; });
          await settleEventLoop();
          assert.equal(settled, false);
          assert.equal(output.length, before);
          assert.equal(process.exitCode, 7);
          assert.ok(finish);
          finish({ output: `${command}:${exitCode}`, exitCode });
          await running;
          assert.equal(settled, true);
          assert.equal(output.at(-1), `${command}:${exitCode}`);
          assert.equal(process.exitCode, exitCode === 0 ? 7 : exitCode);
        }
        const failure = new Error(`${command} refused authority`);
        const before = [...output];
        await assert.rejects(startRebuildRuntime_m0({
          isolation: rebuildRuntimeIsolation, args: [command, ...args], write: value => output.push(value),
          [command === "storage" ? "storage" : "testData"]: () => Promise.reject(failure),
        }), error => error === failure);
        assert.deepEqual(output, before);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  }

  it("forwards OCR arguments and preserves successful and refused command exit status", async () => {
    const previousExitCode = process.exitCode;
    const output: string[] = [];
    try {
      for (const exitCode of [0, 1]) {
        process.exitCode = 7;
        await startRebuildRuntime_m0({
          isolation: rebuildRuntimeIsolation, args: ["ocr", "admit", "submission.json"],
          write: value => output.push(value),
          ocr: args => {
            assert.deepEqual(args, ["admit", "submission.json"]);
            return { output: `ocr:${exitCode}`, exitCode };
          },
        });
        assert.equal(output.at(-1), `ocr:${exitCode}`);
        assert.equal(process.exitCode, exitCode === 0 ? 7 : exitCode);
      }
      const failure = new Error("OCR admission refused");
      await assert.rejects(startRebuildRuntime_m0({
        isolation: rebuildRuntimeIsolation, args: ["ocr", "admit", "submission.json"],
        write: value => output.push(value), ocr: () => { throw failure; },
      }), error => error === failure);
      assert.deepEqual(output, ["ocr:0", "ocr:1"]);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("awaits the worker report, publishes only outcome states, and propagates failure without output", async () => {
    const output: string[] = [];
    const report = {
      workerId: "worker-1", workflowId: "separations", stopped: "stop-directive", closure: "proved",
      outcomes: [{ state: "done", runId: "run-1" }, { state: "failed", runId: "run-2", failureId: "failure-2" }],
    } satisfies WorkerLoopReport;
    let finish: ((report: WorkerLoopReport) => void) | undefined;
    const result = new Promise<WorkerLoopReport>(resolve => { finish = resolve; });
    const running = startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation, args: ["worker", "separations", "--pool-index", "2", "--drain"],
      write: value => output.push(value), worker: (isolation, args) => {
        assert.equal(isolation, rebuildRuntimeIsolation);
        assert.deepEqual(args, ["separations", "--pool-index", "2", "--drain"]);
        return result;
      },
    });
    await settleEventLoop();
    assert.equal(output.length, 0);
    assert.ok(finish);
    finish(report);
    await running;
    assert.equal(output.length, 1);
    assert.deepEqual(JSON.parse(output[0] ?? ""), {
      workerId: "worker-1", workflowId: "separations", stopped: "stop-directive", closure: "proved", outcomes: ["done", "failed"],
    });
    const failure = new Error("worker admission refused");
    await assert.rejects(startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation, args: ["worker", "separations"],
      write: value => output.push(value), worker: () => Promise.reject(failure),
    }), error => error === failure);
    assert.equal(output.length, 1);
  });

  it("uses one registered composer per admitted command and refuses duplicate runtime ownership", async () => {
    vi.resetModules();
    const runtime = await import("../../../../src/backend/app/composition/runtime-composition.js");
    const output: string[] = [];
    const signals = signalSeamFake();
    const seen: string[] = [];
    const record = (command: string, isolation: typeof rebuildRuntimeIsolation, args: readonly string[]) => {
      assert.equal(isolation, rebuildRuntimeIsolation);
      assert.deepEqual(args, ["registered-argument"]);
      seen.push(command);
    };
    try {
      for (const command of ["ocr", "worker", "test-data"]) {
        await assert.rejects(runtime.startRebuildRuntime({
          isolation: rebuildRuntimeIsolation, args: [command, "registered-argument"], write: value => output.push(value),
        }), /needs its composition seam/u);
      }
      assert.equal(output.length, 0);
      runtime.registerExplainComposer((isolation, args) => { record("explain", isolation, args); return "explain"; });
      runtime.registerOcrComposer(args => { assert.deepEqual(args, ["registered-argument"]); seen.push("ocr"); return { output: "ocr", exitCode: 0 }; });
      runtime.registerStorageComposer((isolation, args) => { record("storage", isolation, args); return Promise.resolve({ output: "storage", exitCode: 0 }); });
      runtime.registerTestDataComposer((isolation, args) => { record("test-data", isolation, args); return Promise.resolve({ output: "test-data", exitCode: 0 }); });
      runtime.registerWorkerComposer((isolation, args) => { record("worker", isolation, args); return Promise.resolve({ workerId: "registered-worker", workflowId: "separations", stopped: "idle", closure: "proved", outcomes: [] }); });
      runtime.registerDashboardComposer((isolation, options) => {
        assert.equal(isolation, rebuildRuntimeIsolation);
        assert.deepEqual(options, { frontend: "built-bundle" });
        seen.push("dashboard");
        return Promise.resolve({ port: isolation.backendPort, stop: () => { seen.push("stop"); return Promise.resolve(); } });
      });
      for (const duplicate of [
        () => runtime.registerExplainComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerOcrComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerStorageComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerTestDataComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerWorkerComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerDashboardComposer(() => { throw new Error("duplicate invoked"); }),
      ]) assert.throws(duplicate, /already registered; two compositions cannot own one runtime/u);
      for (const command of ["explain", "ocr", "storage", "test-data", "worker"]) {
        await runtime.startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: [command, "registered-argument"], write: value => output.push(value) });
      }
      const dashboard = runtime.startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard", "--prod"], signals: signals.seam, write: value => output.push(value) });
      await settleEventLoop();
      signals.emit("SIGINT");
      await dashboard;
      assert.deepEqual(seen, ["explain", "ocr", "storage", "test-data", "worker", "dashboard", "stop"]);
      assert.deepEqual(output.slice(0, 4), ["explain", "ocr", "storage", "test-data"]);
      assert.deepEqual(JSON.parse(output[4] ?? ""), { workerId: "registered-worker", workflowId: "separations", stopped: "idle", closure: "proved", outcomes: [] });
      assert.equal(output[5], "dashboard BFF listening on 127.0.0.1:3938 serving dist/dashboard");
      assert.deepEqual(signals.counts, { subscriptions: 1, disposals: 1 });
      await runtime.startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["explain"], write: value => output.push(value), explain: () => "override" });
      assert.equal(output.at(-1), "override");
      assert.equal(seen.filter(command => command === "explain").length, 1);
    } finally {
      vi.resetModules();
    }
  });

  it("starts the dashboard through the injected 1g-spine composition seam", async () => {
    const output: string[] = [];
    const seen: number[] = [];
    const signals = signalSeamFake();
    const lifecycle = startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation,
      args: ["dashboard"],
      write: (value) => output.push(value),
      signals: signals.seam,
      dashboard: (isolation) => {
        seen.push(isolation.backendPort);
        return Promise.resolve({ port: isolation.backendPort, stop: () => Promise.resolve() });
      },
    });
    await settleEventLoop();
    assert.deepEqual(seen, [3938]);
    assert.match(output[0] ?? "", /127\.0\.0\.1:3938/);
    signals.emit("SIGINT");
    await lifecycle;
  });

  it("parses `--prod` into the built-bundle frontend and refuses any other dashboard argument by name", async () => {
    const modes: string[] = [];
    const signals = signalSeamFake();
    const output: string[] = [];
    const lifecycle = startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation,
      args: ["dashboard", "--prod"],
      write: (value) => output.push(value),
      signals: signals.seam,
      dashboard: (isolation, options) => {
        modes.push(options.frontend);
        return Promise.resolve({ port: isolation.backendPort, stop: () => Promise.resolve() });
      },
    });
    await settleEventLoop();
    assert.deepEqual(modes, ["built-bundle"]);
    assert.match(output[0] ?? "", /serving dist\/dashboard/u);
    signals.emit("SIGINT");
    await lifecycle;

    const plain = startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation,
      args: ["dashboard"],
      write: () => undefined,
      signals: signals.seam,
      dashboard: (isolation, options) => {
        modes.push(options.frontend);
        return Promise.resolve({ port: isolation.backendPort, stop: () => Promise.resolve() });
      },
    });
    await settleEventLoop();
    assert.deepEqual(modes, ["built-bundle", "vite-dev"]);
    signals.emit("SIGINT");
    await plain;

    await assert.rejects(
      startRebuildRuntime_m0({
        isolation: rebuildRuntimeIsolation,
        args: ["dashboard", "--bogus"],
        write: () => undefined,
        signals: signals.seam,
        dashboard: () => Promise.reject(new Error("must not compose")),
      }),
      /unexpected argument\(s\): --bogus/u,
    );
    await assert.rejects(
      startRebuildRuntime_m0({
        isolation: rebuildRuntimeIsolation,
        args: ["dashboard", "--prod", "--prod"],
        write: () => undefined,
        signals: signals.seam,
        dashboard: () => Promise.reject(new Error("must not compose")),
      }),
      /unexpected argument\(s\): --prod --prod/u,
    );
  });

  it("stops the composed dashboard exactly once and waits for that stop before returning", async () => {
    const signals = signalSeamFake();
    let stops = 0;
    let finishStop: (() => void) | undefined;
    const stopFinished = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    let lifecycleSettled = false;
    const lifecycle = startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation,
      args: ["dashboard"],
      write: () => undefined,
      signals: signals.seam,
      dashboard: (isolation) => Promise.resolve({
        port: isolation.backendPort,
        stop: () => {
          stops += 1;
          return stopFinished;
        },
      }),
    });
    const observed = lifecycle.then(() => {
      lifecycleSettled = true;
    });
    await settleEventLoop();
    assert.equal(signals.counts.subscriptions, 1);

    // Two signals, one stop: SIGTERM arriving mid-shutdown must be absorbed by
    // the still-subscribed seam, never fall through to a second stop.
    signals.emit("SIGINT");
    signals.emit("SIGTERM");
    await settleEventLoop();
    assert.equal(stops, 1);
    assert.equal(lifecycleSettled, false, "the lifecycle must stay pending until stop() settles");
    assert.equal(signals.counts.disposals, 0, "listeners must outlive the in-flight stop");

    assert.ok(finishStop);
    finishStop();
    await observed;
    assert.equal(lifecycleSettled, true);
    assert.equal(stops, 1);
    assert.equal(signals.counts.disposals, 1);
  });

  it("propagates a failing dashboard stop instead of returning as if it drained", async () => {
    const signals = signalSeamFake();
    const lifecycle = startRebuildRuntime_m0({
      isolation: rebuildRuntimeIsolation,
      args: ["dashboard"],
      write: () => undefined,
      signals: signals.seam,
      dashboard: (isolation) => Promise.resolve({
        port: isolation.backendPort,
        stop: () => Promise.reject(new Error("graceful-drain authority backup failed")),
      }),
    });
    await settleEventLoop();
    signals.emit("SIGTERM");
    await assert.rejects(lifecycle, /graceful-drain authority backup failed/);
    assert.equal(signals.counts.disposals, 1, "a failed stop still removes its signal listeners");
  });

  it("keeps the real SIGINT listener subscribed across the drain and absorbs a second Ctrl+C", async () => {
    assertNoProcessSignalListeners();
    let stops = 0;
    let finishStop: (() => void) | undefined;
    const stopFinished = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    let lifecycleSettled = false;
    try {
      const lifecycle = startRebuildRuntime_m0({
        isolation: rebuildRuntimeIsolation,
        args: ["dashboard"],
        write: () => undefined,
        dashboard: (isolation) => Promise.resolve({
          port: isolation.backendPort,
          stop: () => {
            stops += 1;
            return stopFinished;
          },
        }),
      });
      const observed = lifecycle.then(() => {
        lifecycleSettled = true;
      });
      await settleEventLoop();
      assert.equal(process.listenerCount("SIGINT"), 1, "the running dashboard owns exactly one SIGINT listener");
      assert.equal(process.listenerCount("SIGTERM"), 1, "the running dashboard owns exactly one SIGTERM listener");

      process.emit("SIGINT");
      await settleEventLoop();
      assert.equal(stops, 1);
      assert.equal(lifecycleSettled, false, "the lifecycle must stay pending until stop() settles");
      assert.equal(
        process.listenerCount("SIGINT"),
        1,
        "SIGINT must stay subscribed across the drain; zero listeners restores Node's default terminate mid-stop()",
      );

      process.emit("SIGINT");
      await settleEventLoop();
      assert.equal(stops, 1, "the second Ctrl+C is absorbed by the still-subscribed listener, never a second stop");
      assert.equal(lifecycleSettled, false);

      assert.ok(finishStop);
      finishStop();
      await observed;
      assert.equal(stops, 1);
      assert.equal(process.listenerCount("SIGINT"), 0, "the disposer removes both listeners once the stop settled");
      assert.equal(process.listenerCount("SIGTERM"), 0);
    } finally {
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
    }
  });

  it("keeps the real SIGTERM listener subscribed across the drain and disposes both afterwards", async () => {
    assertNoProcessSignalListeners();
    let stops = 0;
    let finishStop: (() => void) | undefined;
    const stopFinished = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    let lifecycleSettled = false;
    try {
      const lifecycle = startRebuildRuntime_m0({
        isolation: rebuildRuntimeIsolation,
        args: ["dashboard"],
        write: () => undefined,
        dashboard: (isolation) => Promise.resolve({
          port: isolation.backendPort,
          stop: () => {
            stops += 1;
            return stopFinished;
          },
        }),
      });
      const observed = lifecycle.then(() => {
        lifecycleSettled = true;
      });
      await settleEventLoop();

      process.emit("SIGTERM");
      await settleEventLoop();
      assert.equal(stops, 1, "a supervisor's SIGTERM stops the composed runtime exactly like Ctrl+C");
      assert.equal(lifecycleSettled, false);
      assert.equal(
        process.listenerCount("SIGTERM"),
        1,
        "SIGTERM must stay subscribed across the drain; zero listeners restores Node's default terminate mid-stop()",
      );

      assert.ok(finishStop);
      finishStop();
      await observed;
      assert.equal(lifecycleSettled, true);
      assert.equal(process.listenerCount("SIGINT"), 0);
      assert.equal(process.listenerCount("SIGTERM"), 0);
    } finally {
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
    }
  });

  it("falls back to the real process argv and stdout writer the entrypoint relies on", async () => {

    const written: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalArgv = process.argv;
    process.stdout.write = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    process.argv = [originalArgv[0] ?? "node", "src/cli.ts", "phase"];
    try {
      await startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation });
    } finally {
      process.stdout.write = originalWrite;
      process.argv = originalArgv;
    }
    assert.equal(written.length, 1);
    assert.equal(written[0]?.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(written[0] ?? ""), {
      completedThrough: "2j",
      active: "3-workflow-migration",
      stateRoot: ".tracker/data",
      artifactRoot: ".tracker/data/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      browserSessionNamespace: "hrauto-rebuild",
    });
  });

  it("defaults an empty argv to the help contract surface", async () => {
    const output: string[] = [];
    await startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args: [], write: (value) => output.push(value) });
    assert.equal(output[0], runtimeHelp(rebuildRuntimeIsolation));
  });

  it("rejects the removed dry-run CLI entry without advertising it", async () => {
    assert.doesNotMatch(runtimeHelp(rebuildRuntimeIsolation), /dry-run-scenario/u);
    for (const args of [["dry-run-scenario", "separations", "--subject", "finalization-canary"], ["dry-run-scenario", "--help"]]) {
      await assert.rejects(startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation, args }), /unknown rebuild command: dry-run-scenario/u);
    }
  });

});
}
