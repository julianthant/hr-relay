import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { buildSafeUiCatalog, uiCatalogProjections } from "../../src/stores/ucpath/driver/catalog.js";

/**
 * Behavioural fixtures for the two 1d maintenance CLIs that close the legacy
 * `src/scripts/selectors/*` capabilities (`ui:catalog`, `selector:search`).
 * Ref workflow-model §1.6.3 requires behavioural CLI fixtures and help output for a native or
 * replaced CLI disposition, so these exercise the real entry points as child
 * processes rather than re-testing the library functions in-process.
 *
 * These fixtures are STRICTLY read-only with respect to the tracked projections.
 * They used to regenerate `generated/ui-catalog.json` and both `UI-CATALOG.md`
 * files in place, and one case deliberately wrote a stale catalog over the
 * tracked one before restoring it in `afterAll`. Test files run in parallel
 * forks against ONE working tree, so that mutation window was visible to every
 * other reader of those artifacts — `ui-registry.test.ts` and the
 * `semantic-ui-registry` guard both read them. Under coverage the child `tsx`
 * spawns are slow enough to hold the stale file on disk for seconds, which is
 * why the freshness assertion failed only under `test:coverage`. Writing a
 * generated tree into a temp root keeps the verdict identical in both modes, and
 * the in-place regenerate is gone for a second reason: it silently healed a
 * genuinely stale checkout mid-run, which would have masked the very staleness
 * the guards exist to catch.
 */
// Every case here spawns `tsx` as a child process, which is slow on its own and
// slower still under coverage instrumentation and full-suite fork parallelism.
// The work is real — these are behavioural CLI fixtures, not library calls — so
// the budget moves rather than the fixtures narrowing to in-process tests.
const CLI_TIMEOUT_MS = 180_000;
const run = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "../..");
// Derived, never listed: this used to be a hand-maintained triple that omitted
// `src/stores/kuali/UI-CATALOG.md`, so the generator wrote a projection no
// fixture ever read back. The generator and this fixture now agree by
// construction, and the `semantic-ui-registry` guard pins the derived set
// against the stores that actually ship a registry.
const TRACKED_PROJECTIONS = uiCatalogProjections(buildSafeUiCatalog()).map(({ path }) => path);

/** Exact bytes of every tracked projection at import, re-checked at the end. */
const TRACKED_BYTES_AT_IMPORT = TRACKED_PROJECTIONS.map(
  (path) => readFileSync(resolve(REPO_ROOT, path), "utf8"),
);

let outRoot = "";
const generatedCatalog = (root: string): string => resolve(root, "generated/ui-catalog.json");
const generatedMarkdown = (root: string): string => resolve(root, "src/stores/ucpath/UI-CATALOG.md");

beforeAll(async () => {
  outRoot = await mkdtemp(resolve(tmpdir(), "hrauto-ui-catalog-"));
});

afterAll(async () => {
  if (outRoot.length > 0) await rm(outRoot, { recursive: true, force: true });
});

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

/** Build the projection tree under the fixture's temp root, never the checkout. */
async function generateInto(root: string): Promise<void> {
  const result = await tsx("scripts/generate-ui-catalog.ts", ["--out-root", root]);
  assert.equal(result.code, 0, result.stderr);
}

