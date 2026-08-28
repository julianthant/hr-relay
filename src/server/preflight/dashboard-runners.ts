import { createServer } from "node:net";
import { accessSync, constants, readFileSync, statfsSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { ConfigSchema, type Config } from "../../domain/config/schema.js";
import { PreflightCheckIdSchema } from "../../domain/runtime-dependencies.js";
import {
  PreflightObservationSchema,
  requiredPreflightChecks,
  type PreflightRunner,
  type PreflightRunnerContext,
} from "../../domain/preflight.js";
import { observeProcessIdentity } from "../../infra/sqlite/runtime-process-locks.js";

const RuntimePackageSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  engines: z.strictObject({ node: z.string().min(1) }),
}).loose();

const PackageLockSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  lockfileVersion: z.literal(3),
}).loose();

const NodeFloorSchema = z.string().regex(/^>=\d+\.\d+\.\d+$/u);
const RuntimeCompatibilityCheck = PreflightCheckIdSchema.parse("runtime.compatibility");
const ConfigValidCheck = PreflightCheckIdSchema.parse("config.valid");
const FilesystemHealthCheck = PreflightCheckIdSchema.parse("filesystem.health");
const PortsAvailableCheck = PreflightCheckIdSchema.parse("ports.available");
const ProcessOrphansCheck = PreflightCheckIdSchema.parse("process.orphans");

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

function safeErrorMessage(error: unknown, roots: readonly string[]): string {
  return roots.reduce(
    (message, root) => message.replaceAll(root, basename(root)),
    error instanceof Error ? error.message : String(error),
  );
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

async function isDashboardFrontend(port: number, context: PreflightRunnerContext): Promise<boolean> {
  const timeout = AbortSignal.timeout(context.timeoutMs);
  const signal = AbortSignal.any([context.signal, timeout]);
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/`, { signal });
    if (!response.ok) return false;
    return (await response.text()).includes("<title>HR Automation — rebuild</title>");
  } catch (error) {
    if (context.signal.aborted) throw error;
    return false;
  }
}

export interface DashboardPreflightRunnerInput {
  readonly repoRoot: string;
  readonly config: Config;
  readonly stateRoot: string;
  readonly artifactRoot: string;
  readonly backendPort: number;
  readonly frontendPort: number;
  readonly authorityHealth: PreflightRunner;
  readonly listLiveWorkerProcesses: () => readonly Readonly<{ workerId: string; processId: number }>[];
  readonly observeProcess?: typeof observeProcessIdentity;
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
  const config = ConfigSchema.parse(input.config);
  const observe = input.observeProcess ?? observeProcessIdentity;
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
          if (lock.name !== pkg.name || lock.version !== pkg.version) {
            return unhealthy(this.check, "package-lock identity differs from package.json", "the reviewed dependency closure cannot be identified");
          }
          if (!nodeMeetsFloor(process.versions.node, pkg.engines.node)) {
            return unhealthy(this.check, `Node ${process.versions.node} is below ${pkg.engines.node}`, "dashboard runtime behavior is unsupported");
          }
          return healthy(this.check, `Node ${process.versions.node} and package-lock v3 are compatible`);
        } catch (error) {
          return unhealthy(
            this.check,
            `runtime dependency identity is invalid: ${safeErrorMessage(error, [repoRoot])}`,
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
          const state = statfsSync(stateRoot);
          const artifacts = statfsSync(artifactRoot);
          if (state.bavail <= 0 || artifacts.bavail <= 0) {
            return unhealthy(this.check, "a runtime storage root has no writable filesystem blocks", "authority or evidence writes cannot be admitted");
          }
          return healthy(
            this.check,
            `${basename(stateRoot)} and ${basename(artifactRoot)} are readable, writable, and have available blocks`,
          );
        } catch (error) {
          return unhealthy(
            this.check,
            `runtime storage roots failed inspection: ${safeErrorMessage(error, [stateRoot, artifactRoot, repoRoot])}`,
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
        const frontendAvailable = frontendBindable || await isDashboardFrontend(frontendPort, context);
        if (!backendAvailable || !frontendAvailable) {
          const occupied = [
            ...(backendAvailable ? [] : [`backend ${String(backendPort)}`]),
            ...(frontendAvailable ? [] : [`frontend ${String(frontendPort)}`]),
          ];
          return unhealthy(this.check, `reserved port ownership is invalid for ${occupied.join(" and ")}`, "the isolated dashboard cannot bind or identify its serving process");
        }
        return healthy(this.check, "reserved dashboard ports are bindable or owned by this dashboard pair");
      },
    },
    {
      check: ProcessOrphansCheck,
      kind: "io",
      async run(context) {
        if (context.signal.aborted) throw new Error("process.orphans preflight was aborted");
        const orphaned = input.listLiveWorkerProcesses().filter(({ processId }) => observe(processId).state === "gone");
        return orphaned.length === 0
          ? healthy(this.check, "no live worker lease points at a missing process")
          : unhealthy(
            this.check,
            `${String(orphaned.length)} live worker lease(s) point at missing processes`,
            `review worker leases: ${orphaned.map(({ workerId }) => workerId).join(", ")}`,
          );
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
