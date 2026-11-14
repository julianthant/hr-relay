import { resolve, join } from "node:path";
import { MOCK_BUILD_COMMAND, computeDashboardBuildInputDigest } from "../../../src/backend/app/composition/dashboard/build-identity.js";
import { createBundleSetup } from "../../support/helpers/dashboard/profiles/bundle-setup.js";

export type { MockBundleStamp, MockBundleState, MockBundleInput, MockBundleProof } from "../../support/helpers/dashboard/profiles/bundle-setup.js";

export const MOCK_REPO_ROOT = resolve(import.meta.dirname, "../../..");

export const MOCK_DIST_DIR = join(MOCK_REPO_ROOT, "dist", "mock-dashboard");

export const MOCK_BUILD_SCRIPT = MOCK_BUILD_COMMAND;

export const computeBundleInputDigest = (repoRoot: string) => computeDashboardBuildInputDigest(repoRoot, MOCK_BUILD_COMMAND);

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
  bundleBuildInput: () => ({ buildScript: MOCK_BUILD_COMMAND }),
  buildArguments: () => ["exec", "vite", "--", "build", "--config", "vite.mocks.config.ts"],
  buildCommandLabel: () => MOCK_BUILD_SCRIPT
});