describe("ui:catalog CLI", { timeout: CLI_TIMEOUT_MS }, () => {
  it("regenerates both projections and reports the entry count", async () => {
    const result = await tsx("scripts/generate-ui-catalog.ts", ["--out-root", outRoot]);
    assert.equal(result.code, 0, result.stderr);
    const expected = buildSafeUiCatalog().entries.length;
    assert.match(result.stdout, new RegExp(`Generated ${String(expected)} semantic UI catalog entries\\.`));

    const written: unknown = JSON.parse(await readFile(generatedCatalog(outRoot), "utf8"));
    assert.deepEqual(written, JSON.parse(JSON.stringify(buildSafeUiCatalog())));
    const markdown = await readFile(generatedMarkdown(outRoot), "utf8");
    assert.match(markdown, /ucpath\.person-org\./);
    // The generated projection must carry no private recipe payload: neither the
    // markdown nor the JSON may leak a locator selector or role recipe.
    const serialized = `${markdown}\n${JSON.stringify(written)}`;
    for (const secret of ["#PERSON_NPC_VW_EMPLID", "#main_target_win0", "Empl ID", "textbox"]) {
      assert.doesNotMatch(serialized, new RegExp(secret.replace(/[#$]/gu, "\\$&")), secret);
    }
  });

  it("is idempotent — a second run reproduces byte-identical output", async () => {
    await generateInto(outRoot);
    const first = await readFile(generatedCatalog(outRoot), "utf8");
    const firstMarkdown = await readFile(generatedMarkdown(outRoot), "utf8");
    await generateInto(outRoot);
    assert.equal(await readFile(generatedCatalog(outRoot), "utf8"), first);
    assert.equal(await readFile(generatedMarkdown(outRoot), "utf8"), firstMarkdown);
  });

  it("writes what the checkout already tracks, so the committed projection is what a rerun produces", async () => {
    await generateInto(outRoot);
    for (const [index, path] of TRACKED_PROJECTIONS.entries()) {
      assert.equal(await readFile(resolve(outRoot, path), "utf8"), TRACKED_BYTES_AT_IMPORT[index], path);
    }
  });

  it("rejects an unrecognised argument instead of writing over the checkout", async () => {
    const result = await tsx("scripts/generate-ui-catalog.ts", ["--out-root"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /usage: npm run ui:catalog/);
  });
});

describe("selector:search CLI", { timeout: CLI_TIMEOUT_MS }, () => {
  it("prints usage and fails when no intent is supplied", async () => {
    const result = await tsx("scripts/search-ui.ts");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /usage: npm run selector:search -- \[--catalog <path>] "<intent>"/);
  });

  it("resolves operator language to the canonical semantic id", async () => {
    const result = await tsx("scripts/search-ui.ts", ["employee", "id", "field"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /ucpath\.person-org\.eid-input/);
    for (const line of result.stdout.trimEnd().split("\n")) {
      assert.match(line, /^\d+\t(element|screen|page-state|observation)\t\S+\t.+$/);
    }
  });

  it("fails loud on an intent nothing matches, instead of printing nothing", async () => {
    // Deliberately a system with no published facts: `kuali` now HAS a
    // registry, so it can no longer stand in for "nothing matches".
    const result = await tsx("scripts/search-ui.ts", ["onbase", "budget", "ledger"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /no semantic UI facts matched intent/);
  });

  it("fails loud when the generated catalog is stale rather than searching it", async () => {
    await generateInto(outRoot);
    const fresh = generatedCatalog(outRoot);
    // Both directions through the SAME explicit path: a fresh catalog searches,
    // the identical catalog minus one entry refuses. Otherwise a `--catalog`
    // that always failed would look like a working freshness check.
    const searched = await tsx("scripts/search-ui.ts", ["--catalog", fresh, "employee", "id", "field"]);
    assert.equal(searched.code, 0, searched.stderr);
    assert.match(searched.stdout, /ucpath\.person-org\.eid-input/);

    const parsed: unknown = JSON.parse(await readFile(fresh, "utf8"));
    assert.ok(parsed !== null && typeof parsed === "object" && "entries" in parsed);
    const entries = Reflect.get(parsed, "entries");
    assert.ok(Array.isArray(entries) && entries.length > 0);
    const stalePath = resolve(outRoot, "stale-ui-catalog.json");
    await writeFile(stalePath, `${JSON.stringify({ ...parsed, entries: entries.slice(1) }, null, 2)}\n`, "utf8");

    const result = await tsx("scripts/search-ui.ts", ["--catalog", stalePath, "employee", "id", "field"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /stale|fresh/i);
  });
});

describe("ui catalog CLI fixtures", () => {
  // The regression pin for the coverage-only freshness failure: these fixtures
  // must leave every tracked projection byte-identical. A future fixture that
  // regenerates or corrupts the checkout in place turns this red instead of
  // turning an unrelated parallel test red once every few runs.
  it("leaves every tracked projection byte-identical", () => {
    for (const [index, path] of TRACKED_PROJECTIONS.entries()) {
      assert.equal(readFileSync(resolve(REPO_ROOT, path), "utf8"), TRACKED_BYTES_AT_IMPORT[index], path);
    }
  });
});
