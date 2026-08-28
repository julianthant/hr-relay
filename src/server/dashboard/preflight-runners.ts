import { constants, accessSync, readFileSync, statfsSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { FingerprintSchema } from "../../domain/ids.js";
import type { PreflightRunner, PreflightRunnerContext } from "../../domain/preflight.js";
import { PreflightObservationSchema } from "../../domain/preflight.js";
import { PreflightCheckIdSchema } from "../../domain/runtime-dependencies.js";
import { AuthorityHealthPreflightRunner } from "../../infra/sqlite/authority-health-runner.js";
import { inspectRuntimeProcessOrphans } from "../../infra/sqlite/runtime-process-locks.js";
import {
  DashboardLaunchNonceSchema,
} from "./frontend-owner.js";
import { probeOwnedViteServer } from "../../infra/providers/local-vite-probe.js";

const PackageContractSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  nodeEngine: z.string().regex(/^>=\d+\.0\.0$/u),
});

function readPackageContract(path: string): z.infer<typeof PackageContractSchema> {
  const record = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, "utf8")));
  const engines = z.record(z.string(), z.unknown()).parse(record.engines);
  return PackageContractSchema.parse({ name: record.name, version: record.version, nodeEngine: engines.node });
}

function runtimeObservation(repoRoot: string) {
  const packageContract = readPackageContract(join(repoRoot, "package.json"));
  const lock = z.record(z.string(), z.unknown()).parse(
    JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8")),
  );
  const packages = z.record(z.string(), z.unknown()).parse(lock.packages);
  const lockRoot = z.record(z.string(), z.unknown()).parse(packages[""]);
  const lockEngines = z.record(z.string(), z.unknown()).parse(lockRoot.engines);
  const lockContract = PackageContractSchema.parse({
    name: lockRoot.name,
    version: lockRoot.version,
    nodeEngine: lockEngines.node,
  });
  const requiredMajorText = /^>=(\d+)\.0\.0$/u.exec(packageContract.nodeEngine)?.[1];
  if (requiredMajorText === undefined) throw new Error("package node engine did not expose a minimum major");
  const requiredMajor = z.coerce.number().int().positive().parse(requiredMajorText);
  const currentMajor = z.coerce.number().int().positive().parse(process.versions.node.split(".")[0]);
  if (currentMajor < requiredMajor) {
    throw new Error(`Node major ${String(currentMajor)} is below required major ${String(requiredMajor)}`);
  }
  if (JSON.stringify(lockContract) !== JSON.stringify(packageContract)) {
    throw new Error("package-lock root identity or Node engine does not match package.json");
  }
  if (lock.lockfileVersion !== 3) throw new Error(`package-lock version is ${String(lock.lockfileVersion)}, expected 3`);
  return `Node ${String(currentMajor)} and package-lock v3 match ${packageContract.name} ${packageContract.version}`;
}

class RuntimeCompatibilityRunner implements PreflightRunner {
  readonly check = PreflightCheckIdSchema.parse("runtime.compatibility");
  readonly kind = "io" as const;
  constructor(private readonly repoRoot: string) {}
  async run(context: PreflightRunnerContext) {
    if (context.signal.aborted) throw new Error("runtime.compatibility preflight was aborted");
    try {
      return { check: this.check, state: "healthy" as const, summary: runtimeObservation(this.repoRoot) };
    } catch (error) {
      return {
        check: this.check,
        state: "unhealthy" as const,
        summary: `runtime package contract is incompatible: ${error instanceof Error ? error.message : String(error)}`,
        impact: "the dashboard cannot trust the installed runtime dependency graph",
      };
    }
  }
}

class ConfigValidRunner implements PreflightRunner {
  readonly check = PreflightCheckIdSchema.parse("config.valid");
  readonly kind = "pure" as const;
  readonly #fingerprint: string;
  constructor(configFingerprint: string) {
    this.#fingerprint = FingerprintSchema.parse(configFingerprint);
  }
  async run(context: PreflightRunnerContext) {
    if (context.signal.aborted) throw new Error("config.valid preflight was aborted");
    return {
      check: this.check,
      state: "healthy" as const,
      summary: `strict config resolution produced fingerprint ${this.#fingerprint.slice(0, 12)}`,
    };
  }
}

class FilesystemHealthRunner implements PreflightRunner {
  readonly check = PreflightCheckIdSchema.parse("filesystem.health");
  readonly kind = "io" as const;
  constructor(private readonly roots: readonly [string, string]) {}
  async run(context: PreflightRunnerContext) {
    if (context.signal.aborted) throw new Error("filesystem.health preflight was aborted");
    try {
      for (const root of this.roots) accessSync(root, constants.R_OK | constants.W_OK);
      const filesystem = statfsSync(this.roots[0]);
      if (filesystem.bavail <= 0) throw new Error("filesystem reports zero available blocks");
      return {
        check: this.check,
        state: "healthy" as const,
        summary: `${basename(this.roots[0])} and ${basename(this.roots[1])} are readable/writable with available blocks`,
      };
    } catch (error) {
      return {
        check: this.check,
        state: "unhealthy" as const,
        summary: `configured rebuild storage is not writable with available space: ${error instanceof Error ? error.message : String(error)}`,
        impact: "the dashboard cannot safely persist authority or artifacts",
      };
    }
  }
}

