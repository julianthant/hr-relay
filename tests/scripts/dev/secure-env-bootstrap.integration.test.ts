import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { describe,it } from "vitest";
import { runSecureEnvironmentBootstrap as runBootstrap, secureEnvironmentEntrypoint } from "../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { acquireRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";

import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const syntheticAdmission = () => RuntimeAdmission.syntheticFixture(":memory:");
const runSecureEnvironmentBootstrap: typeof runBootstrap = (args, dependencies) => runBootstrap(args, {
  acquireLifetimeLock: () => acquireRuntimeLifetimeLock(0), ...dependencies,
});

describe("secure environment bootstrap", () => {
  it("admits stopped boot diagnostics exclusively without provider environment or database bootstrap", async () => {
    const original = [...process.argv]; const events: string[] = [];
    try {
      await runSecureEnvironmentBootstrap(["cli", "explain", "diagnostics", "--boot", "--json"], {
        acquireAdmission: mode => { assert.equal(mode, "exclusive"); events.push("exclusive"); return syntheticAdmission(); },
        assertEnvironment: () => { throw new Error("boot diagnostics must not read provider environment"); },
        runCli: async () => { events.push("reader"); },
      });
      assert.deepEqual(events, ["exclusive", "reader"]);
      await assert.rejects(runSecureEnvironmentBootstrap(["cli", "explain", "diagnostics", "--boot", "--after", "1"], {
        acquireAdmission: () => { throw new Error("invalid boot flags must refuse before admission"); },
      }), /diagnostic-boot-does-not-have-timeline-cursors/u);
    } finally { process.argv.splice(0, process.argv.length, ...original); }
  });

  it("shows the exact pending recovery operation without normal or provider admission", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (value: string) => { output.push(value); return true; };
    try {
      await runSecureEnvironmentBootstrap(["cli", "storage", "relocate", "--status"], {
        acquireAdmission: () => { throw new Error("status must not acquire normal installation admission"); },
        assertEnvironment: () => { throw new Error("status must not read provider environment"); },
        inspectRelocationStatus: () => ({ operationId, phase: "fenced", fromGeneration: 0 }),
        runRelocation: () => { throw new Error("status must not resume operation"); },
      });
      assert.deepEqual(output, [`storage relocate: fenced operation ${operationId}; run storage relocate --resume ${operationId}\n`]);
    } finally { process.stdout.write = originalWrite; }
  });

  it("validates the exact production bundle before authority and provider admission", async () => {
    const original = [...process.argv]; const events: string[] = [];
    try {
      await runSecureEnvironmentBootstrap(["cli", "dashboard", "--prod"], {
        validateDashboardBundle: workspace => { assert.equal(workspace, REPO_ROOT); events.push("bundle"); },
        acquireAdmission: () => { events.push("authority"); return syntheticAdmission(); },
        assertEnvironment: () => { events.push("parent-environment"); },
        runCli: async () => { events.push("runner"); },
      });
      assert.deepEqual(events, ["bundle", "authority", "parent-environment", "runner"]);
    } finally { process.argv.splice(0, process.argv.length, ...original); }
  });

  it("refuses a production bundle failure before authority, credentials or runner effects", async () => {
    const events: string[] = [];
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "dashboard", "--prod"], {
      validateDashboardBundle: () => { events.push("bundle"); throw new Error("dashboard bundle refused"); },
      acquireAdmission: () => { throw new Error("must not acquire authority"); },
      assertEnvironment: () => { throw new Error("must not read environment"); },
      runCli: async () => { throw new Error("must not enter runner"); },
    }), /dashboard bundle refused/u);
    assert.deepEqual(events, ["bundle"]);
  });

  it.each([["cli", "dashboard"], ["cli", "dashboard", "--prod", "extra"], ["cli", "other", "--prod"]])(
    "reserves bundle pre-admission for the exact production command %j", async (...args) => {
      const original = [...process.argv];
      try {
        await runSecureEnvironmentBootstrap(args, {
          validateDashboardBundle: () => { throw new Error("unexpected bundle validation"); },
          acquireAdmission: syntheticAdmission, assertEnvironment: () => undefined, runCli: async () => undefined,
        });
      } finally { process.argv.splice(0, process.argv.length, ...original); }
    });

  it("keeps signal listeners through the final dashboard admission release", async () => {
    const originalArgv = [...process.argv];
    const beforeInterrupt = process.listenerCount("SIGINT");
    const beforeTerminate = process.listenerCount("SIGTERM");
    let released = false;
    let queuedSignalAbsorbed = false;
    try {
      await runSecureEnvironmentBootstrap(["cli", "dashboard"], {
        acquireAdmission: () => ({ release() {
          assert.ok(process.listenerCount("SIGINT") > beforeInterrupt);
          assert.ok(process.listenerCount("SIGTERM") > beforeTerminate);
          process.emit("SIGINT");
          process.emit("SIGTERM");
          setImmediate(() => { queuedSignalAbsorbed = process.listenerCount("SIGINT") > beforeInterrupt; process.emit("SIGINT"); });
          released = true;
        } }) as unknown as RuntimeAdmission,
        assertEnvironment: () => undefined,
        runCli: async () => undefined,
      });
      assert.equal(released, true);
      assert.equal(queuedSignalAbsorbed, true);
      assert.equal(process.listenerCount("SIGINT"), beforeInterrupt);
      assert.equal(process.listenerCount("SIGTERM"), beforeTerminate);
    } finally { process.argv.splice(0, process.argv.length, ...originalArgv); }
  });

  it("survives a real SIGINT sent by the stub final admission release", () => {
    const moduleUrl = pathToFileURL(join(REPO_ROOT, "src", "backend", "app", "bootstrap", "secure-env-bootstrap.ts")).href;
    const source = `import { runSecureEnvironmentBootstrap } from ${JSON.stringify(moduleUrl)};
      await runSecureEnvironmentBootstrap(['cli','dashboard'], {
        acquireAdmission: () => ({ release() { process.kill(process.pid, 'SIGINT'); } }),
        assertEnvironment: () => {}, admitEnvironmentFile: () => {}, runCli: async () => {},
      });
      process.stdout.write('RELEASED\\n');`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 5000 });
    assert.equal(child.status, 0, `child ended with ${String(child.signal)}: ${child.stderr}`);
    assert.match(child.stdout, /RELEASED/u);
  });

  it("refuses the parent environment before opening .env.providers or starting a runner", async () => {
    const events: string[] = [];
    await assert.rejects(
      runSecureEnvironmentBootstrap(["cli"], {
        acquireAdmission: syntheticAdmission,
        assertEnvironment: () => {
          events.push("assert-parent");
          throw new Error("migrated environment refused");
        },
        runCli: () => {
          events.push("run-cli");
          return Promise.resolve();
        },
      }),
      /migrated environment refused/u,
    );
    assert.deepEqual(events, ["assert-parent"]);
  });

  it.each([
    ["storage", "doctor"], ["storage", "backup"], ["storage", "upgrade"], ["storage", "restore"],

    ["test-data", "check"], ["test-data", "migrate"],
  ])("isolates %s %s from provider environment admission", async (command, operation) => {
    const original = [...process.argv]; const events: string[] = [];
    try {
      await runSecureEnvironmentBootstrap(["cli", command, operation], {
        acquireAdmission: syntheticAdmission,
        assertEnvironment: () => { throw new Error(`${command} must not read parent provider environment`); },
        runCli: async () => { events.push(...process.argv.slice(2)); },
      });
      assert.deepEqual(events, [command, operation]);
    } finally { process.argv.splice(0, process.argv.length, ...original); }
  });

  it.each([
    // Stopped-authority backups require exclusive custody.
    ["backup", "exclusive"], ["doctor", "shared"], ["transactions", "shared"],
    ["help", "shared"], ["--help", "shared"], ["-h", "shared"],
    ["upgrade", "exclusive"], ["restore", "exclusive"], ["repair", "exclusive"],
  ] as const)("holds %s admission in %s mode for the full CLI lifetime", async (operation, expectedMode) => {
    let finish: (() => void) | undefined;
    const running = new Promise<void>((resolve) => { finish = resolve; });
    let selectedMode: "shared" | "exclusive" | undefined;
    let held: RuntimeAdmission | undefined;
    const admitted = Promise.withResolvers<void>();
    const launch = runSecureEnvironmentBootstrap(["cli", "storage", operation], {
      acquireAdmission: (mode) => { selectedMode = mode; held = syntheticAdmission(); admitted.resolve(); return held; },
      runCli: async () => { held?.assertLive(); await running; held?.assertLive(); },
    });
    try {
      await Promise.race([admitted.promise, launch]);
      assert.equal(selectedMode, expectedMode);
      held?.assertLive();
    } finally { finish?.(); }
    await launch;
    assert.throws(() => held?.assertLive(), /released admission/u);
  });

  it("dispatches exact relocation recovery before normal installation or provider admission", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    const events: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const output: string[] = [];
    process.stdout.write = (value: string) => { output.push(value); return true; };
    try {
      await runSecureEnvironmentBootstrap(["cli", "storage", "relocate", "--resume", operationId, "--json"], {
        acquireAdmission: () => { throw new Error("normal admission must not precede recovery"); },
        assertEnvironment: () => { throw new Error("relocation must not read provider environment"); },
        runCli: () => { throw new Error("relocation must not enter ordinary CLI composition"); },
        runRelocation: async ({ args, admission }) => {
          assert.equal(admission, undefined);
          assert.deepEqual(args, ["--resume", operationId, "--json"]);
          events.push("recovery");
          return { operationId, generation: 2 };
        },
      });
      assert.deepEqual(events, ["recovery"]);
      assert.deepEqual(output, [`{"operationId":"${operationId}","generation":2}\n`]);
    } finally { process.stdout.write = originalWrite; }
  });

  it("keeps the exact planned relocation admission held through the offline runner", async () => {
    const commandId = "22222222-2222-4222-8222-222222222222";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    let held: RuntimeAdmission | undefined;
    try {
      await runSecureEnvironmentBootstrap(["cli", "storage", "relocate", "--plan", commandId], {
        acquireAdmission: (mode) => { assert.equal(mode, "exclusive"); held = syntheticAdmission(); return held; },
        assertEnvironment: () => { throw new Error("relocation must not read provider environment"); },
        runRelocation: async ({ args, admission }) => {
          assert.deepEqual(args, ["--plan", commandId]);
          assert.equal(admission, held);
          admission?.assertLive();
          await Promise.resolve();
          admission?.assertLive();
          return { operationId: commandId, generation: 1 };
        },
      });
      assert.throws(() => held?.assertLive(), /released admission/u);
    } finally { process.stdout.write = originalWrite; }
  });

  it("does not start the CLI when its module is executed directly", () => {
    const result = spawnSync(TSX, [join(REPO_ROOT, "src", "cli.ts")], {
      cwd: tmpdir(),
      encoding: "utf8",
    });

    assert.deepEqual(
      { status: result.status, stdout: result.stdout, stderr: result.stderr },
      { status: 0, stdout: "", stderr: "" },
    );
  });

  it("does not start the document-number smoke when its module is executed directly", () => {
    const result = spawnSync(
      TSX,
      [join(REPO_ROOT, "scripts", "verify", "test-target-document-number.ts")],
      { cwd: tmpdir(), encoding: "utf8" },
    );

    assert.deepEqual(
      { status: result.status, stdout: result.stdout, stderr: result.stderr },
      { status: 0, stdout: "", stderr: "" },
    );
  });

  it("does not start either admitted runner when its module is imported directly", () => {
    const imports = [
      pathToFileURL(join(REPO_ROOT, "src", "cli.ts")).href,
      pathToFileURL(join(REPO_ROOT, "scripts", "verify", "test-target-document-number.ts")).href,
    ].map((url) => `import(${JSON.stringify(url)})`).join(",");
    const result = spawnSync(TSX, ["--eval", `Promise.all([${imports}])`], {
      cwd: tmpdir(),
      encoding: "utf8",
    });

    assert.deepEqual(
      { status: result.status, stdout: result.stdout, stderr: result.stderr },
      { status: 0, stdout: "", stderr: "" },
    );
  });

  it("routes every environment-backed package command through the fixed bootstrap", () => {
    const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }).scripts;

    assert.equal(scripts.cli, "tsx scripts/dev/secure-env-bootstrap.ts cli");
    assert.equal(
      scripts["dashboard:prod"],
      "tsx scripts/dev/secure-env-bootstrap.ts cli dashboard --prod",
    );
    assert.equal(
      scripts["smoke:test-target-document-number"],
      "tsx scripts/dev/secure-env-bootstrap.ts test-target-document-number",
    );
    assert.equal(scripts["smoke:test-target-person-secrets"], undefined);
    assert.equal(
      Object.values(scripts).some((command) => command.includes("test-target-person-secrets")),
      false,
    );
    assert.equal(
      Object.values(scripts).some((command) => command.includes("--env-file")),
      false,
    );
  });

  it("refuses every entrypoint selector outside the closed CLI and canary-smoke set", () => {
    assert.equal(secureEnvironmentEntrypoint("cli"), "cli");
    assert.equal(
      secureEnvironmentEntrypoint("test-target-document-number"),
      "test-target-document-number",
    );

    for (const refused of [
      "../../../src/arbitrary.ts",
      "test-target-person-secrets",
      "",
    ]) {
      assert.throws(
        () => secureEnvironmentEntrypoint(refused),
        /secure environment entrypoint must be cli or test-target-document-number/,
        refused,
      );
    }
    assert.throws(
      () => secureEnvironmentEntrypoint(undefined),
      /secure environment entrypoint must be cli or test-target-document-number/,
    );
  });
});
