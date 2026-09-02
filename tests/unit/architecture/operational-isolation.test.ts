import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import isolationJson from "../../../config/runtime-isolation.json" with { type: "json" };
import { REPO_ROOT } from "./helpers/guard-files.js";
import {
  FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
  frozenLegacyScripts,
  parseFrozenLegacyArchitectureProvenance,
} from "./helpers/frozen-legacy-architecture-provenance.js";
import {
  auditOperationalIsolation,
  DISTINCT_RESOURCE_KEYS,
  type OperationalIsolationContract,
} from "./helpers/operational-isolation-audit.js";

/**
 * D88's surviving half, after D93 made the other half structurally impossible.
 *
 * The retired arm scanned both trees for cross-runtime imports, process spawns,
 * filesystem/state reads, HTTP calls, and route proxies. Two repositories share
 * no module graph, so those are no longer violations to catch — they are
 * expressions that cannot resolve. That retirement is recorded in the guard
 * inventory as an explicit replacement (ref guards-and-tests §3.13), and THIS file is the
 * replacement.
 *
 * What a repo boundary does NOT give you: both runtimes still execute on one
 * machine. A shared port, process lock, state root, or Chromium profile is a
 * real collision. Those stay gated exactly as hard as before. Command NAMES are
 * not a resource (D247): the rebuild's launch commands are plain `dashboard`,
 * `dashboard:prod`, `cli`, and what is still pinned is that each declared
 * command is byte-exactly the script in its own checkout's package.json.
 */

const isolation = isolationJson as unknown as OperationalIsolationContract;

