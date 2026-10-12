import { join,resolve } from "node:path";
import { DASHBOARD_BUILD_COMMAND, computeDashboardBuildInputDigest } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import { createBundleSetup } from "../profiles/bundle-setup.js";

export type { ParityBundleStamp, ParityBundleState, ParityBundleInput, ParityBundleProof } from "../profiles/bundle-setup.js";

export const PARITY_REPO_ROOT = resolve(import.meta.dirname, "../../../../../");

export const PARITY_DIST_DIR = join(PARITY_REPO_ROOT, "dist", "dashboard");

export const PARITY_BUILD_SCRIPT = "web:build";

export const computeBundleInputDigest = computeDashboardBuildInputDigest;

export const {
  PARITY_BUNDLE_STAMP_FILE,
  ParityBundleStampSchema,
  computeBundleOutputDigest,
  bundleStampPath,
  readBundleStamp,
  writeBundleStamp,
  parityBundleState,
  assertParityBundleIsCurrent,
  ensureParityBundle,
  assertServedBundle
} = createBundleSetup( {
  PARITY_REPO_ROOT: PARITY_REPO_ROOT,
  PARITY_DIST_DIR: PARITY_DIST_DIR,
  bundleBuildInput: () => ({}),
  buildArguments: () => ["run", DASHBOARD_BUILD_COMMAND.slice("npm run ".length)],
  buildCommandLabel: () => DASHBOARD_BUILD_COMMAND
});
