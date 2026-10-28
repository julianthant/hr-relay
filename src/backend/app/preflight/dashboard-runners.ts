import { createServer } from "node:net";
import { accessSync, constants, readFileSync, statfsSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { DashboardLaunchNonceSchema } from "../../../models/dashboard/dashboard-frontend-owner.js";
import { ConfigSchema, type Config } from "../../../models/config/schema.js";
import { PreflightCheckIdSchema } from "../../../models/preflight/preflight-contract.js";
import {
  PreflightObservationSchema,
  requiredPreflightChecks,
  type PreflightRunner,
} from "../../../models/preflight/preflight.js";
import { probeOwnedViteServer } from "../host/local-vite-probe.js";

const RuntimePackageSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  engines: z.strictObject({ node: z.string().min(1) }),
}).loose();

const PackageLockSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  lockfileVersion: z.literal(3),
  packages: z.object({ "": RuntimePackageSchema }).loose(),
}).loose();

const NodeFloorSchema = z.string().regex(/^>=\d+\.\d+\.\d+$/u);
const RuntimeCompatibilityCheck = PreflightCheckIdSchema.parse("runtime.compatibility");
const ConfigValidCheck = PreflightCheckIdSchema.parse("config.valid");
const FilesystemHealthCheck = PreflightCheckIdSchema.parse("filesystem.health");
const PortsAvailableCheck = PreflightCheckIdSchema.parse("ports.available");

function nodeMeetsFloor(version: string, engine: string): boolean {
  const required = NodeFloorSchema.parse(engine).slice(2).split(".").map(Number);
  const actual = z.string().regex(/^\d+\.\d+\.\d+/u).parse(version).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index];
    const requiredPart = required[index];
    if (actualPart === undefined || requiredPart === undefined) throw new Error("Node version tuple is incomplete");
    if (actualPart !== requiredPart) return actualPart > requiredPart;
  }
  return true;
}

function unhealthy(check: PreflightRunner["check"], summary: string, impact: string) {
  return PreflightObservationSchema.parse({ check, state: "unhealthy", summary, impact });
}

function healthy(check: PreflightRunner["check"], summary: string) {
  return PreflightObservationSchema.parse({ check, state: "healthy", summary });
}

