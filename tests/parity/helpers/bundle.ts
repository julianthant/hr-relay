/**
 * Ref frontend-backend-integration §7 — the parity lane must photograph the WORKING TREE.
 *
 * The lane serves `dist/dashboard` as static files. Nothing used to guarantee
 * that directory was a build of the current sources, so a run against a stale
 * bundle passed while testing code nobody had compiled — a green lane that
 * proved something about yesterday. That is the same class of defect as a guard
 * whose arm resolves an empty file set: it reads as coverage and cannot fail.
 *
 * The fix is a build stamp. `ensureParityBundle` builds through the repo's own
 * `web:build` script whenever the stamp does not match, and
 * every server that serves the bundle calls `assertParityBundleIsCurrent`
 * first, so a stale or hand-edited `dist/dashboard` FAILS LOUD instead of being
 * served. The stamp binds two digests:
 *
 *   inputDigest  — every file under `src/` plus the build's own configuration
 *                  and lockfile. Deliberately over-approximate: an unrelated
 *                  `src/core` edit forces a rebuild it did not need, which
 *                  costs ~2s and can never let a real dashboard edit through.
 *   outputDigest — every emitted file in `dist/dashboard`, so a bundle edited
 *                  after its build is as loud as a bundle never rebuilt.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";

/** The repository root, from this file's own location — never `process.cwd()`. */
export const PARITY_REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** The one built-bundle location the lane serves. */
export const PARITY_DIST_DIR = join(PARITY_REPO_ROOT, "dist", "dashboard");

/** The repo's own build script; the lane never reimplements it. */
export const PARITY_BUILD_SCRIPT = "web:build";

/** Written into the built bundle, and excluded from the output digest. */
export const PARITY_BUNDLE_STAMP_FILE = "parity-build-stamp.json";

/** Source roots and single files whose content can change the built bundle. */
const BUNDLE_INPUT_ROOTS = ["src"] as const;
const BUNDLE_INPUT_FILES = [
  "vite.dashboard.config.ts",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
] as const;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const ParityBundleStampSchema = z.strictObject({
  stampVersion: z.literal(1),
  inputDigest: Sha256Schema,
  outputDigest: Sha256Schema,
  buildScript: z.string().min(1),
  builtAt: z.string().min(1),
});

export type ParityBundleStamp = z.infer<typeof ParityBundleStampSchema>;

/* ── digests ─────────────────────────────────────────────────────────────── */

function walkAllFiles(root: string, into: string[]): void {
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkAllFiles(full, into);
    else if (entry.isFile()) into.push(full);
  }
}

