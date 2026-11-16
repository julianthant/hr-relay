import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { createDashboardPreflightRunners, DashboardPreflightRunnerInput } from "../../../../src/backend/app/preflight/dashboard-runners.js";
import type { Clock } from "../../../../src/rules/time/clock.js";

export function preflightPortRunner(root: string, frontendPort: number, OWNER_NONCE: string, FINGERPRINT: string, CLOCK: Clock,
  compose: (input: Omit<DashboardPreflightRunnerInput, "config" | "authorityHealth">
    & { configFingerprint: string; authorityDoctorOptions: unknown; backendOwned: () => boolean }) => ReturnType<typeof createDashboardPreflightRunners>["runners"],
) {
  const stateRoot = join(root, ".tracker");
        const artifactRoot = join(stateRoot, "artifacts");
        mkdirSync(artifactRoot, { recursive: true });
        const runner = compose({
          repoRoot: process.cwd(),
          stateRoot,
          artifactRoot,
          backendPort: 0,
          frontendPort: frontendPort,
          frontendOwnerNonce: OWNER_NONCE,
          backendOwned: () => false,
          configFingerprint: FINGERPRINT,
          authorityDoctorOptions: {
            stateRootTrustAnchor: root,
            stateRoot,
            authorityPath: join(stateRoot, "state.db"),
            backupDirectory: join(stateRoot, "backups", "authority"),
            maxBackupAgeMs: 60_000,
            busyTimeoutMs: 100,
          },
          clock: CLOCK,
        }).find(({ check }) => check === "ports.available");
  return runner;
}