function scriptsOf(root: string): Record<string, string> {
  return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }).scripts;
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function seedValidRuntime(root: string): void {
  const side = isolation.rebuild;
  const config = side.runtimeConfig;
  assert.ok(config);
  write(root, "src/config/define-runtime-isolation.ts",
    "export function defineRuntimeIsolation<T>(value: T): T { return value; }\n");
  write(root, config.module, [
    `import { ${config.factory} } from "./define-runtime-isolation.js";`,
    `export const ${config.exportName} = ${config.factory}({`,
    `  stateRoot: ${JSON.stringify(side.stateRoot)},`,
    `  artifactRoot: ${JSON.stringify(side.artifactRoot)},`,
    `  backendPort: ${String(side.backendPort)},`,
    `  frontendPort: ${String(side.frontendPort)},`,
    `  processLockRoot: ${JSON.stringify(side.processLockRoot)},`,
    `  browserProfileRoot: ${JSON.stringify(side.browserProfileRoot)},`,
    `  browserSessionNamespace: ${JSON.stringify(side.browserSessionNamespace)},`,
    "});",
    "",
  ].join("\n"));
  write(root, "src/core/runtime-composition.ts",
    "export function startRebuildRuntime(_input: { isolation: unknown }): void {}\n");
  write(root, "src/cli.ts", [
    `import { ${config.exportName} } from "./config/runtime-isolation.js";`,
    'import { startRebuildRuntime } from "./core/runtime-composition.js";',
    `export function runCli(): void { startRebuildRuntime({ isolation: ${config.exportName} }); }`,
    "",
  ].join("\n"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ scripts: side.commands }, null, 2)}\n`);
}

function withFixture(callback: (root: string) => void): void {
  const root = join(tmpdir(), `hrauto-operational-isolation-${String(process.pid)}`);
  rmSync(root, { recursive: true, force: true });
  try {
    seedValidRuntime(root);
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fixtureViolations(root: string): string[] {
  return auditOperationalIsolation(root, isolation, scriptsOf(root), isolation.legacy.commands)
    .map(({ detail }) => detail);
}

describe("operational isolation", () => {
  it("pins two runtimes that share no resource on this machine", () => {
    assert.equal(isolation.schemaVersion, 3);
    for (const key of DISTINCT_RESOURCE_KEYS) {
      assert.notEqual(isolation.legacy[key], isolation.rebuild[key], `${key} must differ`);
    }
    assert.notEqual(isolation.legacy.backendPort, isolation.rebuild.backendPort);
    assert.notEqual(isolation.legacy.frontendPort, isolation.rebuild.frontendPort);

    // D247: the rebuild's commands are plain and every declared one is audited
    // for drift against its own checkout's scripts (below) — the NAMES may
    // coincide with legacy's.
    assert.deepEqual(Object.keys(isolation.rebuild.commands), ["dashboard", "dashboard:prod", "cli"]);
  });

  it("audits the rebuild checkout against the frozen legacy launch scripts", () => {
    assert.deepEqual(
      auditOperationalIsolation(
        REPO_ROOT,
        isolation,
        scriptsOf(REPO_ROOT),
        frozenLegacyScripts(),
      ),
      [],
    );
  });

  it("refuses a changed legacy package script when its recorded blob is unchanged", () => {
    const tampered = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as Record<string, unknown>;
    const operationalIsolation = tampered.operationalIsolation as Record<string, unknown>;
    const legacyPackage = operationalIsolation.package as Record<string, unknown>;
    legacyPackage.text = String(legacyPackage.text).replace(
      '"dashboard": "tsx --env-file=.env src/cli.ts dashboard --capture-ngrok"',
      '"dashboard": "tampered"',
    );
    assert.throws(() => parseFrozenLegacyArchitectureProvenance(tampered), /frozen legacy blob mismatch/i);
  });

  it("requires an exported direct-const factory call carrying the exact isolated values", () => {
    withFixture((root) => {
      assert.deepEqual(fixtureViolations(root), []);

      const config = isolation.rebuild.runtimeConfig;
      assert.ok(config);

      // A drifted literal is not the declared runtime.
      write(root, config.module, readFileSync(join(root, config.module), "utf8")
        .replace(JSON.stringify(isolation.rebuild.stateRoot), JSON.stringify(".tracker")));
      assert.match(fixtureViolations(root).join("\n"), /exact isolated values/);
      seedValidRuntime(root);

      // A locally shadowed factory is not the imported factory.
      write(root, config.module, [
        `function ${config.factory}<T>(value: T): T { return value; }`,
        readFileSync(join(root, config.module), "utf8"),
      ].join("\n"));
      assert.match(fixtureViolations(root).join("\n"), /exact isolated values/);
      seedValidRuntime(root);

      // A non-exported binding is not a durable declaration.
      write(root, config.module, readFileSync(join(root, config.module), "utf8")
        .replace(`export const ${config.exportName}`, `const ${config.exportName}`));
      assert.match(fixtureViolations(root).join("\n"), /exact isolated values/);
    });
  });

  it("requires the declared exported runner to call the binding", () => {
    withFixture((root) => {
      const config = isolation.rebuild.runtimeConfig;
      assert.ok(config);

      // Mention without invocation.
      write(root, "src/cli.ts", [
        `import { ${config.exportName} } from "./config/runtime-isolation.js";`,
        'import { startRebuildRuntime } from "./core/runtime-composition.js";',
        `export const unused = [${config.exportName}, startRebuildRuntime];`,
        "",
      ].join("\n"));
      assert.match(fixtureViolations(root).join("\n"), /must export runCli with one direct factory call/);
      seedValidRuntime(root);

      // A call hidden inside the wrong exported function is not the declared runner.
      write(root, "src/cli.ts", [
        `import { ${config.exportName} } from "./config/runtime-isolation.js";`,
        'import { startRebuildRuntime } from "./core/runtime-composition.js";',
        `export function main(): void { startRebuildRuntime({ isolation: ${config.exportName} }); }`,
        "",
      ].join("\n"));
      assert.match(fixtureViolations(root).join("\n"), /must export runCli with one direct factory call/);
      seedValidRuntime(root);

      // The wrong binding argument path.
      write(root, "src/cli.ts", [
        `import { ${config.exportName} } from "./config/runtime-isolation.js";`,
        'import { startRebuildRuntime } from "./core/runtime-composition.js";',
        `export function runCli(): void { startRebuildRuntime({ notIsolation: ${config.exportName} }); }`,
        "",
      ].join("\n"));
      assert.match(fixtureViolations(root).join("\n"), /must export runCli with one direct factory call/);
    });
  });

  it("rejects a drifted or missing launch command on either side", () => {
    withFixture((root) => {
      const scripts = scriptsOf(root);
      const [first] = Object.keys(scripts);
      assert.ok(first);
      const drifted = { ...scripts, [first]: "tsx --env-file=.env src/cli.ts dashboard --capture-ngrok" };
      assert.match(
        auditOperationalIsolation(root, isolation, drifted, isolation.legacy.commands)
          .map(({ detail }) => detail).join("\n"),
        new RegExp(`${first} must equal`),
      );
      assert.match(
        auditOperationalIsolation(root, isolation, scripts, {})
          .map(({ detail }) => detail).join("\n"),
        /dashboard must equal/,
      );
    });
  });
});
