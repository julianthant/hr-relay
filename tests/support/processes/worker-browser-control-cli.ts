import { duoCeremonyGatesOver } from '../helpers/duo-ceremony-fixtures.js';
import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import assert from "node:assert/strict";
import type { BrowserProfileAuthority } from "../../../src/backend/app/composition/worker/run-resources.js";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { healthyRuntimePreflightRunners } from "../fixtures/preflight-seams.js";
/** Real worker loop and Chromium; every network request is fulfilled with synthetic HTML. */
import { appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext } from "playwright";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { PlaywrightWorkerSessionFactory } from "../../../src/backend/runtime/browser/browser-session-factory.js";
import { composeWorkerRuntime, createTimeoutDeadlineScheduler } from "../../../src/backend/app/composition/worker-compose.js";
import { resolveSystemEntryUrl } from "../../../src/models/config/instance.js";
import type { BrowserSystemBinding } from "../../../src/backend/runtime/browser/system-bindings.js";
import { healthyCrmDriver, healthyUcpathDriver } from "../helpers/phase1f-executor-harness.js";
import { captureSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { receiveRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialSecretSource, readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { scaledMs } from "../time-scale.js";

const [root, marker, ...workerArgs] = process.argv.slice(2);
assert.equal(workerArgs.at(-2), "--fixture-lock-port");
const port = Number(workerArgs.at(-1));
const args = workerArgs.slice(0, -2);
const controller = new AbortController();
const lifetimeLock = await receiveRuntimeLifetimeLock(port, () => controller.abort(new Error("fixture-parent-disconnected")));
if (root === undefined || marker !== "worker") throw new Error("fixture-worker-arguments");
const machine = acquireSharedRuntimeAdmission(root, lifetimeLock);
const contexts = new Set<BrowserContext>();
let admission: ReturnType<typeof machine.admitProfile> | undefined;
let database: AuthorityDatabase | undefined;
let runtimeEntered = false, runtimeClosureProved = false;
const failures: unknown[] = [];
try {
  const selected = captureSelectedProfileStorage(machine);
  const child = machine.admitProfile(createProfileRegistry(machine).storageClaim(selected.profileId));
  admission = child;
  const credentials = createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${selected.profileId}.json`) });
  database = AuthorityDatabase.open(child, { path: selected.authorityPath, busyTimeoutMs: 5000, migrationOwner: "browser-control-config" },
    systemClock, undefined, undefined, undefined, credentials);
  const resolvedConfig = resolveConfigWithProvenance(readSettings(database.authority).settings, hostConfigFacts({}), systemClock,
    { stateRoot: child.stateRoot, artifactRoot: child.artifactRoot }).config;
  assert.equal(resolvedConfig.paths.browserProfileRoot, join(child.stateRoot, "browsers"));
  const config = { ...resolvedConfig, paths: { ...resolvedConfig.paths, browserProfileRoot: join(child.stateRoot, "browsers") } };
  const protectedSecrets = createCredentialSecretSource({ read: () => { selected.assertCurrent(); return credentials.read(); } });
  const trace = (event: Record<string, unknown>) => appendFileSync(join(root,`browser-${String(process.pid)}.jsonl`),`${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
  const binding = (system: "crm" | "ucpath"): BrowserSystemBinding => ({
    system,
    createDriver: page => {
      const driver = system === "crm" ? healthyCrmDriver() : healthyUcpathDriver();
      // Semantic task results are synthetic; their browser ownership and turn are real.
      return new Proxy({ ...driver }, { get(target, key) {
        const value: unknown = Reflect.get(target,key);
        if (typeof value !== "function") return value;
        return async (...values: unknown[]) => {
          if (await page.locator("[data-authenticated]").count() !== 1) throw new Error("fixture-driver-not-authenticated");
          trace({ event: "driver", system, method: String(key), pid: process.pid });
          const deadline = systemClock.monotonicMs() + scaledMs(20_000);
          while (!existsSync(join(root,"release-drivers"))) {
            if (systemClock.monotonicMs() > deadline) throw new Error("fixture-driver-barrier-expired");
            await new Promise(resolve => setTimeout(resolve,25));
          }
          return Reflect.apply(value, target, values) as unknown;
        };
      } });
    },
    login: async ({ page, instance }) => {
      await page.goto(resolveSystemEntryUrl(config,system,instance,"fixture"));
      if (await page.locator("[data-authenticated]").count() !== 1) throw new Error("fixture-login-failed");
      trace({ event: "login", system, url: page.url() }); return "logged-in";
    },
    verifyAuthenticated: async ({ page }) => {
      const authenticated = await page.locator("[data-authenticated]").count() === 1 && await page.locator("input[type=password]").count() === 0;
      trace({ event: "verify", system, authenticated, url: page.url() });
      if (config.features.duoWebAuthn) {
        const workers = page.context().serviceWorkers().filter(worker => /^chrome-extension:\/\/[^/]+\/src\/workflow-background\.js$/.test(worker.url()));
        assert.equal(workers.length, 1);
        const worker = workers[0]; assert.ok(worker);
        const brokerOnly = await worker.evaluate(() => {
          const owner: unknown = Reflect.get(globalThis, "relayWorkflow");
          const chrome: unknown = Reflect.get(globalThis, "chrome");
          return typeof owner === "object" && owner !== null && typeof Reflect.get(owner, "next") === "function"
            && typeof chrome === "object" && chrome !== null && Reflect.get(chrome, "storage") === undefined;
        });
        assert.equal(brokerOnly, true);
      }
      return authenticated ? { authenticated: true, evidence: { system, url: page.url(), positive: "isolated fixture session marker", negative: "no sign-in form" } }
        : { authenticated: false, reason: "fixture-neutral-state-missing" };
    },
  });
  const createSessionFactory = (profiles: BrowserProfileAuthority) => new PlaywrightWorkerSessionFactory({ config, isolation: rebuildRuntimeIsolation, clock: systemClock,
    scheduler: createTimeoutDeadlineScheduler(systemClock), newSessionId: randomUUID,
    ...profiles,
    protectedSecrets,
    bindings: { crm: binding("crm"), ucpath: binding("ucpath") },
    launcher: { launch: async input => {
      trace({ event: "launch-start", profileDirectory: input.profileDirectory });
      const context = await chromium.launchPersistentContext(input.profileDirectory, { channel: 'chromium', headless: input.headless,
        viewport: input.viewport, acceptDownloads: input.acceptDownloads, downloadsPath: input.downloadsPath,
        args: [`--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`] });
      contexts.add(context); trace({ event: "open", profileDirectory: input.profileDirectory });
      context.on("close", () => { contexts.delete(context); trace({ event: "close", profileDirectory: input.profileDirectory }); });
      await context.route("**/*", async route => { trace({ event: "fixture-request", url: route.request().url() });
        await route.fulfill({ contentType: "text/html", body: '<!doctype html><title>Isolated session fixture</title><main data-authenticated>Fixture account</main>' }); });
      return context;
    } },
  });
  const scheduler = createTimeoutDeadlineScheduler(systemClock);
  const duoCeremony = duoCeremonyGatesOver(database, systemClock, scheduler);
  runtimeEntered = true;
  const report = await composeWorkerRuntime({ lifetimeLock, stopSignal: controller.signal, admission: machine, preflightRunnerFactory: healthyRuntimePreflightRunners, repoRoot: root, isolation: rebuildRuntimeIsolation, args, env: {},
    createSessionFactory, duoCeremony, heartbeatIntervalMs: 100, });
  assert.equal(report.closure, 'proved');
  runtimeClosureProved = true;
  writeFileSync(join(root,`report-${String(process.pid)}.json`),JSON.stringify(report));
} catch (error) {
  failures.push(error);
} finally {
  const cleanupFailures: unknown[] = [];
  if (!runtimeEntered || runtimeClosureProved) {
    const results = await Promise.allSettled([...contexts].map(async context => { await context.close(); }));
    cleanupFailures.push(...results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []));
    if (cleanupFailures.length === 0 && database !== undefined) {
      try { database.close(); database = undefined; }
      catch (error) { cleanupFailures.push(retainAuthoritySourceClosure([...failures, error], { database, admission: machine, directory: { lifetimeLock } })); }
    }
    if (cleanupFailures.length === 0) {
      for (const close of [() => admission?.release(), () => machine.release()]) {
        try { close(); } catch (error) { cleanupFailures.push(error); break; }
      }
    }
  }
  if (cleanupFailures.length === 0 && (!runtimeEntered || runtimeClosureProved)) await lifetimeLock.close();
  try { writeFileSync(join(root,`cleanup-${String(process.pid)}.json`), JSON.stringify({ openContexts: contexts.size, failures: cleanupFailures.length + (runtimeEntered && !runtimeClosureProved ? 1 : 0) })); } catch (error) { cleanupFailures.push(error); }
  failures.push(...cleanupFailures);
}
if (failures.length > 0) throw new AggregateError(failures, "browser-control-worker-failed", { cause: failures[0] });
