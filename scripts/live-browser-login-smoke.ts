/**
 * Live login smoke for the worker browser-session factory.
 *
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts crm
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath --headed
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath --cold
 *   npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath --reuse
 *
 * It drives the REAL factory, the REAL store login recipe, and the REAL
 * `WorkerSessionManager` lease against production SSO — the only pieces that
 * are smoke-specific are the run identity (a synthetic worker id and config
 * fingerprint) and the process-edge clock/scheduler/uuid.
 *
 * It performs a login and a neutral reset. It never runs a workflow node and
 * never commits anything, so there is no UCPath transaction to guard.
 *
 * ## What it must REPORT, not just do (2026-08-03)
 *
 * This smoke once "passed" in ~3 seconds against a page that was never logged
 * in. Two things let that read as success: the recipes concluded authentication
 * from a URL, and this script threw the `LoginResult` away, so
 * `already-authenticated` and `logged-in` printed identically. Both halves are
 * fixed; the reporting half is here. Every run now prints:
 *
 *   - which of `logged-in` / `already-authenticated` happened, per session; and
 *   - the EVIDENCE that proved the authenticated application — the positive
 *     content-level artifact and the sign-in-form absences, never a value.
 *
 * A run that cannot prove a real authenticated application throws and exits
 * non-zero. A suspiciously fast `already-authenticated` on a profile you
 * believed was cold is a finding to investigate, not a pass — `--cold` removes
 * this smoke's OWN profile directory first so the question does not arise.
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
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../src/config/runtime-isolation.js";
import { composeDuoCeremonyGateFactory } from "../src/core/duo-ceremony-gate.js";
import { WorkerSessionManager } from "../src/core/worker-sessions.js";
import { systemClock } from "../src/domain/clock.js";
import { resolveConfig } from "../src/domain/config/resolve.js";
import { RuntimeInstanceSchema } from "../src/domain/config/instance.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../src/domain/ids.js";
import {
  PlaywrightWorkerSessionFactory,
  workerProfileDirectory,
} from "../src/infra/browser/browser-session-factory.js";
import type { BrowserDeadlineScheduler } from "../src/infra/browser/browser-session-factory.js";
import type { AuthenticatedApplicationEvidence } from "../src/infra/browser/login-contract.js";
import { AuthorityDatabase } from "../src/infra/sqlite/authority-database.js";
import { acquireRuntimeProcessLock } from "../src/infra/sqlite/runtime-process-locks.js";
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

function elapsed(since: number): string {
  return `${((systemClock.monotonicMs() - since) / 1_000).toFixed(1)}s`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch (error) {
    return `<unparseable navigation target: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

async function main(): Promise<void> {
  const requested = process.argv[2];
  if (requested === undefined || !SUPPORTED.has(requested)) {
    throw new Error(`usage: live-browser-login-smoke <${[...SUPPORTED].join("|")}> [--headed] [--cold] [--reuse]`);
  }
  const system = BrowserSystemIdSchema.parse(requested);
  const config = resolveConfig({}, {}, systemClock);
  const headed = process.argv.includes("--headed");
  // `--worker <id>` lets two smokes run side by side on distinct profiles —
  // the D267 live two-worker cold start (ref execution-and-sessions §10.8).
  const workerFlag = process.argv.indexOf("--worker");
  const workerId = WorkerIdSchema.parse(workerFlag === -1 ? "live-smoke-worker-1" : process.argv[workerFlag + 1]);
  const workflowId = WorkflowIdSchema.parse("person-lookup");
  const instance = RuntimeInstanceSchema.parse("prod");
  // A synthetic but well-formed reuse identity: the smoke is one "run", and a
  // fresh fingerprint means a fresh profile directory (D116 partitions the
  // profile by fingerprint). `--reuse` pins it, so a second run rides the same
  // persistent profile and its live IdP session.
  //
  // Live-measured 2026-08-03: that shortens UCPath from ~21.5s to ~15.0s and
  // still reports `logged-in`, because a persistent context always opens on
  // about:blank and this recipe enters at the UCSD portal — neither is a
  // PeopleSoft application route, so the two-fact probe correctly refuses to
  // call it an existing session. `already-authenticated` is therefore a
  // defensive branch here, pinned by unit arms rather than by a live run.
  const configFingerprint = FingerprintSchema.parse(
    process.argv.includes("--reuse")
      ? "5eed".repeat(16)
      : randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
  );

  if (process.argv.includes("--cold")) {
    // Exactly THIS smoke's profile directory, derived by the same production
    // function the factory uses. It is several levels below the credential
    // home, so the enrolled Duo WebAuthn key is never in scope.
    const profileDirectory = workerProfileDirectory({
      profileRoot: config.paths.browserProfileRoot,
      isolation: rebuildRuntimeIsolation,
      workerId, system, instance, configFingerprint,
    });
    const workerRoot = profileDirectory.slice(0, profileDirectory.lastIndexOf("/"));
    if (!workerRoot.includes(rebuildRuntimeIsolation.browserSessionNamespace) || !workerRoot.endsWith(workerId)) {
      throw new Error(`refusing to clear ${workerRoot}: it is not this smoke's worker profile home`);
    }
    rmSync(workerRoot, { recursive: true, force: true });
    write(`[smoke] cold start: cleared ${workerRoot}`);
  }

  const evidence: AuthenticatedApplicationEvidence[] = [];
  const hops: string[] = [];
  const factory = new PlaywrightWorkerSessionFactory({
    config: { ...config, browser: { ...config.browser, headless: !headed } },
    isolation: rebuildRuntimeIsolation,
    clock: systemClock,
    scheduler: realScheduler,
    newSessionId: () => randomUUID(),
    onAuthenticationEvidence: (observed) => {
      evidence.push(observed);
      write(`[evidence] ${observed.system} @ ${observed.url}`);
      write(`[evidence]   positive: ${observed.positive}`);
      write(`[evidence]   negative: ${observed.negative}`);
    },
    onNavigation: (url) => {
      hops.push(url);
      // Host only: a Shibboleth/Duo hop URL carries execution ids and SAML
      // payloads that have no business in a log.
      write(`[hop] ${String(hops.length).padStart(2, "0")} ${hostOf(url)}`);
    },
  });

  // Review finding 3 (ref execution-and-sessions §10): the `live-smoke` role lock, taken BEFORE the
  // database opens and released after it closes — the same acquire/open/…/close/release discipline
  // `src/server/worker/compose.ts` and `src/server/dashboard/compose.ts` use for `workers`/`server`.
  // Without it this script could open (and migrate) the real authority database with no runtime-lock
  // record of itself at all, and a live smoke was invisible to `cli storage restore`'s stopped-system
  // proof. `acquireRuntimeProcessLock` refuses loudly if another live `live-smoke` process already
  // holds it — no fallback, no silent queueing.
  const processLockRoot = join(process.cwd(), rebuildRuntimeIsolation.processLockRoot);
  const processLock = acquireRuntimeProcessLock(
    { processLockRoot, name: "live-smoke", pid: process.pid },
    systemClock,
  );

  // D267: the Duo ceremony lease lives in the REAL authority database, so two
  // smokes (or a smoke beside a worker) serialize their ceremonies for real.
  const stateRoot = join(process.cwd(), rebuildRuntimeIsolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "live-smoke" },
    systemClock,
  );
  const duoCeremony = composeDuoCeremonyGateFactory({
    config, leases: database.authority.duoCeremonyLeases, clock: systemClock, scheduler: realScheduler,
  });

  const started = systemClock.monotonicMs();
  const sessions = new WorkerSessionManager({
    workerId,
    workflowId,
    stores: taskStoreRegistry,
    factory,
    clock: systemClock,
    scheduler: realScheduler,
    acquireDeadlineMs: config.timeouts.sessionAcquireMs,
    duoCeremony,
    onEvent: (event) => {
      const detail = event.type === "browser-session:start" ? ` login=${event.login}` : "";
      write(`[session] ${event.type} ${event.system} ${event.sessionId}${detail} (+${elapsed(started)})`);
    },
  });
  sessions.bindRunConfigFingerprint(configFingerprint);

  await sessions.withDriver(
    { system, access: "read", session: "reuse-worker" },
    instance,
    new AbortController().signal,
    async (driver) => {
      write(`[smoke] authenticated ${driver.system}; the lease callback holds a live driver (+${elapsed(started)})`);
    },
  );
  // The lease releases through the neutral reset, which re-runs the SAME proof.
  // Two evidence records — login and reset — is what a real session produces.
  if (evidence.length < 2) {
    throw new Error(
      `${system} smoke observed ${String(evidence.length)} authentication proof(s); a login and its neutral reset must each produce one`,
    );
  }
  write(`[smoke] hop chain (hosts, in order): ${[...new Set(hops.map(hostOf))].join(" → ")}`);
  write(`[smoke] ${system} login + neutral reset verified in ${elapsed(started)}`);
  await sessions.closeAll("worker-stop");
  write("[smoke] every session closed with proof");
  database.close();
  processLock.release();
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
});
