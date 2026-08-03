/**
 * Live login smoke for the worker browser-session factory.
 *
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts crm
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath --headed
 *
 * It drives the REAL factory, the REAL store login recipe, and the REAL
 * `WorkerSessionManager` lease against production SSO — the only pieces that
 * are smoke-specific are the run identity (a synthetic worker id and config
 * fingerprint) and the process-edge clock/scheduler/uuid.
 *
 * It performs a login and a neutral reset. It never runs a workflow node and
 * never commits anything, so there is no UCPath transaction to guard.
 *
 * Preconditions (all fail loud, individually, before a browser opens):
 *   - `.env` with `UCPATH_USER_ID` / `UCPATH_PASSWORD`;
 *   - the unpacked Duo Autopilot extension at `config.paths.duoExtensionDir`
 *     (default `<repo>/duo-autopilot`, must contain `manifest.json`);
 *   - the Duo credential at `config.paths.duoCredential`
 *     (`.auth-rebuild/duo-webauthn.json`), mode 0600 or stricter;
 *   - Playwright's FULL bundled Chromium installed
 *     (`npx playwright install chromium`) — the headless shell cannot load an
 *     extension.
 *
 * Config comes from settings + schema defaults, NOT from environment overrides:
 * the runtime environment registry is a closed inventory, and a smoke has no
 * business widening it. Credentials still arrive through `domain/secrets.ts`,
 * which is the registered reader, so `--env-file=.env` is still required.
 */
import { randomUUID } from "node:crypto";
import { rebuildRuntimeIsolation } from "../src/config/runtime-isolation.js";
import { WorkerSessionManager } from "../src/core/worker-sessions.js";
import { systemClock } from "../src/domain/clock.js";
import { resolveConfig } from "../src/domain/config/resolve.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../src/domain/ids.js";
import { PlaywrightWorkerSessionFactory } from "../src/infra/browser/browser-session-factory.js";
import type { BrowserDeadlineScheduler } from "../src/infra/browser/browser-session-factory.js";
import { taskStoreRegistry } from "../src/stores/index.js";

const SUPPORTED = new Set(["ucpath", "crm"]);

const realScheduler: BrowserDeadlineScheduler = {
  schedule(deadlineMonotonicMs, onDeadline) {
    const handle = setTimeout(onDeadline, Math.max(0, deadlineMonotonicMs - systemClock.monotonicMs()));
    return { cancel: () => { clearTimeout(handle); } };
  },
};

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const requested = process.argv[2];
  if (requested === undefined || !SUPPORTED.has(requested)) {
    throw new Error(`usage: live-browser-login-smoke <${[...SUPPORTED].join("|")}>`);
  }
  const system = BrowserSystemIdSchema.parse(requested);
  const config = resolveConfig({}, {}, systemClock);
  const headed = process.argv.includes("--headed");
  const workerId = WorkerIdSchema.parse("live-smoke-worker-1");
  const workflowId = WorkflowIdSchema.parse("person-lookup");
  // A synthetic but well-formed reuse identity: the smoke is one "run".
  const configFingerprint = FingerprintSchema.parse(
    randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
  );

  const factory = new PlaywrightWorkerSessionFactory({
    config: { ...config, browser: { ...config.browser, headless: !headed } },
    isolation: rebuildRuntimeIsolation,
    clock: systemClock,
    scheduler: realScheduler,
    newSessionId: () => randomUUID(),
  });

  const sessions = new WorkerSessionManager({
    workerId,
    workflowId,
    stores: taskStoreRegistry,
    factory,
    clock: systemClock,
    onEvent: (event) => {
      write(`[session] ${event.type} ${event.system} ${event.sessionId}`);
    },
  });
  sessions.bindRunConfigFingerprint(configFingerprint);

  const started = systemClock.monotonicMs();
  await sessions.withDriver(
    { system, access: "read", session: "reuse-worker" },
    "prod",
    new AbortController().signal,
    async (driver) => {
      write(`[smoke] authenticated ${driver.system}; the lease callback holds a live driver`);
    },
  );
  write(`[smoke] ${system} login + neutral reset verified in ${String(Math.round(systemClock.monotonicMs() - started))}ms`);
  await sessions.closeAll("worker-stop");
  write("[smoke] every session closed with proof");
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
});