function errno(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

async function portIsBindable(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (errno(error) === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error === undefined) resolve(true);
        else reject(error);
      });
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true });
  });
}

class PortsAvailableRunner implements PreflightRunner {
  readonly check = PreflightCheckIdSchema.parse("ports.available");
  readonly kind = "io" as const;
  constructor(
    private readonly backendPort: number,
    private readonly frontendPort: number,
    private readonly backendOwned: () => boolean,
    private readonly clock: Clock,
    private readonly frontendOwnerNonce: string | undefined,
  ) {}
  async run(context: PreflightRunnerContext) {
    if (context.signal.aborted) throw new Error("ports.available preflight was aborted");
    const backendAvailable = this.backendOwned() || await portIsBindable(this.backendPort);
    const frontendBindable = await portIsBindable(this.frontendPort);
    const frontendProbe = frontendBindable
      ? { state: "owned" as const }
      : await probeOwnedViteServer({
          port: this.frontendPort,
          signal: context.signal,
          deadlineMonotonicMs: context.deadlineMonotonicMs,
          clock: this.clock,
          ownerNonce: this.frontendOwnerNonce,
        });
    const frontendAvailable = frontendProbe.state === "owned";
    if (backendAvailable && frontendAvailable) {
      return {
        check: this.check,
        state: "healthy" as const,
        summary: `reserved backend ${String(this.backendPort)} and frontend ${String(this.frontendPort)} ports are available or owned`,
      };
    }
    return {
      check: this.check,
      state: "unhealthy" as const,
      summary: backendAvailable
        ? `reserved frontend port is occupied by an unrecognized process (${frontendProbe.state === "not-owned" ? frontendProbe.reason : "unknown"})`
        : "reserved backend port is occupied by an unrecognized process",
      impact: "the isolated dashboard cannot bind or reach its declared local endpoint",
    };
  }
}

class ProcessOrphansRunner implements PreflightRunner {
  readonly check = PreflightCheckIdSchema.parse("process.orphans");
  readonly kind = "io" as const;
  constructor(private readonly processLockRoot: string) {}
  async run(context: PreflightRunnerContext) {
    if (context.signal.aborted) throw new Error("process.orphans preflight was aborted");
    try {
      const inspection = inspectRuntimeProcessOrphans(this.processLockRoot);
      const total = inspection.staleServerRecords + inspection.staleWorkerRecords;
      return total === 0
        ? { check: this.check, state: "healthy" as const, summary: "no unreleased dead process owners were found" }
        : {
            check: this.check,
            state: "unhealthy" as const,
            summary: `${String(total)} unreleased dead process owner record(s) require review`,
            impact: "stale process evidence can block restore or conceal an unclean shutdown",
          };
    } catch (error) {
      return PreflightObservationSchema.parse({
        check: this.check,
        state: "unhealthy",
        summary: `process-lock evidence is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        impact: "process liveness cannot be reconciled until the malformed record is reviewed",
      });
    }
  }
}

export interface DashboardPreflightRunnerInput {
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly artifactRoot: string;
  readonly processLockRoot: string;
  readonly backendPort: number;
  readonly frontendPort: number;
  readonly frontendOwnerNonce?: string;
  readonly backendOwned: () => boolean;
  readonly configFingerprint: string;
  readonly authorityDoctorOptions: unknown;
  readonly clock: Clock;
}

/** The exact six runners selected by `dashboard.serve`, in registry order. */
export function createDashboardPreflightRunners(input: DashboardPreflightRunnerInput): readonly PreflightRunner[] {
  const frontendOwnerNonce = input.frontendOwnerNonce === undefined
    ? undefined
    : DashboardLaunchNonceSchema.parse(input.frontendOwnerNonce);
  return Object.freeze([
    new RuntimeCompatibilityRunner(input.repoRoot),
    new ConfigValidRunner(input.configFingerprint),
    new FilesystemHealthRunner([input.stateRoot, input.artifactRoot]),
    new AuthorityHealthPreflightRunner(input.authorityDoctorOptions, input.clock),
    new PortsAvailableRunner(
      input.backendPort,
      input.frontendPort,
      input.backendOwned,
      input.clock,
      frontendOwnerNonce,
    ),
    new ProcessOrphansRunner(input.processLockRoot),
  ]);
}
