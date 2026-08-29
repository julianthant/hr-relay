import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { secureEnvironmentEntrypoint } from "../../scripts/secure-env-bootstrap.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("secure environment bootstrap", () => {
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
      scripts["smoke:test-target-person-secrets"],
      "tsx scripts/secure-env-bootstrap.ts test-target-person-secrets",
    );
    assert.equal(
      Object.values(scripts).some((command) => command.includes("--env-file")),
      false,
    );
  });

  it("refuses every entrypoint selector outside the closed CLI and canary-smoke set", () => {
    assert.equal(secureEnvironmentEntrypoint("cli"), "cli");
    assert.equal(
      secureEnvironmentEntrypoint("test-target-person-secrets"),
      "test-target-person-secrets",
    );
    assert.throws(
      () => secureEnvironmentEntrypoint("../../src/arbitrary.ts"),
      /secure environment entrypoint must be cli or test-target-person-secrets/,
    );
    assert.throws(
      () => secureEnvironmentEntrypoint(undefined),
      /secure environment entrypoint must be cli or test-target-person-secrets/,
    );
  });
});
