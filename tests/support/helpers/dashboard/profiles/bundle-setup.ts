import { spawnSync } from "node:child_process";
import { DASHBOARD_BUILD_IDENTITY_FILE, DashboardBuildIdentitySchema, assertDashboardBuildCurrent, computeDashboardBuildOutputDigest, dashboardBuildIdentityPath, dashboardBuildState, readDashboardBuildIdentity, writeDashboardBuildIdentity, type DashboardBuildIdentity } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import type * as BuildIdentityTypes from "../../../../../src/backend/app/composition/dashboard/build-identity.js";


export type MockBundleStamp = DashboardBuildIdentity;

export type MockBundleState =
  | { readonly state: "current"; readonly stamp: MockBundleStamp }
  | { readonly state: "stale"; readonly reason: string };

export interface MockBundleInput {
  readonly distDir?: string;
  readonly repoRoot?: string;
}

export type MockBundleProof =
  | { readonly proof: "working-tree" }
  | { readonly proof: "unverified"; readonly reason: string };

export function createBundleSetup({ MOCK_REPO_ROOT, MOCK_DIST_DIR, bundleBuildInput, buildArguments, buildCommandLabel }: {
  MOCK_REPO_ROOT: string;
  MOCK_DIST_DIR: string;
  bundleBuildInput: () => { buildScript?: BuildIdentityTypes.DashboardBuildCommand };
  buildArguments: () => string[];
  buildCommandLabel: () => string;
}) {
  const MOCK_BUNDLE_STAMP_FILE = DASHBOARD_BUILD_IDENTITY_FILE;

  const MockBundleStampSchema = DashboardBuildIdentitySchema;

  const computeBundleOutputDigest = computeDashboardBuildOutputDigest;

  const bundleStampPath = dashboardBuildIdentityPath;

  const readBundleStamp = readDashboardBuildIdentity;

  const writeBundleStamp = writeDashboardBuildIdentity;

  function mockBundleState(input: MockBundleInput = {}): MockBundleState {
    const result = dashboardBuildState({
      distDir: input.distDir ?? MOCK_DIST_DIR,
      repoRoot: input.repoRoot ?? MOCK_REPO_ROOT,
      ...bundleBuildInput(),
    });
    return result.state === "current"
      ? { state: "current", stamp: result.identity }
      : result;
  }

  function assertMockBundleIsCurrent(input: MockBundleInput = {}): MockBundleStamp {
    return assertDashboardBuildCurrent({
      distDir: input.distDir ?? MOCK_DIST_DIR,
      repoRoot: input.repoRoot ?? MOCK_REPO_ROOT,
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

  function ensureMockBundle(input: MockBundleInput = {}): MockBundleStamp {
    const distDir = input.distDir ?? MOCK_DIST_DIR;
    const repoRoot = input.repoRoot ?? MOCK_REPO_ROOT;
    const result = mockBundleState({ distDir, repoRoot });
    if (result.state === "current") return result.stamp;
    runBuildScript(repoRoot);
    return assertMockBundleIsCurrent({ distDir, repoRoot });
  }

  function assertServedBundle(distDir: string, bundle: MockBundleProof): void {
    if (bundle.proof === "unverified") {
      if (bundle.reason.trim().length === 0) {
        throw new Error("an unverified mock bundle must name why it cannot be proven current");
      }
      return;
    }
    assertMockBundleIsCurrent({ distDir });
  }

  return { MOCK_BUNDLE_STAMP_FILE, MockBundleStampSchema, computeBundleOutputDigest, bundleStampPath, readBundleStamp, writeBundleStamp, mockBundleState, assertMockBundleIsCurrent, ensureMockBundle, assertServedBundle };
}
