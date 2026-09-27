import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  repositoryEnvironmentFilePath,
  runSecureEnvironmentBootstrap,
  secureEnvironmentEntrypoint,
} from "../../scripts/secure-env-bootstrap.js";

import { admitLocalEnvironmentFile } from "../../src/domain/secrets.js";
import { RuntimeAdmission } from "../../src/infra/runtime-control/admission.js";
import { parseRelocationCommand } from "../../src/server/storage/relocate.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const syntheticAdmission = () => RuntimeAdmission.syntheticFixture(":memory:", "authority");

describe("secure environment bootstrap", () => {
  it("parses only exact offline relocation selectors", () => {
    assert.deepEqual(parseRelocationCommand(["--status", "--json"]), { kind: "status", json: true });
    assert.throws(() => parseRelocationCommand(["--status", "extra"]), /storage-relocation-usage/u);
    assert.throws(() => parseRelocationCommand(["--resume", "latest"]), /storage-relocation-usage/u);
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
  it("resolves the admitted environment file from the bootstrap module when CWD changes", () => {
    const originalDirectory = process.cwd();
    const unrelatedDirectory = mkdtempSync(join(tmpdir(), "hrauto-bootstrap-cwd-"));
    try {
      process.chdir(unrelatedDirectory);
      assert.equal(repositoryEnvironmentFilePath(), join(REPO_ROOT, ".env.providers"));
    } finally {
      process.chdir(originalDirectory);
      rmSync(unrelatedDirectory, { recursive: true, force: true });
    }
  });

  it("admits only the repository-anchored environment file before running the smoke", async () => {
    let admittedPath: string | undefined;
    let smokeInvocations = 0;

    await runSecureEnvironmentBootstrap(["test-target-document-number"], {
      acquireAdmission: syntheticAdmission,
      admitEnvironmentFile: (path) => {
        admittedPath = path;
      },
      runTestTargetDocumentNumberSmoke: async () => {
        smokeInvocations += 1;
        return 0;
      },
    });

    assert.equal(admittedPath, join(REPO_ROOT, ".env.providers"));
    assert.equal(smokeInvocations, 1);
  });

  it.each([true, false])("ignores the reference file when runtime provider file present=%s", async (present) => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-provider-source-"));
    const reference = "CEREBRAS_API_KEY=unsupported-reference\nGEMINI_API_KEY=stale-reference\n";
    const original = [...process.argv];
    const env: NodeJS.ProcessEnv = {};
    let ran = false;
    try {
      writeFileSync(join(root, ".env"), reference, { mode: 0o600 });
      if (present) writeFileSync(join(root, ".env.providers"), "GEMINI_API_KEY=current-fixture\n", { mode: 0o600 });
      const launch = runSecureEnvironmentBootstrap(["cli"], {
        acquireAdmission: syntheticAdmission,
        assertEnvironment: () => {},
        admitEnvironmentFile: (path) => admitLocalEnvironmentFile(join(root, basename(path)), env),
        runCli: async () => { ran = true; },
      });
      if (present) {
        await launch;
        assert.equal(env.GEMINI_API_KEY, "current-fixture");
      } else {
        await assert.rejects(launch, /local environment file \.env\.providers is unavailable/u);
        assert.deepEqual(env, {});
      }
      assert.equal(ran, present);
      assert.equal(readFileSync(join(root, ".env"), "utf8"), reference);
    } finally {
      process.argv.splice(0, process.argv.length, ...original);
      rmSync(root, { recursive: true, force: true });
    }
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
        admitEnvironmentFile: () => events.push("open-env"),
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
    // D341: `test-data check` and `test-data migrate` read the private file and
    // the credential store only; neither may load provider `.env.providers`.
    ["test-data", "check"], ["test-data", "migrate"],
  ])("isolates %s %s from provider environment admission", async (command, operation) => {
    const original = [...process.argv]; const events: string[] = [];
    try {
      await runSecureEnvironmentBootstrap(["cli", command, operation], {
        acquireAdmission: syntheticAdmission,
        assertEnvironment: () => { throw new Error(`${command} must not read parent provider environment`); },
        admitEnvironmentFile: () => { throw new Error(`${command} must not open provider .env.providers`); },
        runCli: async () => { events.push(...process.argv.slice(2)); },
      });
      assert.deepEqual(events, [command, operation]);
    } finally { process.argv.splice(0, process.argv.length, ...original); }
  });

  it.each([
    ["backup", "shared"], ["doctor", "shared"], ["transactions", "shared"],
    ["upgrade", "exclusive"], ["restore", "exclusive"], ["repair", "exclusive"],
  ] as const)("holds %s admission in %s mode for the full CLI lifetime", async (operation, expectedMode) => {
    let finish: (() => void) | undefined;
    const running = new Promise<void>((resolve) => { finish = resolve; });
    let selectedMode: "shared" | "exclusive" | undefined;
    let held: RuntimeAdmission | undefined;
    const launch = runSecureEnvironmentBootstrap(["cli", "storage", operation], {
      acquireAdmission: (mode) => { selectedMode = mode; held = syntheticAdmission(); return held; },
      runCli: async () => { held?.assertLive(); await running; held?.assertLive(); },
    });
    try {
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
        admitEnvironmentFile: () => { throw new Error("relocation must not open provider file"); },
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
      [join(REPO_ROOT, "scripts", "smoke-test-target-document-number.ts")],
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
      pathToFileURL(join(REPO_ROOT, "scripts", "smoke-test-target-document-number.ts")).href,
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

    assert.equal(scripts.cli, "tsx scripts/secure-env-bootstrap.ts cli");
    assert.equal(
      scripts["dashboard:prod"],
      "tsx scripts/secure-env-bootstrap.ts cli dashboard --prod",
    );
    assert.equal(
      scripts["smoke:test-target-document-number"],
      "tsx scripts/secure-env-bootstrap.ts test-target-document-number",
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
    // The retired person-secret selector is refused like any other arbitrary
    // string (D300): the smoke it named no longer exists, and a bootstrap that
    // still accepted it would resolve to nothing at all.
    for (const refused of [
      "../../src/arbitrary.ts",
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
