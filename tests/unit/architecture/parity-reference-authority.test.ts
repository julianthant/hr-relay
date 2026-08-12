/**
 * D132 — the parity lane must be able to FAIL.
 *
 * Two independent holes made `npm run test:parity` a check that could not fail,
 * which is worse than no check because it reads as coverage:
 *
 *   1. `.a11y.yml` / `.meta.json` references were rewritten unconditionally
 *      while only the `.png` was asserted, so an accessibility-only regression
 *      rewrote its own expectation and passed. Observed directly: an
 *      accessible-name change rewrote 56 a11y references, changed zero
 *      screenshots, and left the lane green.
 *   2. The lane served a pre-built `dist/dashboard` it never rebuilt, so a run
 *      against a stale bundle passed while testing code that was not in the
 *      working tree.
 *
 * Both fixes are proven the way the rebuild ratchet arms are proven: the REAL
 * enforcement function is executed against a violating fixture, so a dead arm
 * cannot stand in for enforcement. Two of the controls additionally drive the
 * lane's own entry points (`captureA11yReference`, `startFixtureServer`), so
 * this suite also proves the arms are WIRED, not merely present.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, gitVisibleFiles } from "./helpers/guard-files.js";
import { unclaimedSpans } from "../../parity/helpers/geometry.js";
import {
  assertOrUpdateParityReference,
  captureName,
  parityUpdateRequested,
  renderA11yReference,
  type CaptureMetadata,
} from "../../parity/helpers/reference-store.js";
import { captureA11yReference } from "../../parity/helpers/capture.js";
import {
  PARITY_BUILD_SCRIPT,
  PARITY_BUNDLE_STAMP_FILE,
  assertParityBundleIsCurrent,
  computeBundleInputDigest,
  computeBundleOutputDigest,
  parityBundleState,
  writeBundleStamp,
} from "../../parity/helpers/bundle.js";
import { startFixtureServer } from "../../parity/helpers/fixture-bff.js";

const PARITY_REFERENCES = join(REPO_ROOT, "tests/parity/references");

const METADATA: CaptureMetadata = {
  stateId: "queue-day",
  viewport: "1440x900",
  theme: "paper-ink",
  adapter: "fixture",
  fixtureId: "queue-day",
  descriptorHash: "sha256:fixture",
  appVersion: "0.1.0",
  capturedAt: "2026-08-03",
  variant: "default",
};

/** A real tree from the committed corpus, so the control is bound to real data. */
function storedTree(name: string): string {
  const raw = readFileSync(join(PARITY_REFERENCES, `${name}.a11y.yml`), "utf8");
  // The stored form is header lines, one blank, the tree, one trailing "\n".
  // Strip the header and both renderer-added blanks so re-rendering the result
  // reproduces the file byte for byte.
  const body = raw.split("\n").filter((line) => !line.startsWith("# "));
  const tree = body.slice(1, -1).join("\n");
  assert.ok(tree.trim().length > 0, `${name} carries no a11y tree`);
  return tree;
}

function temporaryRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `hrauto-parity-${label}-`));
}

/** A minimal but complete synthetic repo the bundle digest can be computed over. */
function seedSyntheticRepo(root: string): void {
  mkdirSync(join(root, "src", "dashboard"), { recursive: true });
  writeFileSync(join(root, "src", "dashboard", "main.tsx"), "export const app = 1;\n");
  for (const file of ["vite.dashboard.config.ts", "tsconfig.json", "package.json", "package-lock.json"]) {
    writeFileSync(join(root, file), "{}\n");
  }
}

function seedSyntheticDist(distDir: string): void {
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>parity</title>\n");
  writeFileSync(join(distDir, "assets", "index.js"), "console.log(1);\n");
}

