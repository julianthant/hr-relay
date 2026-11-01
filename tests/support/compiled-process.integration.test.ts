import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it, onTestFinished } from "vitest";
import { testProcessImport } from "./compiled-process.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "compiled-child-")));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, ["--import", testProcessImport(), ...args], { cwd: root, encoding: "utf8", env: {} });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  return { root, run };
}

it("loads precompiled dependencies without rebuilding and preserves module paths and direct argv", () => {
  const { root, run } = fixture();
  const path = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
  const cache = dirname(fileURLToPath(testProcessImport()));
  const snapshot = () => readdirSync(cache).sort().map(name => [name, statSync(join(cache, name)).mtimeMs]);
  const before = snapshot();
  assert.equal(run(path), "");
  assert.deepEqual(snapshot(), before);
  const entry = join(root, "entry.ts");
  writeFileSync(entry, "const value: number = 42; process.stdout.write(JSON.stringify([value, import.meta.url, import.meta.dirname, process.argv[1]]));");
  assert.deepEqual(JSON.parse(run(entry)), [42, pathToFileURL(entry).href, root, entry]);
  const warmed = snapshot();
  assert.deepEqual(JSON.parse(run(entry)), [42, pathToFileURL(entry).href, root, entry]);
  assert.deepEqual(snapshot(), warmed);
});

it("invalidates changed entry and dependency bytes, including copies and .js-to-.ts imports", () => {
  const { root, run } = fixture();
  const dependency = join(root, "dependency.ts"), entry = join(root, "entry.ts");
  writeFileSync(dependency, "export const value: number = 1;");
  writeFileSync(entry, "import { value } from './dependency.js'; process.stdout.write(String(value));");
  assert.equal(run(entry), "1");
  writeFileSync(dependency, "export const value: number = 2;");
  assert.equal(run(entry), "2");
  const copy = join(root, "copy.ts");
  writeFileSync(copy, readFileSync(entry));
  assert.equal(run(copy), "2");
  writeFileSync(entry, "enum State { Ready = 3 }; process.stdout.write(String(State.Ready));");
  assert.equal(run(entry), "3");
  rmSync(dependency);
  writeFileSync(join(root, "dependency.tsx"), "export const value: number = 4;");
  writeFileSync(entry, `import { value } from ${JSON.stringify(join(root, "dependency.js"))}; process.stdout.write(String(value));`);
  assert.equal(run(entry), "4");
});

it("preserves explicit source syntax and missing-import failures", () => {
  const { root } = fixture();
  const path = join(root, "broken.ts");
  for (const source of ["const invalid: = ;", "import './absent.js';"]) {
    writeFileSync(path, source);
    const result = spawnSync(process.execPath, ["--import", testProcessImport(), path], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Transform failed|ERR_MODULE_NOT_FOUND/u);
  }
});
