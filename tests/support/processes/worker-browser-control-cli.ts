import assert from "node:assert/strict";
import type { BrowserProfileAuthority } from "../../../src/backend/app/composition/worker/run-resources.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
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
import { acquireRuntimeProcessLock } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createCredentialSecretSource, readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";

const [root, marker, ...args] = process.argv.slice(2);
if (root === undefined || marker !== "worker") throw new Error("fixture-worker-arguments");
const machine = acquireEntrypointAdmission(root, "shared");
const contexts = new Set<BrowserContext>();
let admission: ReturnType<typeof machine.admitProfile> | undefined;
let custody: ReturnType<typeof acquireRuntimeProcessLock> | undefined;
let custodyTransferred = false;
const failures: unknown[] = [];
try {
  const selected = captureSelectedProfileStorage(machine);
  const initialCustody = acquireRuntimeProcessLock({ processLockRoot: join(root, rebuildRuntimeIsolation.processLockRoot), name: "workers",
    pid: process.pid, admission: { kind: "unbound-worker", authorityPath: selected.authorityPath } }, systemClock);
  custody = initialCustody;
  const child = machine.admitProfile(createProfileRegistry(machine).storageClaim(selected.profileId));
  admission = child;
  const credentials = createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${selected.profileId}.json`) });
  const database = AuthorityDatabase.open(child, { path: selected.authorityPath, busyTimeoutMs: 5000, migrationOwner: "browser-control-config" },
    systemClock, undefined, undefined, undefined, credentials);
  const resolvedConfig = (() => {
    try { return resolveConfigWithProvenance(readSettings(database.authority).settings, hostConfigFacts({}), systemClock,
      { stateRoot: child.stateRoot, artifactRoot: child.artifactRoot }).config; }
    finally { database.close(); }
  })();
  assert.equal(resolvedConfig.paths.browserProfileRoot, join(child.stateRoot, "browsers"));
  const config = { ...resolvedConfig, paths: { ...resolvedConfig.paths, browserProfileRoot: join(child.stateRoot, "browsers") } };
  const protectedSecrets = createCredentialSecretSource({ read: () => { selected.assertCurrent(); return credentials.read(); } });
  const trace = (event: Record<string, unknown>) => appendFileSync(join(root,`browser-${String(process.pid)}.jsonl`),`${JSON.stringify(event)}\n`);
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
          const deadline = systemClock.monotonicMs() + 20_000;
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
      const context = await chromium.launchPersistentContext(input.profileDirectory, { channel: "chromium", headless: true, viewport: input.viewport, acceptDownloads: input.acceptDownloads });
      contexts.add(context); trace({ event: "open", profileDirectory: input.profileDirectory });
      context.on("close", () => { contexts.delete(context); trace({ event: "close", profileDirectory: input.profileDirectory }); });
      await context.route("**/*", async route => { trace({ event: "fixture-request", url: route.request().url() });
        await route.fulfill({ contentType: "text/html", body: '<!doctype html><title>Isolated session fixture</title><main data-authenticated>Fixture account</main>' }); });
      return context;
    } },
  });
  const report = await composeWorkerRuntime({ admission: machine, preflightRunnerFactory: healthyRuntimePreflightRunners, repoRoot: root, isolation: rebuildRuntimeIsolation, args, env: {},
    createSessionFactory, takeInitialCustody: () => { custodyTransferred = true; return initialCustody; }, heartbeatIntervalMs: 100, sweepIntervalMs: 60_000 });
  writeFileSync(join(root,`report-${String(process.pid)}.json`),JSON.stringify(report));
} catch (error) {
  failures.push(error);
} finally {
  const results = await Promise.allSettled([...contexts].map(async context => { await context.close(); }));
  const cleanupFailures: unknown[] = results.flatMap(value => value.status === "rejected" ? [value.reason as unknown] : []);
  for (const close of [() => { if (!custodyTransferred) custody?.release(); }, () => admission?.release(), () => machine.release()]) {
    try { close(); } catch (error) { cleanupFailures.push(error); }
  }
  writeFileSync(join(root,`cleanup-${String(process.pid)}.json`), JSON.stringify({ openContexts: contexts.size, failures: cleanupFailures.length }));
  failures.push(...cleanupFailures);
}
if (failures.length > 0) throw new AggregateError(failures, "browser-control-worker-failed");
