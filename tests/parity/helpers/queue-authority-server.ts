import type { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { ensureParityBundle, PARITY_DIST_DIR, type ParityBundleProof } from "./bundle.js";
import { startSeededServer, type SeededServer } from "./seeded-bff.js";

export interface QueueAuthorityServer extends SeededServer {
  readonly authority: () => AuthorityDatabase;
}

/**
 * Real SQLite authority server for queue commands, live deletion,
 * stream convergence, and desktop parity proof (S6, P5).
 */
export async function startQueueAuthorityServer(
  options: { distDir?: string; bundle?: ParityBundleProof } = {},
): Promise<QueueAuthorityServer> {
  ensureParityBundle();
  let capturedDatabase: AuthorityDatabase | undefined;
  const distDir = options.distDir ?? PARITY_DIST_DIR;
  const bundle = options.bundle ?? { proof: "working-tree" };
  const server = await startSeededServer({
    distDir,
    bundle,
    prepareSelection: async ({ database }) => {
      capturedDatabase = database;
      return undefined;
    },
  });

  return {
    ...server,
    authority: (): AuthorityDatabase => {
      if (capturedDatabase === undefined) {
        throw new Error("queue authority server captured no database instance");
      }
      return capturedDatabase;
    },
  };
}
