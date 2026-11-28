import { type ApplicationUpdateHost } from "../../../runs/lifecycle/application-lifecycle.js";
import type { ProfileOnboardingDuoProvider } from "../../../profiles/onboarding-duo.js";
import type { OnboardingDuoProviderOptions } from "../../../runtime/browser/onboarding-duo-provider.js";
import { RuntimeAdmission } from "../../../storage/admission/admission.js";
import type { RuntimePreflightRunnerFactory } from "../../preflight/runtime-runners.js";
import type { probeOwnedViteServer } from "../../host/local-vite-probe.js";
import type { DashboardBuildCommand } from "./build-identity.js";
import { createTrustNotifications } from "./notifications.js";
import type { createProfileSettingsProcesses } from "./profile-settings-processes.js";
import { z } from "zod";
import type { PreflightReportWireSchema } from "../../../../models/preflight/preflight-contract.js";
import type { RuntimeIsolation } from "../../../../models/config/define-runtime-isolation.js";
import { type IdFactory } from "../../../../rules/identity/identifiers.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { MonotonicDeadlineScheduler } from "../../../runtime/scheduling/deadline-scheduler.js";
import { type WorkerCliLaunchSpec,type WorkerProcessSpawner,type WorkerSpawnRequest } from "./worker-process.js";
import { RuntimeLifetimeLock } from "../../../storage/admission/lifetime-lock.js";
import { type NoteTimelineWriter } from "../../../storage/events/note-timeline-writer.js";
import { composeProfileRuntime,type ShutdownBackup } from "../storage-compose.js";
import { startDashboardHttpServer,type DashboardHttpListener,type DashboardHttpServer } from "../../../transports/http/http-server.js";

export type DashboardStopFailure = Readonly<{ step: "transport-close" | "stream-close" | "loop-monitor-stop" | "worker-stop"; cause: unknown }>;

export interface DashboardRuntime {
  readonly shutdownRequested?: Promise<void>;
  readonly port: number;
  readonly noteWriter: NoteTimelineWriter;
  readonly notificationStatus: ReturnType<typeof createTrustNotifications>["observer"]["status"];
  detach(onStopFailure?: (failure: DashboardStopFailure) => void): Promise<void>;
  stop(): Promise<void>;
}

export const DashboardFrontendModeSchema = z.enum(["vite-dev", "built-bundle"]);
export type DashboardFrontendMode = z.infer<typeof DashboardFrontendModeSchema>;

export interface DashboardComposeInput {
  readonly onInitialPreflight?: (report: z.infer<typeof PreflightReportWireSchema>) => void;
  readonly requestApplicationQuit?: () => void;
  readonly updateHost?: ApplicationUpdateHost;
  readonly lifetimeLock: RuntimeLifetimeLock;
  /** Omit to take the quit-time backup inside this process before stop resolves. */
  readonly shutdownBackup?: ShutdownBackup;
  readonly onboardingDuo?: ProfileOnboardingDuoProvider;
  readonly copySignin?: OnboardingDuoProviderOptions["copySignin"];
  readonly profileSettingsProcesses?: typeof createProfileSettingsProcesses;
  readonly admission?: RuntimeAdmission;
  readonly profile?: Readonly<{ runtime: ReturnType<typeof composeProfileRuntime>; token: string }>;
  readonly isolation: RuntimeIsolation;
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  /** Omit to run the production event-loop stall monitor. `false` leaves it off. A monitor is installed as given and stopped on shutdown. */
  readonly loopDelay?: false | Readonly<{ stop(): void }>;
  readonly ids?: IdFactory;
  /** Package and frontend source root; storage roots come from installation admission. */
  readonly repoRoot?: string;
  // `vite-dev` delegates frontend bytes to Vite; `built-bundle` serves the validated local bundle.
  readonly frontend?: DashboardFrontendMode;
  readonly frontendBuildScript?: DashboardBuildCommand;
  readonly startPlanTtlMs?: number;
  // Port 0 requests an ephemeral test port.
  readonly backendPortOverride?: number;
  readonly preflightRunnerFactory?: RuntimePreflightRunnerFactory;
  /** Test-only replacement for injecting an HTTP bind failure after startup admission. */
  readonly httpServerStarter?: (input: Parameters<typeof startDashboardHttpServer>[0]) => Promise<DashboardHttpServer>;
  readonly applicationTransport?: Readonly<{
    listener: DashboardHttpListener;
    accepts: (request: Request) => boolean;
    consumeAdmission(request: Request): void;
  }>;
  /** Tests may name their own frontend listener. Zero disables the frontend preflight port check. */
  readonly frontendPortOverride?: number;
  /** Test-only replacement for the dev-frontend ownership probe of profile requests. */
  readonly frontendProbe?: typeof probeOwnedViteServer;

  readonly workerProcess?: Readonly<{
    spawn?(request: WorkerSpawnRequest, productionSpawn: WorkerProcessSpawner): ReturnType<WorkerProcessSpawner>;
    launch?: WorkerCliLaunchSpec;
    scheduler?: MonotonicDeadlineScheduler;
    /** Receives one structured JSON line per supervisor fault; default writes to stderr. */
    faultSink?: (line: string) => void;
  }>;
}

export const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();



export type StartupCleanup = () => void | Promise<void>;
export interface StartupCustody { revoke?: () => void; readonly failedClosures: unknown[]; transportClosed: boolean; closeWorkerControl?: StartupCleanup }
