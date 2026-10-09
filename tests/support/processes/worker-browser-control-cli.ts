import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { healthyRuntimePreflightRunners } from "../fixtures/preflight-seams.js";
/** Real worker loop and Chromium; every network request is fulfilled with synthetic HTML. */
import { appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext } from "playwright";
import { ConfigSchema } from "../../../src/models/config/schema.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { PlaywrightWorkerSessionFactory } from "../../../src/backend/runtime/browser/browser-session-factory.js";
import { composeWorkerRuntime, createTimeoutDeadlineScheduler } from "../../../src/backend/app/composition/worker-compose.js";
import { resolveSystemEntryUrl } from "../../../src/models/config/instance.js";
import type { BrowserSystemBinding } from "../../../src/backend/runtime/browser/system-bindings.js";
import { healthyCrmDriver, healthyUcpathDriver } from "../helpers/phase1f-executor-harness.js";
import { fixtureDuoCeremonyGates } from "../helpers/duo-ceremony-fixtures.js";
import { protectedSecretSource } from "../helpers/protected-secret-source.js";

const [root, marker, ...args] = process.argv.slice(2);
if (root === undefined || marker !== "worker") throw new Error("fixture-worker-arguments");
const base = resolveConfigWithProvenance({}, hostConfigFacts({}), systemClock).config;
const config = ConfigSchema.parse({ ...base, browser: { ...base.browser, headless: true },
  features: { ...base.features, duoWebAuthn: false }, paths: { ...base.paths,
    browserProfileRoot: join(root,"profiles"), downloadsDir: join(root,"downloads") } });
const contexts = new Set<BrowserContext>();
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
const factory = new PlaywrightWorkerSessionFactory({ config, isolation: rebuildRuntimeIsolation, clock: systemClock,
  scheduler: createTimeoutDeadlineScheduler(systemClock), newSessionId: randomUUID,
  protectedSecrets: protectedSecretSource({ ucpathUserId: "synthetic", ucpathPassword: "synthetic" }),
  bindings: { crm: binding("crm"), ucpath: binding("ucpath") },
  launcher: { launch: async input => {
    const context = await chromium.launchPersistentContext(input.profileDirectory, { headless: true, viewport: input.viewport, acceptDownloads: input.acceptDownloads });
    contexts.add(context); trace({ event: "open", profileDirectory: input.profileDirectory });
    context.on("close", () => { contexts.delete(context); trace({ event: "close", profileDirectory: input.profileDirectory }); });
    await context.route("**/*", async route => { trace({ event: "fixture-request", url: route.request().url() });
      await route.fulfill({ contentType: "text/html", body: '<!doctype html><title>Isolated session fixture</title><main data-authenticated>Fixture account</main>' }); });
    return context;
  } },
});
const admission = acquireEntrypointAdmission(root, "shared");
try {
  const report = await composeWorkerRuntime({ admission, preflightRunnerFactory: healthyRuntimePreflightRunners, repoRoot: root, isolation: rebuildRuntimeIsolation, args, env: {},
    sessionFactory: factory, duoCeremony: fixtureDuoCeremonyGates(systemClock), heartbeatIntervalMs: 100, sweepIntervalMs: 60_000 });
  writeFileSync(join(root,`report-${String(process.pid)}.json`),JSON.stringify(report));
} finally {
  const results = await Promise.allSettled([...contexts].map(async context => { await context.close(); }));
  admission.release();
  writeFileSync(join(root,`cleanup-${String(process.pid)}.json`), JSON.stringify({ openContexts: contexts.size, failures: results.filter(value => value.status === "rejected").length }));
}
