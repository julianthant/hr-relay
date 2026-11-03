import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "vitest";
import { BUILD_MANIFEST_PATH } from "../../../src/models/workflow/build-manifest.js";
import { scaledMs } from "../../support/time-scale.js";
import { testProcessImport } from "../../support/compiled-process.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "relay-manifest-tools-"));
  try {
    for (const path of ["src", "scripts", "config", "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "vite.dashboard.config.ts", "vite.parity.config.ts",
      "tests/support/time-scale.ts", "tests/parity/helpers/bundle.ts", "tests/support/helpers/dashboard/profiles/bundle-setup.ts"]) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(REPO_ROOT, path), target, { recursive: true,
        filter: source => source !== join(REPO_ROOT, BUILD_MANIFEST_PATH) && !source.endsWith("test-data.local.json") });
    }
    mkdirSync(join(root, "node_modules"));
    for (const entry of readdirSync(join(REPO_ROOT, "node_modules"), { withFileTypes: true })) {
      if (entry.isDirectory() && (!entry.name.startsWith(".") || entry.name === ".bin")) {
        symlinkSync(join(REPO_ROOT, "node_modules", entry.name), join(root, "node_modules", entry.name), "junction");
      }
    }
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function node(root: string, source: string) {
  return spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", source],
    { cwd: root, encoding: "utf8", timeout: scaledMs(25_000) });
}

function imported(root: string, path: string): string {
  return JSON.stringify(pathToFileURL(join(root, path)).href);
}

function assertSuccess(result: ReturnType<typeof node>): void {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
}

describe("manifest preparation boundaries", () => {
  for (const config of ["vitest.config.ts", "vite.dashboard.config.ts", "vite.parity.config.ts", "tests/parity/helpers/bundle.ts"]) {
    it(`prepares an artifact-free checkout before ${config} exposes its consumers`, () => {
      fixture(root => {
        assert.equal(existsSync(join(root, BUILD_MANIFEST_PATH)), false);
        const registry = join(root, "src/workflows/generated-descriptors.ts");
        writeFileSync(registry, "deliberately stale tracked registry\n");
        const result = node(root, `await import(${imported(root, config)}); await import(${imported(root, "src/workflow-kit/validation/build-manifest.ts")});`);
        assertSuccess(result);
        assert.equal(readFileSync(registry, "utf8"), "deliberately stale tracked registry\n");
        assert.ok(readFileSync(join(root, BUILD_MANIFEST_PATH), "utf8").includes("GENERATED_BUILD_MANIFEST"));
      });
    });
  }

  it("prepares during raw Vitest listing for every project, including a cached nonintegration PC slot", () => {
    fixture(root => {
      const put = (path: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), 'import "../src/workflow-kit/validation/build-manifest.js";\n');
      };
      for (const path of ["tests/smoke.test.ts", "tests/smoke.integration.test.ts", "tests/smoke.local.test.ts", "tests/architecture/smoke.test.ts", "tests/perf/smoke.test.ts"]) put(path);
      const output = join(root, "listed.json");
      const list = () => spawnSync(process.execPath, [join(REPO_ROOT, "node_modules/vitest/vitest.mjs"), "list", "--filesOnly", `--json=${output}`], { cwd: root, encoding: "utf8" });
      assertSuccess(list());
      const listed: unknown = JSON.parse(readFileSync(output, "utf8"));
      assert.ok(Array.isArray(listed));
      assert.equal(listed.length, 5);
      const first = readFileSync(join(root, BUILD_MANIFEST_PATH), "utf8");
      rmSync(join(root, BUILD_MANIFEST_PATH));
      assertSuccess(list());
      assert.equal(readFileSync(join(root, BUILD_MANIFEST_PATH), "utf8"), first);
    });
  });

  it("prepares before raw Vitest imports a runtime consumer in a fresh checkout", () => {
    fixture(root => {
      for (const path of ["tests/support/private-temp-setup.ts", "tests/support/compiled-process-setup.ts", "tests/support/compiled-process-loader.ts", "tests/support/duo-ceremony-setup.ts",
        "tests/support/helpers/duo-ceremony-cleanup.ts", "tests/support/helpers/credential-keychain-fake.ts", "tests/support/helpers/credential-keychain-process-preload.mjs"]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        cpSync(join(REPO_ROOT, path), join(root, path));
      }
      writeFileSync(join(root, "tests/smoke.test.ts"), `
        import { it, expect } from 'vitest';
        import { BUILD_MANIFEST } from '../src/workflow-kit/validation/build-manifest.js';
        it('loads the prepared runtime manifest', () => expect(BUILD_MANIFEST.workflows.length).toBeGreaterThan(0));
      `);
      assert.equal(existsSync(join(root, BUILD_MANIFEST_PATH)), false);
      assertSuccess(spawnSync(process.execPath, [join(REPO_ROOT, "node_modules/vitest/vitest.mjs"), "run", "--project", "unit", "--maxWorkers=1", "tests/smoke.test.ts"],
        { cwd: root, encoding: "utf8", timeout: scaledMs(25_000) }));
    });
  });

  it("prepares parity before its first input digest and before process precompilation", () => {
    fixture(root => {
      for (const path of ["tests/parity/app-entry.tsx", "tests/parity/helpers/workflow-composition.ts"]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), "export {};\n");
      }
      mkdirSync(join(root, "tests/support/helpers/dashboard/controls"), { recursive: true });
      const result = node(root, `
        import assert from 'node:assert/strict';
        import { existsSync, readFileSync } from 'node:fs';
        const bundle = await import(${imported(root, "tests/parity/helpers/bundle.ts")});
        assert.ok(existsSync(${JSON.stringify(join(root, BUILD_MANIFEST_PATH))}));
        assert.match(bundle.computeBundleInputDigest(${JSON.stringify(root)}), /^[a-f0-9]{64}$/);
        const setup = readFileSync(${JSON.stringify(join(REPO_ROOT, "tests/parity/helpers/global-setup.ts"))}, 'utf8');
        assert.ok(setup.indexOf('import { ensureParityBundle }') < setup.indexOf('await setup()'));
      `);
      assertSuccess(result);
    });
  });

  it("atomically converges overlapping preparation without rewriting unchanged output", () => {
    fixture(root => {
      const result = node(root, `
        import { spawn } from 'node:child_process';
        import { once } from 'node:events';
        const generator = ${JSON.stringify(join(root, "scripts/build/generate-workflow-manifest.ts"))};
        await Promise.all([1, 2].map(async () => {
          const child = spawn(process.execPath, ['--import', ${JSON.stringify(testProcessImport())}, generator], { stdio: 'pipe' });
          const [code, signal] = await once(child, 'exit');
          if (code !== 0 || signal !== null) throw new Error('parallel preparation failed');
        }));
      `);
      assertSuccess(result);
      const target = join(root, BUILD_MANIFEST_PATH), before = statSync(target).mtimeMs;
      assertSuccess(node(root, `await import(${imported(root, "scripts/build/generate-workflow-manifest.ts")});`));
      assert.equal(statSync(target).mtimeMs, before);
      assert.deepEqual(readdirSync(dirname(target)).filter(path => path.endsWith(".tmp")), []);
      assertSuccess(node(root, `process.argv.push('--check'); await import(${imported(root, "scripts/build/generate-workflow-manifest.ts")});`));
    });
  });
});

