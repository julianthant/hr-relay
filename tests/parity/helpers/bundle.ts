import { resolve, join } from "node:path";
import { PARITY_BUILD_COMMAND, computeDashboardBuildInputDigest } from "../../../src/backend/app/composition/dashboard/build-identity.js";
import { createBundleSetup } from "../../support/helpers/dashboard/profiles/bundle-setup.js";

export type { ParityBundleStamp, ParityBundleState, ParityBundleInput, ParityBundleProof } from "../../support/helpers/dashboard/profiles/bundle-setup.js";

export const PARITY_REPO_ROOT = resolve(import.meta.dirname, "../../..");

export const PARITY_DIST_DIR = join(PARITY_REPO_ROOT, "dist", "parity-dashboard");

export const PARITY_BUILD_SCRIPT = PARITY_BUILD_COMMAND;

export const computeBundleInputDigest = (repoRoot: string) => computeDashboardBuildInputDigest(repoRoot, PARITY_BUILD_COMMAND);

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
  bundleBuildInput: () => ({ buildScript: PARITY_BUILD_COMMAND }),
  buildArguments: () => ["exec", "vite", "--", "build", "--config", "vite.parity.config.ts"],
  buildCommandLabel: () => PARITY_BUILD_SCRIPT
});