async function portCanBind(port: number, signal: AbortSignal): Promise<boolean> {
  if (port === 0) return true;
  return new Promise<boolean>((resolve, reject) => {
    const server = createServer();
    const onAbort = (): void => {
      server.close();
      reject(new Error(`port ${String(port)} inspection was aborted`));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    server.once("error", (error: NodeJS.ErrnoException) => {
      signal.removeEventListener("abort", onAbort);
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      signal.removeEventListener("abort", onAbort);
      server.close((error) => {
        if (error === undefined) resolve(true);
        else reject(error);
      });
    });
  });
}

export interface DashboardPreflightRunnerInput {
  readonly repoRoot: string;
  readonly config: Config;
  readonly stateRoot: string;
  readonly artifactRoot: string;
  readonly backendPort: number;
  readonly frontendPort: number;
  readonly authorityHealth: PreflightRunner;
  readonly frontendOwnerNonce?: string;
  readonly clock: Clock;
  readonly frontendProbe?: typeof probeOwnedViteServer;
  /** The filesystem boundary remains injectable for controlled disk-exhaustion proof. */
  readonly filesystemProbe?: { availableBlocks(this: void, path: string): number };
}

export interface DashboardPreflightRunners {
  readonly runners: readonly PreflightRunner[];
  markBackendOwned(port: number): void;
}

/** Dashboard-scoped detector implementations; registry selection remains in `requiredPreflightChecks`. */
export function createDashboardPreflightRunners(input: DashboardPreflightRunnerInput): DashboardPreflightRunners {
  const repoRoot = z.string().min(1).parse(input.repoRoot);
  const stateRoot = z.string().min(1).parse(input.stateRoot);
  const artifactRoot = z.string().min(1).parse(input.artifactRoot);
  const backendPort = z.number().int().nonnegative().parse(input.backendPort);
  const frontendPort = z.number().int().nonnegative().parse(input.frontendPort);
  const config = input.config;
  const frontendOwnerNonce = input.frontendOwnerNonce === undefined
    ? undefined
    : DashboardLaunchNonceSchema.parse(input.frontendOwnerNonce);
  const frontendProbe = input.frontendProbe ?? probeOwnedViteServer;
  let ownedBackendPort: number | undefined;

  const implementations: readonly PreflightRunner[] = [
    {
      check: RuntimeCompatibilityCheck,
      kind: "io",
      async run(context) {
        if (context.signal.aborted) throw new Error("runtime.compatibility preflight was aborted");
        try {
          const pkg = RuntimePackageSchema.parse(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")));
          const lock = PackageLockSchema.parse(JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8")));
          const lockRoot = lock.packages[""];
          if (lock.name !== pkg.name || lock.version !== pkg.version
            || lockRoot.name !== pkg.name || lockRoot.version !== pkg.version
            || lockRoot.engines.node !== pkg.engines.node) {
            return unhealthy(this.check, "package-lock identity differs from package.json", "the reviewed dependency closure cannot be identified");
          }
          if (!nodeMeetsFloor(process.versions.node, pkg.engines.node)) {
            return unhealthy(this.check, `Node ${process.versions.node} is below ${pkg.engines.node}`, "dashboard runtime behavior is unsupported");
          }
          return healthy(this.check, `Node ${process.versions.node} and package-lock v3 are compatible`);
        } catch {
          return unhealthy(
            this.check,
            "runtime package contract could not be verified (runtime-contract-unavailable: package.json/package-lock.json)",
            "the dashboard cannot establish its reviewed runtime dependency closure",
          );
        }
      },
    },
    {
      check: ConfigValidCheck,
      kind: "pure",
      async run(context) {
        if (context.signal.aborted) throw new Error("config.valid preflight was aborted");
        const parsed = ConfigSchema.safeParse(config);
        return parsed.success
          ? healthy(this.check, "the retained runtime config passes the strict ConfigSchema")
          : unhealthy(this.check, "the retained runtime config fails the strict ConfigSchema", "dashboard decisions have no valid config authority");
      },
    },
    {
      check: FilesystemHealthCheck,
      kind: "io",
      async run(context) {
        if (context.signal.aborted) throw new Error("filesystem.health preflight was aborted");
        try {
          for (const path of [stateRoot, artifactRoot]) accessSync(path, constants.R_OK | constants.W_OK);
          const availableBlocks = input.filesystemProbe?.availableBlocks ?? ((path: string) => statfsSync(path).bavail);
          if (availableBlocks(stateRoot) <= 0 || availableBlocks(artifactRoot) <= 0) {
            return unhealthy(this.check, "a runtime storage root has no writable filesystem blocks", "authority or evidence writes cannot be admitted");
          }
          return healthy(
            this.check,
            `${basename(stateRoot)} and ${basename(artifactRoot)} are readable, writable, and have available blocks`,
          );
        } catch {
          return unhealthy(
            this.check,
            "configured rebuild storage could not be verified (filesystem-root-unavailable: "
              + `${basename(stateRoot)}, ${basename(artifactRoot)})`,
            "authority or evidence writes cannot be admitted",
          );
        }
      },
    },
    input.authorityHealth,
    {
      check: PortsAvailableCheck,
      kind: "io",
      async run(context) {
        if (context.signal.aborted) throw new Error("ports.available preflight was aborted");
        const backendAvailable = ownedBackendPort === backendPort || await portCanBind(backendPort, context.signal);
        const frontendBindable = await portCanBind(frontendPort, context.signal);
        const frontendInspection = frontendBindable
          ? undefined
          : await frontendProbe({
              port: frontendPort,
              signal: context.signal,
              deadlineMonotonicMs: context.deadlineMonotonicMs,
              clock: input.clock,
              ownerNonce: frontendOwnerNonce,
            });
        const frontendAvailable = frontendBindable || frontendInspection?.state === "owned";
        if (!backendAvailable || !frontendAvailable) {
          const frontendReason = frontendInspection?.state === "not-owned"
            ? ` (${frontendInspection.reason})`
            : "";
          const occupied = [
            ...(backendAvailable ? [] : [`backend ${String(backendPort)}`]),
            ...(frontendAvailable ? [] : [`frontend ${String(frontendPort)}${frontendReason}`]),
          ];
          return unhealthy(this.check, `reserved port ownership is invalid for ${occupied.join(" and ")}`, "the isolated dashboard cannot bind or identify its serving process");
        }
        return healthy(this.check, "reserved dashboard ports are bindable or owned by this dashboard pair");
      },
    },
  ];
  const byCheck = new Map(implementations.map((runner) => [runner.check, runner]));
  const runners = requiredPreflightChecks(["dashboard.serve"]).map((check) => {
    const runner = byCheck.get(check);
    if (runner === undefined) throw new Error(`dashboard preflight has no implementation for registry check ${check}`);
    return runner;
  });
  return Object.freeze({
    runners: Object.freeze(runners),
    markBackendOwned(port: number): void {
      const parsed = z.number().int().positive().parse(port);
      if (backendPort !== 0 && parsed !== backendPort) {
        throw new Error(`dashboard preflight cannot claim backend port ${String(parsed)}; registry requires ${String(backendPort)}`);
      }
      ownedBackendPort = backendPort === 0 ? parsed : backendPort;
    },
  });
}