it("pins package prehooks and consuming CI checkout preparation without autohealing checks", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  for (const name of ["cli", "dashboard", "dashboard:prod", "smoke:test-target-document-number", "typecheck", "lint", "perf:dashboard", "stores:catalog"]) {
    assert.equal(pkg.scripts[`pre${name}`], "npm run build:manifest:prepare");
  }
  assert.equal(pkg.scripts["build:manifest:prepare"], "tsx scripts/build/generate-workflow-manifest.ts");
  assert.equal(pkg.scripts["build:manifest:check"], "tsx scripts/build/generate-workflow-manifest.ts --check");
  for (const name of ["build:manifest:check", "build:registries:check", "stores:catalog:check"]) assert.equal(pkg.scripts[`pre${name}`], undefined);
  const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci-checks.yml"), "utf8");
  for (const name of ["static", "ubuntu", "macos", "release"]) {
    const job = ci.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z]+:\n/u)[0];
    assert.ok(job, name);
    assert.match(job, /- run: npm ci\n {6}- run: npm run build:manifest:prepare/u);
  }
  assert.match(ci, /npm run build:registries:check/u);
});

it("prepares the cold train catalog consumer after registry generation while its check stays read-only", () => {
  fixture(root => {
    const catalog = "docs/rebuild/reference/stores.md";
    mkdirSync(dirname(join(root, catalog)), { recursive: true });
    cpSync(join(REPO_ROOT, catalog), join(root, catalog));
    const npm = (script: string) => spawnSync("npm", ["run", script], { cwd: root, encoding: "utf8", timeout: scaledMs(25_000) });
    assertSuccess(npm("build:registries"));
    assert.equal(existsSync(join(root, BUILD_MANIFEST_PATH)), false);
    const registry = join(root, "src/workflows/generated-descriptors.ts");
    const bytes = readFileSync(registry, "utf8");
    const check = npm("stores:catalog:check");
    assert.notEqual(check.status, 0);
    assert.match(check.stderr, /generated-build-manifest/u);
    assert.equal(existsSync(join(root, BUILD_MANIFEST_PATH)), false);
    assertSuccess(npm("stores:catalog"));
    assert.equal(readFileSync(registry, "utf8"), bytes);
    assert.ok(existsSync(join(root, BUILD_MANIFEST_PATH)));
    assertSuccess(npm("stores:catalog:check"));
  });
});

for (const tool of ["vitest", "vite"] as const) {
  it(`keeps a ${tool} watch session's prepared snapshot until a fresh session starts`, () => {
    fixture(root => {
      const open = tool === "vite"
        ? `const { createServer } = await import('vite'); const session = await createServer({ configFile: ${JSON.stringify(join(root, "vite.dashboard.config.ts"))}, server: { hmr: false }, logLevel: 'silent' });`
        : `const { createVitest } = await import('vitest/node'); const session = await createVitest('test', { config: ${JSON.stringify(join(root, "vitest.config.ts"))}, watch: true, project: ['unit'] });`;
      assertSuccess(node(root, `
        import assert from 'node:assert/strict';
        import { spawnSync } from 'node:child_process';
        import { appendFileSync, readFileSync } from 'node:fs';
        const target = ${JSON.stringify(join(root, BUILD_MANIFEST_PATH))};
        const start = async () => { ${open} return session; };
        const first = await start();
        let before;
        try {
          before = readFileSync(target, 'utf8');
          appendFileSync(${JSON.stringify(join(root, "src/workflows/person-lookup/workflow.ts"))}, '\\n// changed fingerprint input\\n');
          const check = spawnSync(process.execPath, ['--import', ${JSON.stringify(testProcessImport())}, ${JSON.stringify(join(root, "scripts/build/generate-workflow-manifest.ts"))}, '--check'], { encoding: 'utf8' });
          assert.equal(check.status, 1, check.stderr);
          assert.equal(readFileSync(target, 'utf8'), before);
        } finally { await first.close(); }
        const restarted = await start();
        try { assert.notEqual(readFileSync(target, 'utf8'), before); } finally { await restarted.close(); }
      `));
    });
  });
}
