import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  repositoryEnvironmentFilePath,
  runSecureEnvironmentBootstrap,
  secureEnvironmentEntrypoint,
} from "../../scripts/secure-env-bootstrap.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");

describe("secure environment bootstrap", () => {
  it("resolves the admitted environment file from the bootstrap module when CWD changes", () => {
    const originalDirectory = process.cwd();
    const unrelatedDirectory = mkdtempSync(join(tmpdir(), "hrauto-bootstrap-cwd-"));
    try {
      process.chdir(unrelatedDirectory);
      assert.equal(repositoryEnvironmentFilePath(), join(REPO_ROOT, ".env"));
    } finally {
      process.chdir(originalDirectory);
      rmSync(unrelatedDirectory, { recursive: true, force: true });
    }
  });

  it("admits only the repository-anchored environment file before running the smoke", async () => {
    let admittedPath: string | undefined;
    let smokeInvocations = 0;

    await runSecureEnvironmentBootstrap(["test-target-document-number"], {
      admitEnvironmentFile: (path) => {
        admittedPath = path;
      },
      runTestTargetDocumentNumberSmoke: async () => {
        smokeInvocations += 1;
        return 0;
      },
    });

    assert.equal(admittedPath, join(REPO_ROOT, ".env"));
    assert.equal(smokeInvocations, 1);
  });

  it("refuses the parent environment before opening .env or starting a runner", async () => {
    const events: string[] = [];
    await assert.rejects(
      runSecureEnvironmentBootstrap(["cli"], {
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
    // the credential store only; neither may load provider `.env`.
    ["test-data", "check"], ["test-data", "migrate"],
  ])("isolates %s %s from provider environment admission", async (command, operation) => {
    const original = [...process.argv]; const events: string[] = [];
    try {
      await runSecureEnvironmentBootstrap(["cli", command, operation], {
        assertEnvironment: () => { throw new Error(`${command} must not read parent provider environment`); },
        admitEnvironmentFile: () => { throw new Error(`${command} must not open provider .env`); },
        runCli: async () => { events.push(...process.argv.slice(2)); },
      });
      assert.deepEqual(events, [command, operation]);
    } finally { process.argv.splice(0, process.argv.length, ...original); }
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