describe("parity lane reference authority (D132)", () => {
  it("fails an a11y-only change instead of rewriting its own expectation", () => {
    const name = captureName(METADATA);
    const tree = storedTree(name);
    const root = temporaryRoot("a11y");
    try {
      // A faithful copy of the committed pair: the control asserts against the
      // real corpus content, not a hand-written stand-in.
      writeFileSync(join(root, `${name}.a11y.yml`), renderA11yReference(tree, METADATA));
      writeFileSync(join(root, `${name}.meta.json`), `${JSON.stringify(METADATA, null, 2)}\n`);
      const before = readFileSync(join(root, `${name}.a11y.yml`), "utf8");

      // The unchanged tree passes — the control is not vacuous.
      assertOrUpdateParityReference({ referencesDir: root, tree, metadata: METADATA, update: false });

      // An accessible-name change: exactly the regression that used to pass.
      const renamed = tree.replace(/"([^"\n]+)"/u, '"renamed accessible name"');
      assert.notEqual(renamed, tree, "the corpus tree must carry an accessible name to mutate");
      assert.throws(
        () => {
          assertOrUpdateParityReference({ referencesDir: root, tree: renamed, metadata: METADATA, update: false });
        },
        (error: Error) => {
          assert.match(error.message, /a11y reference drift/);
          assert.match(error.message, new RegExp(name));
          assert.match(error.message, /fixture: queue-day/);
          assert.match(error.message, /theme: paper-ink/);
          assert.match(error.message, /viewport: 1440x900/);
          assert.match(error.message, /reference:.*\.a11y\.yml/);
          assert.match(error.message, /npm run test:parity:update/);
          return true;
        },
      );

      // THE defect: a failing comparison must not have rewritten the reference.
      assert.equal(readFileSync(join(root, `${name}.a11y.yml`), "utf8"), before);

      // The provenance record is asserted too, not just the tree: a matching
      // tree beside a rewritten .meta.json must still fail.
      writeFileSync(
        join(root, `${name}.meta.json`),
        `${JSON.stringify({ ...METADATA, appVersion: "9.9.9" }, null, 2)}\n`,
      );
      assert.throws(
        () => {
          assertOrUpdateParityReference({ referencesDir: root, tree, metadata: METADATA, update: false });
        },
        /metadata reference drift/,
      );
      writeFileSync(join(root, `${name}.meta.json`), `${JSON.stringify(METADATA, null, 2)}\n`);

      // A missing reference fails loud rather than being minted silently.
      const empty = temporaryRoot("a11y-empty");
      try {
        assert.throws(
          () => {
            assertOrUpdateParityReference({ referencesDir: empty, tree, metadata: METADATA, update: false });
          },
          /no stored a11y reference[\s\S]*npm run test:parity:update/,
        );
        assert.equal(existsSync(join(empty, `${name}.a11y.yml`)), false);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }

      // And the deliberate opt-in still refreshes, so an intended change is easy.
      assertOrUpdateParityReference({ referencesDir: root, tree: renamed, metadata: METADATA, update: true });
      assert.equal(
        readFileSync(join(root, `${name}.a11y.yml`), "utf8"),
        renderA11yReference(renamed, METADATA),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("routes the lane's own capture path through the assertion", async () => {
    // Executed wiring proof: `captureA11yReference` is what the reference spec
    // calls, and it must refuse a drifted tree before any pixel comparison.
    const name = captureName(METADATA);
    const tree = storedTree(name);
    const root = temporaryRoot("capture");
    try {
      writeFileSync(join(root, `${name}.a11y.yml`), renderA11yReference(tree, METADATA));
      writeFileSync(join(root, `${name}.meta.json`), `${JSON.stringify(METADATA, null, 2)}\n`);
      const page = (value: string) => ({ locator: () => ({ ariaSnapshot: () => Promise.resolve(value) }) });

      assert.equal(await captureA11yReference(page(tree), root, METADATA), name);
      await assert.rejects(
        captureA11yReference(page(`${tree}\n  - button "smuggled"`), root, METADATA),
        /a11y reference drift/,
      );
      await assert.rejects(captureA11yReference(page("   "), root, METADATA), /a11y snapshot .* is empty/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the refresh switch from exactly one place, and rejects an ambiguous value", () => {
    assert.equal(parityUpdateRequested({}), false);
    assert.equal(parityUpdateRequested({ PARITY_UPDATE: "" }), false);
    assert.equal(parityUpdateRequested({ PARITY_UPDATE: "0" }), false);
    assert.equal(parityUpdateRequested({ PARITY_UPDATE: "1" }), true);
    assert.throws(() => parityUpdateRequested({ PARITY_UPDATE: "yes" }), /PARITY_UPDATE must be/);

    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["test:parity"] ?? "", /playwright test --config playwright\.parity\.config\.ts/);
    assert.doesNotMatch(
      pkg.scripts["test:parity"] ?? "",
      /update/,
      "the default parity lane must never refresh a reference",
    );
    assert.match(pkg.scripts["test:parity:update"] ?? "", /^PARITY_UPDATE=1 playwright test/);

    // The pixel half must take its update mode from the SAME switch, so the
    // two halves of a pair can never be refreshed independently.
    const config = readFileSync(join(REPO_ROOT, "playwright.parity.config.ts"), "utf8");
    assert.match(config, /updateSnapshots:\s*parityUpdateRequested\(\) \? "changed" : "none"/);
  });

  it("allows ZERO moved pixels, and lets no caller widen that (D145)", async () => {
    // D145. The pixel half's allowance used to be `maxDiffPixelRatio: 0.001` —
    // 786 px at 1024x768 — and it was calibrated against nothing. It swallowed a
    // real, visible content change (a stale `wf <descriptorHash>` stamp, 112 px)
    // AND, because `updateSnapshots: "changed"` reuses the same comparison, it
    // stopped the deliberate refresh from repairing what it could not fail: eight
    // pairs shipped with a refreshed `.a11y.yml` beside a stale `.png`.
    //
    // Measured floor (46 references x 2 independent full lane runs, 2026-08-04):
    // ZERO counted pixels every time. So the count allowance is zero, and the
    // per-pixel colour tolerance is the lane's only nondeterminism budget.
    const parityConfig = await import("../../../playwright.parity.config.js");
    const screenshot = parityConfig.default.expect?.toHaveScreenshot;
    assert.ok(screenshot !== undefined, "the parity config must state its screenshot comparison");
    assert.equal(
      screenshot.maxDiffPixels,
      0,
      "no pixel may move: a nonzero count allowance is where content drift hides",
    );
    // Playwright takes the MINIMUM of the two, so a ratio can only tighten this
    // further — but an unpinned per-pixel tolerance would be an uncalibrated
    // allowance again, and it is now the only one the lane has.
    assert.ok(
      typeof screenshot.threshold === "number" && screenshot.threshold > 0 && screenshot.threshold <= 0.2,
      "the per-pixel colour tolerance must be pinned explicitly, at or below Playwright's default",
    );

    // A per-call override would reopen the hole one assertion at a time.
    const parityScanned = gitVisibleFiles(["tests/parity"]).filter((file) => file.endsWith(".ts"));
    assert.ok(parityScanned.length >= 5, "the per-call override scan must see the real lane");
    for (const path of parityScanned) {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.doesNotMatch(
        source,
        /maxDiffPixel(?:s|Ratio)|threshold\s*:/u,
        `${path} may not set its own screenshot allowance; the lane's comparison is config-wide`,
      );
    }
  });

  it("keeps every reference write behind the update gate", () => {
    // Structural half of the wiring proof, audited in BOTH directions: a new
    // unconditional writer under tests/parity is exactly how hole #1 got in,
    // and a stale allowlist entry would hide the arm going dead.
    const allowedWriters: Readonly<Record<string, string>> = {
      "tests/parity/helpers/reference-store.ts": "owns the PARITY_UPDATE gate — the ONE place a reference may be written",
      "tests/parity/helpers/bundle.ts": "writes the build stamp into dist/, never into tests/parity/references/",
    };
    const writers = gitVisibleFiles(["tests/parity"])
      .filter((path) => path.endsWith(".ts"))
      .filter((path) => /\bwriteFileSync\b|\bwriteFile\(/u.test(readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(
      writers.filter((path) => !(path in allowedWriters)),
      [],
      "reference writes belong behind the PARITY_UPDATE gate",
    );
    assert.deepEqual(
      Object.keys(allowedWriters).filter((path) => !writers.includes(path)),
      [],
      "a stale writer allowlist entry hides an arm that stopped scanning",
    );
    assert.doesNotMatch(
      readFileSync(join(REPO_ROOT, "tests/parity/helpers/bundle.ts"), "utf8"),
      /references/,
      "the bundle stamp writer must never touch the reference corpus",
    );

    // And no spec may opt out of the working-tree bundle proof.
    const optOuts = gitVisibleFiles(["tests/parity"])
      .filter((path) => path.endsWith(".spec.ts"))
      .filter((path) => /proof:\s*"unverified"/u.test(readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(optOuts, [], "a parity spec must serve a proven working-tree bundle");
  });

  it("fails a stale, unstamped, or tampered bundle", () => {
    const repoRoot = temporaryRoot("repo");
    const distDir = join(repoRoot, "dist", "dashboard");
    try {
      seedSyntheticRepo(repoRoot);
      seedSyntheticDist(distDir);

      // No stamp at all — the pre-D132 state, where anything on disk was served.
      assert.equal(parityBundleState({ distDir, repoRoot }).state, "stale");
      assert.throws(
        () => assertParityBundleIsCurrent({ distDir, repoRoot }),
        new RegExp(`carries no ${PARITY_BUNDLE_STAMP_FILE}`),
      );

      // Stamped against these exact sources — the positive control.
      writeBundleStamp({ distDir, repoRoot });
      assert.equal(parityBundleState({ distDir, repoRoot }).state, "current");

      // A source edit makes the bundle stale, and it must say so.
      writeFileSync(join(repoRoot, "src", "dashboard", "main.tsx"), "export const app = 2;\n");
      const stale = parityBundleState({ distDir, repoRoot });
      assert.equal(stale.state, "stale");
      assert.throws(
        () => assertParityBundleIsCurrent({ distDir, repoRoot }),
        new RegExp(`built from different sources[\\s\\S]*npm run ${PARITY_BUILD_SCRIPT}`),
      );

      // Re-stamping restores it; editing the OUTPUT after the build is equally loud.
      writeBundleStamp({ distDir, repoRoot });
      assert.equal(parityBundleState({ distDir, repoRoot }).state, "current");
      writeFileSync(join(distDir, "assets", "index.js"), "console.log(2);\n");
      assert.throws(() => assertParityBundleIsCurrent({ distDir, repoRoot }), /changed after its build/);

      // A missing bundle is stale, never an empty digest that compares equal.
      rmSync(distDir, { recursive: true, force: true });
      assert.throws(() => assertParityBundleIsCurrent({ distDir, repoRoot }), /does not exist/);
      assert.throws(() => computeBundleOutputDigest(distDir), /does not exist/);
      assert.throws(
        () => computeBundleInputDigest(join(repoRoot, "nowhere")),
        /input root src is missing/,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses to serve a stale bundle from the lane's own server", async () => {
    // Executed wiring proof: the stale-bundle arm is reachable from the exact
    // entry point the parity specs use, and it refuses before binding a port.
    const distDir = temporaryRoot("stale-dist");
    try {
      seedSyntheticDist(distDir);
      await assert.rejects(
        startFixtureServer({ distDir, bundle: { proof: "working-tree" } }),
        /refuses to serve a bundle that is not a build of the working tree/,
      );
      // An unverified probe must still name its reason.
      await assert.rejects(
        startFixtureServer({ distDir, bundle: { proof: "unverified", reason: "  " } }),
        /must name why it cannot be proven current/,
      );
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("keeps the real bundle digest non-vacuous over the real working tree", () => {
    // The arm must resolve a real, large input set here — an arm that scans
    // nothing is the failure mode this whole suite exists to remove.
    const digest = computeBundleInputDigest(REPO_ROOT);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(digest, computeBundleInputDigest(REPO_ROOT), "the digest must be deterministic");
    assert.ok(
      gitVisibleFiles(["src/dashboard"]).length > 20,
      "the dashboard source set the digest covers must be substantial",
    );
    // The round-trip that proves the stored corpus is what the renderer emits:
    // every committed reference must already be in canonical form, or the
    // newly-asserting comparison would be diffing formatting, not behaviour.
    const references = gitVisibleFiles(["tests/parity/references"])
      .filter((path) => path.endsWith(".a11y.yml"));
    assert.ok(references.length > 50, "the reference corpus must be substantial");
    for (const path of references) {
      const raw = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.ok(raw.startsWith("# "), `${path} must carry its provenance header`);
      assert.ok(raw.endsWith("\n"), `${path} must end with exactly one newline`);
    }
  });

  /*
    The geometry half (D195). These run the SAME function the lane calls, over
    synthetic regions, for the reason every mechanical arm in this tree is
    executed against a violating fixture: an assertion nobody has watched fail
    is indistinguishable from one that cannot.

    Both violating cases are reconstructions of defects that shipped and that
    the pixel and a11y halves were both green over.
  */
  describe("shell geometry (D195)", () => {
    const region = { regionLeft: 0, regionRight: 1440, padding: 12 } as const;

    it("passes the region the grid actually tiles", () => {
      const spans = unclaimedSpans({
        ...region,
        panels: [
          { label: "Queue", left: 12, right: 388, width: 376, height: 758 },
          { label: "Run detail", left: 400, right: 1428, width: 1028, height: 758 },
        ],
      });
      assert.deepEqual(spans, [], "a tiled region must report no unclaimed span");
    });

    it("catches D195 — the detail track holding nothing", () => {
      // No run open, so the second child was never rendered. This is the exact
      // shape measured at 1440x900 before the fix.
      const spans = unclaimedSpans({
        ...region,
        panels: [{ label: "Queue", left: 12, right: 482, width: 470, height: 758 }],
      });
      assert.equal(spans.length, 1);
      assert.ok(
        spans[0] !== undefined && spans[0].width > 900,
        `expected the ~950px void to be reported, got ${JSON.stringify(spans)}`,
      );
    });

    it("catches D187 — a panel collapsed to a sliver", () => {
      // `LogPanel`'s root sized to content, so the detail column was two pixels
      // and the rest of its track was empty. The a11y tree still read every
      // word of it, which is exactly why review after review passed over it.
      const spans = unclaimedSpans({
        ...region,
        panels: [
          { label: "Queue", left: 12, right: 388, width: 376, height: 758 },
          { label: "Run detail", left: 400, right: 402, width: 2, height: 758 },
        ],
      });
      assert.ok(spans.length > 0, "a two-pixel panel must leave its track reported as unclaimed");
    });

    it("tolerates one grid gap, and treats an overlapping panel as covering", () => {
      const gapped = unclaimedSpans({
        ...region,
        panels: [
          { label: "Queue", left: 12, right: 388, width: 376, height: 758 },
          { label: "Run detail", left: 400, right: 1428, width: 1028, height: 758 },
        ],
      });
      assert.deepEqual(gapped, [], "the 12px shell inset between tracks is not a hole");

      // The floating Workflow Panel sits OVER the queue. An operator looking at
      // an overlapped pixel is looking at something, so overlap must cover
      // rather than double-count — otherwise the sweep would invent a void
      // behind every floating window.
      const overlapped = unclaimedSpans({
        ...region,
        panels: [
          { label: "Workflow Panel", left: 12, right: 212, width: 200, height: 758 },
          { label: "Queue", left: 12, right: 388, width: 376, height: 758 },
          { label: "Run detail", left: 400, right: 1428, width: 1028, height: 758 },
        ],
      });
      assert.deepEqual(overlapped, [], "an overlapping panel must not open a span behind it");
    });

    it("is wired into the lane's own capture path, not merely available", () => {
      const spec = readFileSync(join(REPO_ROOT, "tests/parity/dashboard-reference.spec.ts"), "utf8");
      assert.match(
        spec,
        /assertShellGeometry\(page,/,
        "the reference spec must call the geometry assertion, or it guards nothing",
      );
      // The CALL SITE, not the import — `indexOf("captureParityPair")` finds
      // the import block first and would pass no matter where the assertion ran.
      const capturePos = spec.indexOf("captureParityPair(page");
      const geometryPos = spec.indexOf("assertShellGeometry(page,");
      assert.ok(
        geometryPos > 0 && geometryPos < capturePos,
        "the geometry assertion must run BEFORE the capture; a reference minted from a broken "
        + "region records the defect and then passes forever",
      );
    });
  });
});
