import { join,resolve } from "node:path";
import { DASHBOARD_BUILD_COMMAND, computeDashboardBuildInputDigest } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import { createBundleSetup } from "../profiles/bundle-setup.js";

export type { MockBundleStamp, MockBundleState, MockBundleInput, MockBundleProof } from "../profiles/bundle-setup.js";

export const MOCK_REPO_ROOT = resolve(import.meta.dirname, "../../../../../");

export const MOCK_DIST_DIR = join(MOCK_REPO_ROOT, "dist", "dashboard");

export const MOCK_BUILD_SCRIPT = "web:build";

export const computeBundleInputDigest = computeDashboardBuildInputDigest;

export const {
  MOCK_BUNDLE_STAMP_FILE,
  MockBundleStampSchema,
  computeBundleOutputDigest,
  bundleStampPath,
  readBundleStamp,
  writeBundleStamp,
  mockBundleState,
  assertMockBundleIsCurrent,
  ensureMockBundle,
  assertServedBundle
} = createBundleSetup( {
  MOCK_REPO_ROOT: MOCK_REPO_ROOT,
  MOCK_DIST_DIR: MOCK_DIST_DIR,
  bundleBuildInput: () => ({}),
  buildArguments: () => ["run", DASHBOARD_BUILD_COMMAND.slice("npm run ".length)],
  buildCommandLabel: () => DASHBOARD_BUILD_COMMAND
});
