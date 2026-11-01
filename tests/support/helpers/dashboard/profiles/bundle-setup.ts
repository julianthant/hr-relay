import { spawnSync } from "node:child_process";
import { DASHBOARD_BUILD_IDENTITY_FILE, DashboardBuildIdentitySchema, assertDashboardBuildCurrent, computeDashboardBuildOutputDigest, dashboardBuildIdentityPath, dashboardBuildState, readDashboardBuildIdentity, writeDashboardBuildIdentity, type DashboardBuildIdentity } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import type * as BuildIdentityTypes from "../../../../../src/backend/app/composition/dashboard/build-identity.js";


export type ParityBundleStamp = DashboardBuildIdentity;

export type ParityBundleState =
  | { readonly state: "current"; readonly stamp: ParityBundleStamp }
  | { readonly state: "stale"; readonly reason: string };

export interface ParityBundleInput {
  readonly distDir?: string;
  readonly repoRoot?: string;
}

export type ParityBundleProof =
  | { readonly proof: "working-tree" }
  | { readonly proof: "unverified"; readonly reason: string };

export function createBundleSetup({ PARITY_REPO_ROOT, PARITY_DIST_DIR, bundleBuildInput, buildArguments, buildCommandLabel }: {
  PARITY_REPO_ROOT: string;
  PARITY_DIST_DIR: string;
  bundleBuildInput: () => { buildScript?: BuildIdentityTypes.DashboardBuildCommand };
  buildArguments: () => string[];
  buildCommandLabel: () => string;
}) {
  const PARITY_BUNDLE_STAMP_FILE = DASHBOARD_BUILD_IDENTITY_FILE;

  const ParityBundleStampSchema = DashboardBuildIdentitySchema;

  const computeBundleOutputDigest = computeDashboardBuildOutputDigest;

  const bundleStampPath = dashboardBuildIdentityPath;

  const readBundleStamp = readDashboardBuildIdentity;

  const writeBundleStamp = writeDashboardBuildIdentity;

  function parityBundleState(input: ParityBundleInput = {}): ParityBundleState {
    const result = dashboardBuildState({
      distDir: input.distDir ?? PARITY_DIST_DIR,
      repoRoot: input.repoRoot ?? PARITY_REPO_ROOT,
      ...bundleBuildInput(),
    });
    return result.state === "current"
      ? { state: "current", stamp: result.identity }
      : result;
  }

  function assertParityBundleIsCurrent(input: ParityBundleInput = {}): ParityBundleStamp {
    return assertDashboardBuildCurrent({
      distDir: input.distDir ?? PARITY_DIST_DIR,
      repoRoot: input.repoRoot ?? PARITY_REPO_ROOT,
      ...bundleBuildInput(),
    });
  }

  function runBuildScript(repoRoot: string): void {
    const result = spawnSync("npm", buildArguments(), {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    });
    if (result.error !== undefined) {
      throw new Error(`${buildCommandLabel()} could not be started: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error([
        `${buildCommandLabel()} failed with exit code ${String(result.status)}`,
        result.stdout,
        result.stderr,
      ].join("\n"));
    }
  }

  function ensureParityBundle(input: ParityBundleInput = {}): ParityBundleStamp {
    const distDir = input.distDir ?? PARITY_DIST_DIR;
    const repoRoot = input.repoRoot ?? PARITY_REPO_ROOT;
    const result = parityBundleState({ distDir, repoRoot });
    if (result.state === "current") return result.stamp;
    runBuildScript(repoRoot);
    return assertParityBundleIsCurrent({ distDir, repoRoot });
  }

  function assertServedBundle(distDir: string, bundle: ParityBundleProof): void {
    if (bundle.proof === "unverified") {
      if (bundle.reason.trim().length === 0) {
        throw new Error("an unverified parity bundle must name why it cannot be proven current");
      }
      return;
    }
    assertParityBundleIsCurrent({ distDir });
  }

  return { PARITY_BUNDLE_STAMP_FILE, ParityBundleStampSchema, computeBundleOutputDigest, bundleStampPath, readBundleStamp, writeBundleStamp, parityBundleState, assertParityBundleIsCurrent, ensureParityBundle, assertServedBundle };
}
