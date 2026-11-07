import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { createVitest } from "vitest/node";
import type * as PrivateTempSetup from "./private-temp-setup.js";

it("reuses one private root across project setup and removes only its own invocation", async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "temp-setup-")));
  const peer = join(parent, "peer");
  writeFileSync(peer, "preserved");
  const keys = ["TMPDIR", "TMP", "TEMP", "RELAY_TEST_PROCESS_IMPORT", "KEEP_TEST_TMP"];
  const environment = keys.map(key => [key, process.env[key]] as const);
  const contexts: Awaited<ReturnType<typeof createVitest>>[] = [];
  const teardowns: (() => void)[] = [];
  const roots: string[] = [];
  try {
    for (let invocation = 0; invocation < 2; invocation++) {
      for (const key of ["TMPDIR", "TMP", "TEMP"]) process.env[key] = parent;
      delete process.env.RELAY_TEST_PROCESS_IMPORT;
      delete process.env.KEEP_TEST_TMP;
      const context = await createVitest("test", {
        config: resolve(import.meta.dirname, "../../vitest.config.ts"),
        watch: false, maxWorkers: 1, project: ["unit", "integration", "architecture"],
      });
      contexts.push(context);
      assert.equal(context.projects.length, 3);
      for (const project of [...context.projects, context.getRootProject()]) {
        for (const path of project.config.globalSetup) {
          const setup = await project.import<typeof PrivateTempSetup>(path);
          teardowns.push(setup.teardown);
          await setup.setup();
          const directory = realpathSync(tmpdir());
          assert.equal(dirname(directory), parent, "project setup must not nest private roots");
          assert.match(directory, /[/\\]hrt-[^/\\]+$/u);
          if (process.platform !== "win32") assert.equal(statSync(directory).mode & 0o777, 0o700);
          for (const key of ["TMPDIR", "TMP", "TEMP"]) {
            const value = process.env[key];
            assert.ok(value);
            assert.equal(realpathSync(value), directory);
          }
          const loader: string | undefined = process.env.RELAY_TEST_PROCESS_IMPORT;
          assert.ok(loader);
          assert.equal(dirname(dirname(fileURLToPath(loader))), directory);
          await setup.setup();
          assert.equal(realpathSync(tmpdir()), directory);
          assert.equal(process.env.RELAY_TEST_PROCESS_IMPORT, loader);
          roots.push(directory);
        }
      }
      assert.equal(roots.length, invocation + 1);
    }
    const [first, second] = roots;
    const [teardownFirst, teardownSecond] = teardowns;
    assert.ok(first && second);
    assert.notEqual(first, second);
    for (const root of roots) assert.ok(existsSync(root));
    process.env.KEEP_TEST_TMP = "1";
    teardownFirst();
    assert.ok(existsSync(first));
    delete process.env.KEEP_TEST_TMP;
    teardownFirst();
    assert.equal(existsSync(first), false);
    assert.ok(existsSync(second));
    assert.ok(existsSync(peer));
    teardownSecond();
    assert.equal(existsSync(second), false);
    assert.ok(existsSync(peer));
  } finally {
    delete process.env.KEEP_TEST_TMP;
    for (const teardown of teardowns.reverse()) teardown();
    for (const context of contexts.reverse()) await context.close();
    for (const [key, value] of environment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(parent, { recursive: true, force: true });
  }
});
