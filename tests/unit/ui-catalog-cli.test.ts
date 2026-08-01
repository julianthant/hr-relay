import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { afterAll, describe, it } from "vitest";
import { buildSafeUiCatalog } from "../../src/stores/ucpath/driver/catalog.js";

/**
 * Behavioural fixtures for the two 1d maintenance CLIs that close the legacy
 * `src/scripts/selectors/*` capabilities (`ui:catalog`, `selector:search`).
 * Doc 07 §3.6 requires behavioural CLI fixtures and help output for a native or
 * replaced CLI disposition, so these exercise the real entry points as child
 * processes rather than re-testing the library functions in-process.
 */
// Every case here spawns `tsx` as a child process, which is slow on its own and
// slower still under coverage instrumentation and full-suite fork parallelism.
// The work is real — these are behavioural CLI fixtures, not library calls — so
// the budget moves rather than the fixtures narrowing to in-process tests.
const CLI_TIMEOUT_MS = 180_000;
const run = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "../..");
const CATALOG_JSON = resolve(REPO_ROOT, "generated/ui-catalog.json");
const CATALOG_MARKDOWN = resolve(REPO_ROOT, "src/stores/ucpath/UI-CATALOG.md");

async function tsx(script: string, args: readonly string[] = []): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  try {
    const { stdout, stderr } = await run("npx", ["tsx", script, ...args], { cwd: REPO_ROOT });
    return { code: 0, stdout, stderr };
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string };
    // A non-zero exit is an expected assertion target here, but a spawn error
    // (no `code`, no captured output) is a broken harness and must surface.
    if (typeof failure.code !== "number") throw cause;
    return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

/** Restore whatever the generator last wrote, so a mutated fixture cannot leak. */
async function regenerate(): Promise<void> {
  const result = await tsx("scripts/generate-ui-catalog.ts");
  assert.equal(result.code, 0, result.stderr);
}

describe("ui:catalog CLI", { timeout: CLI_TIMEOUT_MS }, () => {
  afterAll(regenerate, CLI_TIMEOUT_MS);

  it("regenerates both projections and reports the entry count", async () => {
    const result = await tsx("scripts/generate-ui-catalog.ts");
    assert.equal(result.code, 0, result.stderr);
    const expected = buildSafeUiCatalog().entries.length;
    assert.match(result.stdout, new RegExp(`Generated ${String(expected)} semantic UI catalog entries\\.`));

    const written: unknown = JSON.parse(await readFile(CATALOG_JSON, "utf8"));
    assert.deepEqual(written, JSON.parse(JSON.stringify(buildSafeUiCatalog())));
    const markdown = await readFile(CATALOG_MARKDOWN, "utf8");
    assert.match(markdown, /ucpath\.person-org\./);
    // The generated projection must carry no private recipe payload: neither the
    // markdown nor the JSON may leak a locator selector or role recipe.
    const serialized = `${markdown}\n${JSON.stringify(written)}`;
    for (const secret of ["#PERSON_NPC_VW_EMPLID", "#main_target_win0", "Empl ID", "textbox"]) {
      assert.doesNotMatch(serialized, new RegExp(secret.replace(/[#$]/gu, "\\$&")), secret);
    }
  });

  it("is idempotent — a second run reproduces byte-identical output", async () => {
    await regenerate();
    const first = await readFile(CATALOG_JSON, "utf8");
    const firstMarkdown = await readFile(CATALOG_MARKDOWN, "utf8");
    await regenerate();
    assert.equal(await readFile(CATALOG_JSON, "utf8"), first);
    assert.equal(await readFile(CATALOG_MARKDOWN, "utf8"), firstMarkdown);
  });
});

describe("selector:search CLI", { timeout: CLI_TIMEOUT_MS }, () => {
  afterAll(regenerate, CLI_TIMEOUT_MS);

  it("prints usage and fails when no intent is supplied", async () => {
    const result = await tsx("scripts/search-ui.ts");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /usage: npm run selector:search -- "<intent>"/);
  });

  it("resolves operator language to the canonical semantic id", async () => {
    await regenerate();
    const result = await tsx("scripts/search-ui.ts", ["employee", "id", "field"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /ucpath\.person-org\.eid-input/);
    for (const line of result.stdout.trimEnd().split("\n")) {
      assert.match(line, /^\d+\t(element|screen|page-state|observation)\t\S+\t.+$/);
    }
  });

  it("fails loud on an intent nothing matches, instead of printing nothing", async () => {
    await regenerate();
    const result = await tsx("scripts/search-ui.ts", ["kuali", "budget", "attachment"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /no semantic UI facts matched intent/);
  });

  it("fails loud when the generated catalog is stale rather than searching it", async () => {
    await regenerate();
    const stale: unknown = JSON.parse(await readFile(CATALOG_JSON, "utf8"));
    assert.ok(stale !== null && typeof stale === "object" && "entries" in stale);
    const entries = Reflect.get(stale, "entries");
    assert.ok(Array.isArray(entries) && entries.length > 0);
    await writeFile(CATALOG_JSON, `${JSON.stringify({ ...stale, entries: entries.slice(1) }, null, 2)}\n`, "utf8");
    const result = await tsx("scripts/search-ui.ts", ["employee", "id", "field"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /stale|fresh/i);
  });
});
