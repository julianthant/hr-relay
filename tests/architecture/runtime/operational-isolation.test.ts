import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import isolationJson from "../../../config/runtime-isolation.json" with { type: "json" };
import { REPO_ROOT } from "../support/helpers/guard-files.js";
import {
  auditOperationalIsolation,
  DISTINCT_RESOURCE_KEYS,
  type OperationalIsolationContract,
} from "./helpers/operational-isolation-audit.js";



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
  write(root, "src/models/config/define-runtime-isolation.ts",
    "export function defineRuntimeIsolation<T>(value: T): T { return value; }\n");
  write(root, config.module, [
    `import { ${config.factory} } from "../../../models/config/define-runtime-isolation.js";`,
    `export const ${config.exportName} = ${config.factory}({`,
    `  stateRoot: ${JSON.stringify(side.stateRoot)},`,
    ...(side.archiveDatabaseFile === undefined ? [] : [`  archiveDatabaseFile: ${JSON.stringify(side.archiveDatabaseFile)},`]),
    `  artifactRoot: ${JSON.stringify(side.artifactRoot)},`,
    `  backendPort: ${String(side.backendPort)},`,
    `  frontendPort: ${String(side.frontendPort)},`,
    `  processLockRoot: ${JSON.stringify(side.processLockRoot)},`,
    `  browserProfileRoot: ${JSON.stringify(side.browserProfileRoot)},`,
    `  browserSessionNamespace: ${JSON.stringify(side.browserSessionNamespace)},`,
    "});",
    "",
  ].join("\n"));
  write(root, "src/backend/app/composition/runtime-composition.ts",
    "export function startRebuildRuntime(_input: { isolation: unknown }): void {}\n");
  write(root, "src/cli.ts", [
    `import { ${config.exportName} } from "./backend/app/config/runtime-isolation.js";`,
    'import { startRebuildRuntime } from "./backend/app/composition/runtime-composition.js";',
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


    assert.deepEqual(Object.keys(isolation.rebuild.commands), ["dashboard", "dashboard:prod", "cli"]);
  });

  it("audits the rebuild checkout against the configured isolated launch scripts", () => {
    assert.deepEqual(
      auditOperationalIsolation(
        REPO_ROOT,
        isolation,
        scriptsOf(REPO_ROOT),
        isolation.legacy.commands,
      ),
      [],
    );
  });



  it("requires an exported direct-const factory call carrying the exact isolated values", () => {
    withFixture((root) => {
      assert.deepEqual(fixtureViolations(root), []);

      const config = isolation.rebuild.runtimeConfig;
      assert.ok(config);

      // A drifted literal is not the declared runtime.
      write(root, config.module, readFileSync(join(root, config.module), "utf8")
        .replace(JSON.stringify(isolation.rebuild.stateRoot), JSON.stringify(".tracker-drift")));
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
        `import { ${config.exportName} } from "./backend/app/config/runtime-isolation.js";`,
        'import { startRebuildRuntime } from "./backend/app/composition/runtime-composition.js";',
        `export const unused = [${config.exportName}, startRebuildRuntime];`,
        "",
      ].join("\n"));
      assert.match(fixtureViolations(root).join("\n"), /must export runCli with one direct factory call/);
      seedValidRuntime(root);

      // A call hidden inside the wrong exported function is not the declared runner.
      write(root, "src/cli.ts", [
        `import { ${config.exportName} } from "./backend/app/config/runtime-isolation.js";`,
        'import { startRebuildRuntime } from "./backend/app/composition/runtime-composition.js";',
        `export function main(): void { startRebuildRuntime({ isolation: ${config.exportName} }); }`,
        "",
      ].join("\n"));
      assert.match(fixtureViolations(root).join("\n"), /must export runCli with one direct factory call/);
      seedValidRuntime(root);

      // The wrong binding argument path.
      write(root, "src/cli.ts", [
        `import { ${config.exportName} } from "./backend/app/config/runtime-isolation.js";`,
        'import { startRebuildRuntime } from "./backend/app/composition/runtime-composition.js";',
        `export function runCli(): void { startRebuildRuntime({ notIsolation: ${config.exportName} }); }`,
        "",
      ].join("\n"));
      assert.match(fixtureViolations(root).join("\n"), /must export runCli with one direct factory call/);
    });
  });

  it("admits only the exact live RuntimeAdmission parameter alongside the zero-parameter fixture", () => {
    withFixture(root => {
      assert.deepEqual(fixtureViolations(root), []);
      const source = readFileSync(join(root, "src/cli.ts"), "utf8")
        .replace('export function runCli(): void {', 'export function runCli(admission: RuntimeAdmission): void { admission.assertLive();');
      const admitted = 'import type { RuntimeAdmission } from "./backend/storage/admission/admission.js";\n' + source;
      write(root, "src/backend/storage/admission/admission.ts", "export interface RuntimeAdmission { assertLive(): void; }\n");
      write(root, "src/cli.ts", admitted);
      assert.deepEqual(fixtureViolations(root), []);
      const custody = 'import type { RuntimeProcessLockHandle } from "./backend/storage/sqlite/runtime-process-locks.js";\n'
        + admitted.replace('admission: RuntimeAdmission', 'admission: RuntimeAdmission, takeInitialCustody?: () => RuntimeProcessLockHandle | undefined');
      write(root, "src/backend/storage/sqlite/runtime-process-locks.ts", "export interface RuntimeProcessLockHandle { release(): void; }\n");
      write(root, "src/cli.ts", custody);
      assert.deepEqual(fixtureViolations(root), []);
      const dashboard = custody.replace('RuntimeProcessLockHandle | undefined', 'RuntimeProcessLockHandle | undefined, acceptDashboardAdmission?: () => void');
      write(root, "src/cli.ts", dashboard);
      assert.deepEqual(fixtureViolations(root), []);
      for (const invalid of [
        dashboard.replace('acceptDashboardAdmission?', 'otherAdmission?'),
        dashboard.replace('acceptDashboardAdmission?:', 'acceptDashboardAdmission:'),
        dashboard.replace('acceptDashboardAdmission?: () => void', 'acceptDashboardAdmission?: (value: unknown) => void'),
        dashboard.replace('acceptDashboardAdmission?: () => void', 'acceptDashboardAdmission?: () => unknown'),
        dashboard.replace('takeInitialCustody?', 'otherCustody?'),
        dashboard.replace('acceptDashboardAdmission?: () => void', 'acceptDashboardAdmission?: () => void, extra?: unknown'),
        custody.replace('takeInitialCustody?', 'otherCustody?'),
        custody.replace('RuntimeProcessLockHandle | undefined', 'unknown'),
        custody.replace('./backend/storage/sqlite/runtime-process-locks.js', './wrong-locks.js'),
        custody.replace('takeInitialCustody?:', 'takeInitialCustody:'),
        custody.replace('import type { RuntimeProcessLockHandle }', 'import type { Other as RuntimeProcessLockHandle }'),
        admitted.replace('admission: RuntimeAdmission', 'arbitrary: RuntimeAdmission'),
        admitted.replace('admission: RuntimeAdmission', 'admission: unknown'),
        admitted.replace('admission: RuntimeAdmission', 'admission: RuntimeAdmission, extra: unknown'),
        admitted.replace('./backend/storage/admission/admission.js', './wrong-admission.js'),
        admitted.replace('admission.assertLive();', ''),
        admitted.replace('admission.assertLive();', 'admission.assertLive("unchecked");'),
        admitted.replace('import type { RuntimeAdmission }', 'import type { Other as RuntimeAdmission }'),
      ]) {
        write(root, "src/cli.ts", invalid);
        assert.match(fixtureViolations(root).join("\n"), /must export runCli with one direct factory call/);
      }
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
