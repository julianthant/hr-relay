import { createCredentialStore } from "../../src/backend/storage/configuration/credential-store.js";
import { acquireEntrypointAdmission } from "../../src/backend/storage/admission/bootstrap-admission.js";
import { fileURLToPath } from "node:url";
import { hostConfigFacts } from "../../src/models/config/host-display.js";
/**
 * Live login smoke for the worker browser-session factory.
 *
 *   npx tsx scripts/verify/browser-login.ts ucpath
 *   npx tsx scripts/verify/browser-login.ts crm
 *   npx tsx scripts/verify/browser-login.ts ucpath --headed
 *   npx tsx scripts/verify/browser-login.ts ucpath --cold
 *   npx tsx scripts/verify/browser-login.ts ucpath --reuse
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
 *   - protected Settings with `ucpathUserId` / `ucpathPassword`;
 *   - the unpacked Duo Autopilot extension at `config.paths.duoExtensionDir`
 *     (default `<repo>/duo-autopilot`, must contain `manifest.json`);
 *   - the Duo credential at `config.paths.duoCredential`
 *     (`.auth-rebuild/duo-webauthn.json`), mode 0600 or stricter;
 *   - Playwright's FULL bundled Chromium installed
 *     (`npx playwright install chromium`) — the headless shell cannot load an
 *     extension.
 *
 * Config comes from settings + schema defaults, NOT from environment overrides.
 * Credentials arrive through `domain/secrets.ts` from protected Settings.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { composeDuoCeremonyGateFactory } from "../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../src/backend/app/config/resolve.js";
import { RuntimeInstanceSchema } from "../../src/models/config/instance.js";
import { assertNoMigratedEnvironmentKeys, hostAwareResolutionEnvironment } from "../../src/models/config/secrets.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../src/rules/identity/ids.js";
import {
  PlaywrightWorkerSessionFactory,
  workerProfileDirectory,
} from "../../src/backend/runtime/browser/browser-session-factory.js";
import type { BrowserDeadlineScheduler } from "../../src/backend/runtime/browser/browser-session-factory.js";
import { createCredentialSecretSource, readSettings } from "../../src/backend/runtime/settings/settings-runtime.js";
import { probePrimaryDisplay } from "../../src/backend/app/host/primary-display.js";
import type { AuthenticatedApplicationEvidence } from "../../src/backend/systems/browser-shared/login-contract.js";
import { AuthorityDatabase } from "../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";

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
  const headed = process.argv.includes("--headed");
  // `--worker <id>` lets two smokes run side by side on distinct profiles —
  // the D267 live two-worker cold start (ref execution-and-sessions §10.8).
  const workerFlag = process.argv.indexOf("--worker");
  const workerId = WorkerIdSchema.parse(workerFlag === -1 ? "live-smoke-worker-1" : process.argv[workerFlag + 1]);
  const workspace = fileURLToPath(new URL("../..", import.meta.url));
  const admission = acquireEntrypointAdmission(workspace, "shared");
  try {
  assertNoMigratedEnvironmentKeys();
  const stateRoot = admission.stateRoot;
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot, "live-smoke", workerId);
  const processLock = acquireRuntimeProcessLock(
    { processLockRoot, name: "live-smoke", pid: process.pid },
    systemClock,
  );

  // D267: the Duo ceremony lease lives in the REAL authority database, so two
  // smokes (or a smoke beside a worker) serialize their ceremonies for real.
  const database = AuthorityDatabase.open(
    admission,
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "live-smoke" },
    systemClock,
  );
  try {
  const hostFacts = hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay));
  const record = database.withAuthorityTransaction((repositories) => readSettings(repositories));
  const config = resolveConfigWithProvenance(record.settings, hostFacts, systemClock).config;
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
  const protectedAuthority = createCredentialStore({ admission, stateRoot });
  const factory = new PlaywrightWorkerSessionFactory({
    config: { ...config, browser: { ...config.browser, headless: !headed } },
    protectedSecrets: createCredentialSecretSource(protectedAuthority),
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
  // `src/backend/app/composition/worker-compose.ts` and `src/backend/app/composition/dashboard/compose.ts` use for `workers`/`server`.
  // Without it this script could open (and migrate) the real authority database with no runtime-lock
  // record of itself at all, and a live smoke was invisible to `cli storage restore`'s stopped-system
  // proof. `acquireRuntimeProcessLock` refuses loudly if another live `live-smoke` process already
  // holds it — no fallback, no silent queueing.
  // D267's LIVE proof needs two smokes alive at once (ref execution-and-sessions
  // §10.8), and one shared `live-smoke` lock file refuses the second by design.
  // So the lock ROOT is scoped by worker id: every smoke still takes — and can
  // still be refused on — its own `live-smoke` lock, so two processes under ONE
  // worker id (one profile directory, one `--cold` clear of it) still cannot
  // overlap, while two DIFFERENT worker ids serialize only on the Duo ceremony
  // lease, which is the thing under proof. What that gives up is named rather
  // than hidden: two differently-named smokes may open the authority database
  // together, so a database that still needs migrating must be brought to the
  // current schema by ONE smoke first — which is why §10.8's how-to runs a
  // single cold worker before the pair.
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
    defaultBrowserMode: headed ? "headed" : "headless",
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
  } finally {
    database.close();
    processLock.release();
  }
  } finally {
    admission.release();
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
});
