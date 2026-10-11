import { spawnSync } from "node:child_process";
import { join,resolve } from "node:path";
import {
DASHBOARD_BUILD_COMMAND,
DASHBOARD_BUILD_IDENTITY_FILE,
DashboardBuildIdentitySchema,
assertDashboardBuildCurrent,
computeDashboardBuildInputDigest,
computeDashboardBuildOutputDigest,
dashboardBuildIdentityPath,
dashboardBuildState,
readDashboardBuildIdentity,
writeDashboardBuildIdentity,
type DashboardBuildIdentity,
} from "../../../../../src/backend/app/composition/dashboard/build-identity.js";

// The checkout root, the same depth as the build-identity import above: the
// bundle, its identity stamp and the build input digest all live under it.
export const PARITY_REPO_ROOT = resolve(import.meta.dirname, "../../../../../../");
export const PARITY_DIST_DIR = join(PARITY_REPO_ROOT, "dist", "dashboard");
export const PARITY_BUILD_SCRIPT = "web:build";
export const PARITY_BUNDLE_STAMP_FILE = DASHBOARD_BUILD_IDENTITY_FILE;
export const ParityBundleStampSchema = DashboardBuildIdentitySchema;
export type ParityBundleStamp = DashboardBuildIdentity;
export const computeBundleInputDigest = computeDashboardBuildInputDigest;
export const computeBundleOutputDigest = computeDashboardBuildOutputDigest;
export const bundleStampPath = dashboardBuildIdentityPath;
export const readBundleStamp = readDashboardBuildIdentity;
export const writeBundleStamp = writeDashboardBuildIdentity;

export type ParityBundleState =
  | { readonly state: "current"; readonly stamp: ParityBundleStamp }
  | { readonly state: "stale"; readonly reason: string };

export interface ParityBundleInput {
  readonly distDir?: string;
  readonly repoRoot?: string;
}

export function parityBundleState(input: ParityBundleInput = {}): ParityBundleState {
  const result = dashboardBuildState({
    distDir: input.distDir ?? PARITY_DIST_DIR,
    repoRoot: input.repoRoot ?? PARITY_REPO_ROOT,
  });
  return result.state === "current"
    ? { state: "current", stamp: result.identity }
    : result;
}

export function assertParityBundleIsCurrent(input: ParityBundleInput = {}): ParityBundleStamp {
  return assertDashboardBuildCurrent({
    distDir: input.distDir ?? PARITY_DIST_DIR,
    repoRoot: input.repoRoot ?? PARITY_REPO_ROOT,
  });
}

function runBuildScript(repoRoot: string): void {
  const result = spawnSync("npm", ["run", DASHBOARD_BUILD_COMMAND.slice("npm run ".length)], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error !== undefined) {
    throw new Error(`${DASHBOARD_BUILD_COMMAND} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error([
      `${DASHBOARD_BUILD_COMMAND} failed with exit code ${String(result.status)}`,
      result.stdout,
      result.stderr,
    ].join("\n"));
  }
}

export function ensureParityBundle(input: ParityBundleInput = {}): ParityBundleStamp {
  const distDir = input.distDir ?? PARITY_DIST_DIR;
  const repoRoot = input.repoRoot ?? PARITY_REPO_ROOT;
  if (parityBundleState({ distDir, repoRoot }).state === "stale") runBuildScript(repoRoot);
  return assertParityBundleIsCurrent({ distDir, repoRoot });
}

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
