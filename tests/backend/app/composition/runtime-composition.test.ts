import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1,vi } from "vitest";
import { runtimeHelp as runtimeHelp_m1,startRebuildRuntime as startRebuildRuntime_m0,startRebuildRuntime as startRebuildRuntime_m1 } from "../../../../src/backend/app/composition/runtime-composition.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0,rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import type { WorkerLoopReport as WorkerLoopReport_m1 } from "../../../../src/backend/runtime/workers/worker-loop.js";


{


describe_m0("dashboard readiness publication", () => {
  it_m0("publishes only after composition and shutdown subscription, so immediate frontend failure drains", async () => {
    const events: string[] = [];
    let shutdown: (() => void) | undefined;
    await startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation_m0, args: ["dashboard"], write: () => undefined,
      dashboard: async () => { events.push("listening"); return { port: 3938, stop: async () => { events.push("stopped"); } }; },
      signals: { subscribe: handler => {
        events.push("subscribed"); shutdown = () => handler("SIGTERM");
        return () => { events.push("disposed"); };
      } },
      dashboardReady: () => { events.push("ready"); assert_m0.ok(shutdown); shutdown(); },
    });
    assert_m0.deepEqual(events, ["listening", "subscribed", "ready", "stopped", "disposed"]);
  });

  it_m0("never announces readiness after failed composition", async () => {
    let published = false;
    await assert_m0.rejects(startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation_m0, args: ["dashboard"],
      dashboard: async () => { throw new Error("bind refused"); },
      dashboardReady: () => { published = true; },
    }), /bind refused/u);
    assert_m0.equal(published, false);
  });

  it_m0("drains and disposes listeners when readiness publication throws", async () => {
    let stopped = false; let disposed = false;
    await assert_m0.rejects(startRebuildRuntime_m0({ isolation: rebuildRuntimeIsolation_m0, args: ["dashboard"], write: () => undefined,
      dashboard: async () => ({ port: 3938, stop: async () => { stopped = true; } }),
      signals: { subscribe: () => () => { disposed = true; } },
      dashboardReady: () => { throw new Error("IPC refused"); },
    }), /IPC refused/u);
    assert_m0.equal(stopped, true); assert_m0.equal(disposed, true);
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
  assert_m1.equal(
    process.listenerCount("SIGINT"),
    0,
    "this test observes the dashboard's own SIGINT registration; the test process must hold none of its own",
  );
  assert_m1.equal(
    process.listenerCount("SIGTERM"),
    0,
    "this test observes the dashboard's own SIGTERM registration; the test process must hold none of its own",
  );
}

describe_m1("isolated runtime composition", () => {
  it_m1("binds the exact rebuild-only resources", () => {
    assert_m1.deepEqual(rebuildRuntimeIsolation_m1, {
      stateRoot: ".tracker/data",
      artifactRoot: ".tracker/data/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      processLockRoot: ".tracker/data/locks",
      browserProfileRoot: ".tracker/data/browsers",
      browserSessionNamespace: "hrauto-rebuild",
    });
    assert_m1.match(runtimeHelp_m1(rebuildRuntimeIsolation_m1), /1g-spine/);

    assert_m1.match(
      runtimeHelp_m1(rebuildRuntimeIsolation_m1),
      /complete through 2j; active 3-workflow-migration/,
    );
  });

  it_m1("executes only the currently owned CLI surface and fails loud for future runtime work", async () => {
    const output: string[] = [];
    await startRebuildRuntime_m1({ isolation: rebuildRuntimeIsolation_m1, args: ["phase"], write: (value) => output.push(value) });
    assert_m1.deepEqual(JSON.parse(output[0] ?? ""), {
      completedThrough: "2j",
      active: "3-workflow-migration",
      stateRoot: ".tracker/data",
      artifactRoot: ".tracker/data/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      browserSessionNamespace: "hrauto-rebuild",
    });
    await startRebuildRuntime_m1({ isolation: rebuildRuntimeIsolation_m1, args: ["--help"], write: (value) => output.push(value) });
    assert_m1.match(output[1] ?? "", /Commands/);
    await assert_m1.rejects(
      startRebuildRuntime_m1({ isolation: rebuildRuntimeIsolation_m1, args: ["dashboard"], write: () => undefined }),
      /needs its composition seam/,
    );
    await assert_m1.rejects(
      startRebuildRuntime_m1({ isolation: rebuildRuntimeIsolation_m1, args: ["unknown"], write: () => undefined }),
      /unknown rebuild command/,
    );
  });

  it_m1("routes `explain` through its injected seam and refuses without one", async () => {
    const output: string[] = [];
    const seen: string[][] = [];
    await startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
      args: ["explain", "run", "pl-000619-4ebf", "--json"],
      write: (value) => output.push(value),
      explain: (isolation, args) => {
        assert_m1.equal(isolation.stateRoot, ".tracker/data");
        seen.push([...args]);
        return "the explanation";
      },
    });
    assert_m1.deepEqual(seen, [["run", "pl-000619-4ebf", "--json"]]);
    assert_m1.deepEqual(output, ["the explanation"]);
    await assert_m1.rejects(
      startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1,
        args: ["explain", "run", "pl-000619-4ebf"],
        write: () => undefined,
      }),
      /needs its composition seam/,
    );
  });

  it_m1("routes `storage doctor` through its injected seam and refuses without one", async () => {
    const output: string[] = [];
    const seen: string[][] = [];
    await startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
      args: ["storage", "doctor", "--json"],
      write: (value) => output.push(value),
      storage: (isolation, args) => {
        assert_m1.equal(isolation.stateRoot, ".tracker/data");
        seen.push([...args]);
        return Promise.resolve({ output: "the doctor report", exitCode: 0 });
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert_m1.deepEqual(seen, [["doctor", "--json"]]);
    assert_m1.deepEqual(output, ["the doctor report"]);
    await assert_m1.rejects(
      startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1,
        args: ["storage", "doctor"],
        write: () => undefined,
      }),
      /needs its composition seam/,
    );
  });

  for (const command of ["storage", "test-data"] as const) {
    it_m1(`awaits ${command} output, forwards exact isolation and arguments, and propagates exit status`, async () => {
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
          const running = startRebuildRuntime_m1({
            isolation: rebuildRuntimeIsolation_m1, args: [command, ...args], write: value => output.push(value),
            [command === "storage" ? "storage" : "testData"]: (isolation: typeof rebuildRuntimeIsolation_m1, rest: readonly string[]) => {
              assert_m1.equal(isolation, rebuildRuntimeIsolation_m1);
              assert_m1.deepEqual(rest, args);
              return outcome;
            },
          }).then(() => { settled = true; });
          await settleEventLoop();
          assert_m1.equal(settled, false);
          assert_m1.equal(output.length, before);
          assert_m1.equal(process.exitCode, 7);
          assert_m1.ok(finish);
          finish({ output: `${command}:${exitCode}`, exitCode });
          await running;
          assert_m1.equal(settled, true);
          assert_m1.equal(output.at(-1), `${command}:${exitCode}`);
          assert_m1.equal(process.exitCode, exitCode === 0 ? 7 : exitCode);
        }
        const failure = new Error(`${command} refused authority`);
        const before = [...output];
        await assert_m1.rejects(startRebuildRuntime_m1({
          isolation: rebuildRuntimeIsolation_m1, args: [command, ...args], write: value => output.push(value),
          [command === "storage" ? "storage" : "testData"]: () => Promise.reject(failure),
        }), error => error === failure);
        assert_m1.deepEqual(output, before);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  }

  it_m1("forwards OCR arguments and preserves successful and refused command exit status", async () => {
    const previousExitCode = process.exitCode;
    const output: string[] = [];
    try {
      for (const exitCode of [0, 1]) {
        process.exitCode = 7;
        await startRebuildRuntime_m1({
          isolation: rebuildRuntimeIsolation_m1, args: ["ocr", "admit", "submission.json"],
          write: value => output.push(value),
          ocr: args => {
            assert_m1.deepEqual(args, ["admit", "submission.json"]);
            return { output: `ocr:${exitCode}`, exitCode };
          },
        });
        assert_m1.equal(output.at(-1), `ocr:${exitCode}`);
        assert_m1.equal(process.exitCode, exitCode === 0 ? 7 : exitCode);
      }
      const failure = new Error("OCR admission refused");
      await assert_m1.rejects(startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1, args: ["ocr", "admit", "submission.json"],
        write: value => output.push(value), ocr: () => { throw failure; },
      }), error => error === failure);
      assert_m1.deepEqual(output, ["ocr:0", "ocr:1"]);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it_m1("awaits the worker report, publishes only outcome states, and propagates failure without output", async () => {
    const output: string[] = [];
    const report = {
      workerId: "worker-1", workflowId: "separations", stopped: "stop-directive",
      outcomes: [{ state: "done", runId: "run-1" }, { state: "failed", runId: "run-2", failureId: "failure-2" }],
    } satisfies WorkerLoopReport_m1;
    let finish: ((report: WorkerLoopReport_m1) => void) | undefined;
    const result = new Promise<WorkerLoopReport_m1>(resolve => { finish = resolve; });
    const running = startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1, args: ["worker", "separations", "--pool-index", "2", "--drain"],
      write: value => output.push(value), worker: (isolation, args) => {
        assert_m1.equal(isolation, rebuildRuntimeIsolation_m1);
        assert_m1.deepEqual(args, ["separations", "--pool-index", "2", "--drain"]);
        return result;
      },
    });
    await settleEventLoop();
    assert_m1.equal(output.length, 0);
    assert_m1.ok(finish);
    finish(report);
    await running;
    assert_m1.equal(output.length, 1);
    assert_m1.deepEqual(JSON.parse(output[0] ?? ""), {
      workerId: "worker-1", workflowId: "separations", stopped: "stop-directive", outcomes: ["done", "failed"],
    });
    const failure = new Error("worker admission refused");
    await assert_m1.rejects(startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1, args: ["worker", "separations"],
      write: value => output.push(value), worker: () => Promise.reject(failure),
    }), error => error === failure);
    assert_m1.equal(output.length, 1);
  });

  it_m1("uses one registered composer per admitted command and refuses duplicate runtime ownership", async () => {
    vi.resetModules();
    const runtime = await import("../../../../src/backend/app/composition/runtime-composition.js");
    const output: string[] = [];
    const signals = signalSeamFake();
    const seen: string[] = [];
    const record = (command: string, isolation: typeof rebuildRuntimeIsolation_m1, args: readonly string[]) => {
      assert_m1.equal(isolation, rebuildRuntimeIsolation_m1);
      assert_m1.deepEqual(args, ["registered-argument"]);
      seen.push(command);
    };
    try {
      for (const command of ["ocr", "worker", "test-data", "dry-run-scenario"]) {
        await assert_m1.rejects(runtime.startRebuildRuntime({
          isolation: rebuildRuntimeIsolation_m1, args: [command, "registered-argument"], write: value => output.push(value),
        }), /needs its composition seam/u);
      }
      assert_m1.equal(output.length, 0);
      runtime.registerExplainComposer((isolation, args) => { record("explain", isolation, args); return "explain"; });
      runtime.registerOcrComposer(args => { assert_m1.deepEqual(args, ["registered-argument"]); seen.push("ocr"); return { output: "ocr", exitCode: 0 }; });
      runtime.registerStorageComposer((isolation, args) => { record("storage", isolation, args); return Promise.resolve({ output: "storage", exitCode: 0 }); });
      runtime.registerTestDataComposer((isolation, args) => { record("test-data", isolation, args); return Promise.resolve({ output: "test-data", exitCode: 0 }); });
      runtime.registerDryRunScenarioComposer((isolation, args) => { record("dry-run-scenario", isolation, args); return Promise.resolve({ output: "dry-run-scenario", exitCode: 0 }); });
      runtime.registerWorkerComposer((isolation, args) => { record("worker", isolation, args); return Promise.resolve({ workerId: "registered-worker", workflowId: "separations", stopped: "idle", outcomes: [] }); });
      runtime.registerDashboardComposer((isolation, options) => {
        assert_m1.equal(isolation, rebuildRuntimeIsolation_m1);
        assert_m1.deepEqual(options, { frontend: "built-bundle" });
        seen.push("dashboard");
        return Promise.resolve({ port: isolation.backendPort, stop: () => { seen.push("stop"); return Promise.resolve(); } });
      });
      for (const duplicate of [
        () => runtime.registerExplainComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerOcrComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerStorageComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerTestDataComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerDryRunScenarioComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerWorkerComposer(() => { throw new Error("duplicate invoked"); }),
        () => runtime.registerDashboardComposer(() => { throw new Error("duplicate invoked"); }),
      ]) assert_m1.throws(duplicate, /already registered; two compositions cannot own one runtime/u);
      for (const command of ["explain", "ocr", "storage", "test-data", "dry-run-scenario", "worker"]) {
        await runtime.startRebuildRuntime({ isolation: rebuildRuntimeIsolation_m1, args: [command, "registered-argument"], write: value => output.push(value) });
      }
      const dashboard = runtime.startRebuildRuntime({ isolation: rebuildRuntimeIsolation_m1, args: ["dashboard", "--prod"], signals: signals.seam, write: value => output.push(value) });
      await settleEventLoop();
      signals.emit("SIGINT");
      await dashboard;
      assert_m1.deepEqual(seen, ["explain", "ocr", "storage", "test-data", "dry-run-scenario", "worker", "dashboard", "stop"]);
      assert_m1.deepEqual(output.slice(0, 5), ["explain", "ocr", "storage", "test-data", "dry-run-scenario"]);
      assert_m1.deepEqual(JSON.parse(output[5] ?? ""), { workerId: "registered-worker", workflowId: "separations", stopped: "idle", outcomes: [] });
      assert_m1.equal(output[6], "dashboard BFF listening on 127.0.0.1:3938 serving dist/dashboard");
      assert_m1.deepEqual(signals.counts, { subscriptions: 1, disposals: 1 });
      await runtime.startRebuildRuntime({ isolation: rebuildRuntimeIsolation_m1, args: ["explain"], write: value => output.push(value), explain: () => "override" });
      assert_m1.equal(output.at(-1), "override");
      assert_m1.equal(seen.filter(command => command === "explain").length, 1);
    } finally {
      vi.resetModules();
    }
  });

  it_m1("starts the dashboard through the injected 1g-spine composition seam", async () => {
    const output: string[] = [];
    const seen: number[] = [];
    const signals = signalSeamFake();
    const lifecycle = startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
      args: ["dashboard"],
      write: (value) => output.push(value),
      signals: signals.seam,
      dashboard: (isolation) => {
        seen.push(isolation.backendPort);
        return Promise.resolve({ port: isolation.backendPort, stop: () => Promise.resolve() });
      },
    });
    await settleEventLoop();
    assert_m1.deepEqual(seen, [3938]);
    assert_m1.match(output[0] ?? "", /127\.0\.0\.1:3938/);
    signals.emit("SIGINT");
    await lifecycle;
  });

  it_m1("parses `--prod` into the built-bundle frontend and refuses any other dashboard argument by name", async () => {
    const modes: string[] = [];
    const signals = signalSeamFake();
    const output: string[] = [];
    const lifecycle = startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
      args: ["dashboard", "--prod"],
      write: (value) => output.push(value),
      signals: signals.seam,
      dashboard: (isolation, options) => {
        modes.push(options.frontend);
        return Promise.resolve({ port: isolation.backendPort, stop: () => Promise.resolve() });
      },
    });
    await settleEventLoop();
    assert_m1.deepEqual(modes, ["built-bundle"]);
    assert_m1.match(output[0] ?? "", /serving dist\/dashboard/u);
    signals.emit("SIGINT");
    await lifecycle;

    const plain = startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
      args: ["dashboard"],
      write: () => undefined,
      signals: signals.seam,
      dashboard: (isolation, options) => {
        modes.push(options.frontend);
        return Promise.resolve({ port: isolation.backendPort, stop: () => Promise.resolve() });
      },
    });
    await settleEventLoop();
    assert_m1.deepEqual(modes, ["built-bundle", "vite-dev"]);
    signals.emit("SIGINT");
    await plain;

    await assert_m1.rejects(
      startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1,
        args: ["dashboard", "--bogus"],
        write: () => undefined,
        signals: signals.seam,
        dashboard: () => Promise.reject(new Error("must not compose")),
      }),
      /unexpected argument\(s\): --bogus/u,
    );
    await assert_m1.rejects(
      startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1,
        args: ["dashboard", "--prod", "--prod"],
        write: () => undefined,
        signals: signals.seam,
        dashboard: () => Promise.reject(new Error("must not compose")),
      }),
      /unexpected argument\(s\): --prod --prod/u,
    );
  });

  it_m1("stops the composed dashboard exactly once and waits for that stop before returning", async () => {
    const signals = signalSeamFake();
    let stops = 0;
    let finishStop: (() => void) | undefined;
    const stopFinished = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    let lifecycleSettled = false;
    const lifecycle = startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
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
    assert_m1.equal(signals.counts.subscriptions, 1);

    // Two signals, one stop: SIGTERM arriving mid-shutdown must be absorbed by
    // the still-subscribed seam, never fall through to a second stop.
    signals.emit("SIGINT");
    signals.emit("SIGTERM");
    await settleEventLoop();
    assert_m1.equal(stops, 1);
    assert_m1.equal(lifecycleSettled, false, "the lifecycle must stay pending until stop() settles");
    assert_m1.equal(signals.counts.disposals, 0, "listeners must outlive the in-flight stop");

    assert_m1.ok(finishStop);
    finishStop();
    await observed;
    assert_m1.equal(lifecycleSettled, true);
    assert_m1.equal(stops, 1);
    assert_m1.equal(signals.counts.disposals, 1);
  });

  it_m1("propagates a failing dashboard stop instead of returning as if it drained", async () => {
    const signals = signalSeamFake();
    const lifecycle = startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
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
    await assert_m1.rejects(lifecycle, /graceful-drain authority backup failed/);
    assert_m1.equal(signals.counts.disposals, 1, "a failed stop still removes its signal listeners");
  });


  it_m1("keeps the real SIGINT listener subscribed across the drain and absorbs a second Ctrl+C", async () => {
    assertNoProcessSignalListeners();
    let stops = 0;
    let finishStop: (() => void) | undefined;
    const stopFinished = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    let lifecycleSettled = false;
    try {
      const lifecycle = startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1,
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
      assert_m1.equal(process.listenerCount("SIGINT"), 1, "the running dashboard owns exactly one SIGINT listener");
      assert_m1.equal(process.listenerCount("SIGTERM"), 1, "the running dashboard owns exactly one SIGTERM listener");

      process.emit("SIGINT");
      await settleEventLoop();
      assert_m1.equal(stops, 1);
      assert_m1.equal(lifecycleSettled, false, "the lifecycle must stay pending until stop() settles");
      assert_m1.equal(
        process.listenerCount("SIGINT"),
        1,
        "SIGINT must stay subscribed across the drain; zero listeners restores Node's default terminate mid-stop()",
      );

      process.emit("SIGINT");
      await settleEventLoop();
      assert_m1.equal(stops, 1, "the second Ctrl+C is absorbed by the still-subscribed listener, never a second stop");
      assert_m1.equal(lifecycleSettled, false);

      assert_m1.ok(finishStop);
      finishStop();
      await observed;
      assert_m1.equal(stops, 1);
      assert_m1.equal(process.listenerCount("SIGINT"), 0, "the disposer removes both listeners once the stop settled");
      assert_m1.equal(process.listenerCount("SIGTERM"), 0);
    } finally {
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
    }
  });

  it_m1("keeps the real SIGTERM listener subscribed across the drain and disposes both afterwards", async () => {
    assertNoProcessSignalListeners();
    let stops = 0;
    let finishStop: (() => void) | undefined;
    const stopFinished = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    let lifecycleSettled = false;
    try {
      const lifecycle = startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1,
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
      assert_m1.equal(stops, 1, "a supervisor's SIGTERM stops the composed runtime exactly like Ctrl+C");
      assert_m1.equal(lifecycleSettled, false);
      assert_m1.equal(
        process.listenerCount("SIGTERM"),
        1,
        "SIGTERM must stay subscribed across the drain; zero listeners restores Node's default terminate mid-stop()",
      );

      assert_m1.ok(finishStop);
      finishStop();
      await observed;
      assert_m1.equal(lifecycleSettled, true);
      assert_m1.equal(process.listenerCount("SIGINT"), 0);
      assert_m1.equal(process.listenerCount("SIGTERM"), 0);
    } finally {
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
    }
  });

  it_m1("falls back to the real process argv and stdout writer the entrypoint relies on", async () => {

    const written: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalArgv = process.argv;
    process.stdout.write = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    process.argv = [originalArgv[0] ?? "node", "src/cli.ts", "phase"];
    try {
      await startRebuildRuntime_m1({ isolation: rebuildRuntimeIsolation_m1 });
    } finally {
      process.stdout.write = originalWrite;
      process.argv = originalArgv;
    }
    assert_m1.equal(written.length, 1);
    assert_m1.equal(written[0]?.endsWith("\n"), true);
    assert_m1.deepEqual(JSON.parse(written[0] ?? ""), {
      completedThrough: "2j",
      active: "3-workflow-migration",
      stateRoot: ".tracker/data",
      artifactRoot: ".tracker/data/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      browserSessionNamespace: "hrauto-rebuild",
    });
  });

  it_m1("defaults an empty argv to the help contract surface", async () => {
    const output: string[] = [];
    await startRebuildRuntime_m1({ isolation: rebuildRuntimeIsolation_m1, args: [], write: (value) => output.push(value) });
    assert_m1.equal(output[0], runtimeHelp_m1(rebuildRuntimeIsolation_m1));
  });

  it_m1("routes the strict dry-run scenario command and preserves its exit semantics", async () => {
    const output: string[] = [];
    const seen: string[][] = [];
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await startRebuildRuntime_m1({
        isolation: rebuildRuntimeIsolation_m1,
        args: ["dry-run-scenario", "separations-kuali-finalization", "--subject", "finalization-canary"],
        write: (value) => output.push(value),
        dryRunScenario: (_isolation, args) => {
          seen.push([...args]);
          return Promise.resolve({
            output: "blocked: needs finalization-canary\nresult: 11111111-1111-4111-8111-111111111111",
            exitCode: 2,
          });
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert_m1.deepEqual(seen, [["separations-kuali-finalization", "--subject", "finalization-canary"]]);
      assert_m1.deepEqual(output, [
        "blocked: needs finalization-canary\nresult: 11111111-1111-4111-8111-111111111111",
      ]);
      assert_m1.equal(process.exitCode, 2);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it_m1("serves dry-run scenario help without constructing its composition", async () => {
    let composed = false;
    const output: string[] = [];
    await startRebuildRuntime_m1({
      isolation: rebuildRuntimeIsolation_m1,
      args: ["dry-run-scenario", "--help"],
      write: (value) => output.push(value),
      dryRunScenario: () => {
        composed = true;
        return Promise.reject(new Error("must not compose"));
      },
    });
    assert_m1.equal(composed, false);
    assert_m1.deepEqual(output, ["usage: dry-run-scenario <workflow> --subject <label>"]);
  });
});
}