function digestOfFiles(base: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(base, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * Content digest of everything the dashboard build reads.
 *
 * An empty or missing input set is a hard error, never an empty digest: a
 * freshness check that silently compares nothing is exactly the failure this
 * module exists to remove.
 */
export function computeBundleInputDigest(repoRoot: string = PARITY_REPO_ROOT): string {
  const files: string[] = [];
  for (const root of BUNDLE_INPUT_ROOTS) {
    const absolute = join(repoRoot, root);
    if (!existsSync(absolute)) {
      throw new Error(
        `parity bundle input root ${root} is missing under ${repoRoot}; refusing to compute a freshness digest over nothing`,
      );
    }
    walkAllFiles(absolute, files);
  }
  for (const file of BUNDLE_INPUT_FILES) {
    const absolute = join(repoRoot, file);
    if (!existsSync(absolute)) {
      throw new Error(`parity bundle input ${file} is missing under ${repoRoot}`);
    }
    files.push(absolute);
  }
  if (files.length === 0) {
    throw new Error(`parity bundle input scan under ${repoRoot} resolved no files`);
  }
  return digestOfFiles(repoRoot, files.sort());
}

/** Content digest of the emitted bundle, excluding the stamp file itself. */
export function computeBundleOutputDigest(distDir: string): string {
  if (!existsSync(distDir)) throw new Error(`parity bundle directory ${distDir} does not exist`);
  const files: string[] = [];
  walkAllFiles(distDir, files);
  const emitted = files.filter((file) => relative(distDir, file) !== PARITY_BUNDLE_STAMP_FILE);
  if (emitted.length === 0) throw new Error(`parity bundle directory ${distDir} emitted no files`);
  return digestOfFiles(distDir, emitted.sort());
}

/* ── the stamp ───────────────────────────────────────────────────────────── */

export function bundleStampPath(distDir: string): string {
  return join(distDir, PARITY_BUNDLE_STAMP_FILE);
}

/**
 * Reads the stamp. Absent is `undefined` — a legitimate "never built" state.
 * Unreadable or schema-invalid THROWS: a corrupt stamp is not the same fact as
 * a missing one, and collapsing them would let a tampered stamp read as
 * "just rebuild me".
 */
export function readBundleStamp(distDir: string): ParityBundleStamp | undefined {
  const path = bundleStampPath(distDir);
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return ParityBundleStampSchema.parse(parsed);
}

export function writeBundleStamp(input: Readonly<{ distDir: string; repoRoot?: string }>): ParityBundleStamp {
  const repoRoot = input.repoRoot ?? PARITY_REPO_ROOT;
  const stamp: ParityBundleStamp = {
    stampVersion: 1,
    inputDigest: computeBundleInputDigest(repoRoot),
    outputDigest: computeBundleOutputDigest(input.distDir),
    buildScript: PARITY_BUILD_SCRIPT,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(bundleStampPath(input.distDir), `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

/* ── the check ───────────────────────────────────────────────────────────── */

export type ParityBundleState =
  | { readonly state: "current"; readonly stamp: ParityBundleStamp }
  | { readonly state: "stale"; readonly reason: string };

export interface ParityBundleInput {
  readonly distDir?: string;
  readonly repoRoot?: string;
}

/**
 * Non-throwing freshness verdict. `ensureParityBundle` uses it to decide
 * whether to build; `assertParityBundleIsCurrent` turns "stale" into a throw.
 */
export function parityBundleState(input: ParityBundleInput = {}): ParityBundleState {
  const distDir = input.distDir ?? PARITY_DIST_DIR;
  const repoRoot = input.repoRoot ?? PARITY_REPO_ROOT;

  if (!existsSync(distDir)) return { state: "stale", reason: `${distDir} does not exist` };
  if (!existsSync(join(distDir, "index.html"))) {
    return { state: "stale", reason: `${distDir} carries no index.html` };
  }
  const stamp = readBundleStamp(distDir);
  if (stamp === undefined) {
    return { state: "stale", reason: `${distDir} carries no ${PARITY_BUNDLE_STAMP_FILE}; it was not built by the parity lane` };
  }
  const inputDigest = computeBundleInputDigest(repoRoot);
  if (stamp.inputDigest !== inputDigest) {
    return {
      state: "stale",
      reason: `the bundle was built from different sources (stamped ${stamp.inputDigest.slice(0, 12)}, working tree ${inputDigest.slice(0, 12)})`,
    };
  }
  const outputDigest = computeBundleOutputDigest(distDir);
  if (stamp.outputDigest !== outputDigest) {
    return {
      state: "stale",
      reason: `${distDir} changed after its build (stamped ${stamp.outputDigest.slice(0, 12)}, on disk ${outputDigest.slice(0, 12)})`,
    };
  }
  return { state: "current", stamp };
}

export function assertParityBundleIsCurrent(input: ParityBundleInput = {}): ParityBundleStamp {
  const verdict = parityBundleState(input);
  if (verdict.state === "current") return verdict.stamp;
  throw new Error(
    [
      "the parity lane refuses to serve a bundle that is not a build of the working tree:",
      `  ${verdict.reason}`,
      `  build it with: npm run ${PARITY_BUILD_SCRIPT}  (the lane does this itself via ensureParityBundle)`,
    ].join("\n"),
  );
}

/* ── the build ───────────────────────────────────────────────────────────── */

function runBuildScript(repoRoot: string): void {
  const result = spawnSync("npm", ["run", PARITY_BUILD_SCRIPT], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error !== undefined) {
    throw new Error(`npm run ${PARITY_BUILD_SCRIPT} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `npm run ${PARITY_BUILD_SCRIPT} failed with exit code ${String(result.status)}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
}

/**
 * Builds the dashboard bundle unless the stamp already proves it matches the
 * working tree, then re-asserts. A build that somehow leaves the bundle stale
 * throws rather than letting the lane proceed.
 *
 * The parity config pins `workers: 1`, so no two lane processes race this.
 */
export function ensureParityBundle(input: ParityBundleInput = {}): ParityBundleStamp {
  const distDir = input.distDir ?? PARITY_DIST_DIR;
  const repoRoot = input.repoRoot ?? PARITY_REPO_ROOT;
  const before = parityBundleState({ distDir, repoRoot });
  if (before.state === "current") return before.stamp;
  runBuildScript(repoRoot);
  writeBundleStamp({ distDir, repoRoot });
  return assertParityBundleIsCurrent({ distDir, repoRoot });
}

/* ── how a server binds the bundle ───────────────────────────────────────── */

/**
 * Every parity server must SAY what it is serving.
 *
 * `working-tree` is the only proof that can back a stored reference; the
 * server asserts the stamp before it binds a port. `unverified` exists for
 * API-only probes that serve a synthetic dist and never render the app — it
 * must name its reason, so opting out is a visible authored act rather than a
 * default.
 */
export type ParityBundleProof =
  | { readonly proof: "working-tree" }
  | { readonly proof: "unverified"; readonly reason: string };

export function assertServedBundle(distDir: string, bundle: ParityBundleProof): void {
  if (bundle.proof === "unverified") {
    if (bundle.reason.trim().length === 0) {
      throw new Error("an unverified parity bundle must name why it cannot be proven current");
    }
    return;
  }
  assertParityBundleIsCurrent({ distDir });
}
