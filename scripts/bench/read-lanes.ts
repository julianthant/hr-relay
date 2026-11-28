import { execFileSync, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV, workerBootstrapEnvironment } from "../../src/models/config/secrets.js";
import { WorkflowIdSchema } from "../../src/rules/identity/ids.js";
import { systemClock } from "../../src/rules/time/clock.js";

/** G2: each shape passes on its own when every run is ready within this time and adds at most this RSS. */
const READY_LIMIT_MS = 5_000;
const ADDED_RSS_LIMIT_BYTES = 350 * 1024 * 1024;
const SETTLE_MS = 500;

const ShapeSchema = z.enum(["A", "B"]);
type Shape = z.infer<typeof ShapeSchema>;
const CopyProfileSchema = z.enum(["staging", "development"]);
type CopyProfile = z.infer<typeof CopyProfileSchema>;
const LANES = Object.freeze({ A: ["navigation"], B: ["navigation", "search"] } as const);

const RunSchema = z.strictObject({ shape: ShapeSchema, readyMs: z.number().nonnegative(), firstReadMs: z.number().nonnegative(),
  rssBeforeBytes: z.int().positive(), rssReadyBytes: z.int().positive(), rssAfterReadBytes: z.int().positive(), addedRssBytes: z.int(),
  historyArchive: z.boolean(), cursorOffset: z.int().nonnegative(), timelineHighWater: z.int().nonnegative() });
type Run = z.infer<typeof RunSchema>;

/** One shape in one fresh process: open the copy's store as the dashboard does, then start the real read host. */
async function measure(shape: Shape, workspace: string, lockPort: number): Promise<Run> {
  const hook = withLaneRoute(shape);
  try { return await measureReadHost(shape, workspace, lockPort); }
  finally { hook.deregister(); }
}

async function measureReadHost(shape: Shape, workspace: string, lockPort: number): Promise<Run> {
  const [{ acquireRuntimeLifetimeLock }, { acquireEntrypointAdmission }, { createCredentialStore }, { AuthorityDatabase },
    { createDashboardReadHost }, { createDashboardBackgroundReader }] = await Promise.all([
    import("../../src/backend/storage/admission/lifetime-lock.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/configuration/credential-store.js"),
    import("../../src/backend/storage/sqlite/authority-database.js"),
    import("../../src/backend/storage/sqlite/dashboard-read-host.js"),
    import("../../src/backend/storage/sqlite/dashboard-background-read-worker.js"),
  ]);
  const lock = await acquireRuntimeLifetimeLock(lockPort);
  try {
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
    try {
      const { activeProfileId } = machine.readProfileRegistry();
      if (activeProfileId === null) throw new Error("read-lanes-bench-sign-in-required: sign in to the copy and quit without signing out");
      const admission = machine.admitProfile(activeProfileId);
      try {
        const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
        const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000,
          migrationOwner: "read-lanes-bench" }, systemClock, undefined, undefined, undefined, credentials);
        try {
          const history = database.dashboardHistory();
          if (history === database) throw new Error("read-lanes-bench-history-required: import history with the profile copy command first");
          const cursorOffset = history.timelineCursorOffset(), timelineHighWater = history.authority.timelineEvents.highWaterMark();
          await delay(SETTLE_MS);
          const rssBeforeBytes = process.memoryUsage.rss();
          const started = performance.now();
          const lanes = createDashboardReadHost({ admission, database, clock: systemClock,
            entry: new URL("../../src/backend/app/composition/dashboard/read-lane-entry.js", import.meta.url) });
          try {
            await lanes.ready;
            const readyMs = performance.now() - started;
            const rssReadyBytes = process.memoryUsage.rss();
            const reading = performance.now();
            const page = await createDashboardBackgroundReader(lanes).read({ after: 0, limit: 100, nowMs: systemClock.nowMs() });
            const firstReadMs = performance.now() - reading;
            if (page.through !== timelineHighWater) throw new Error("read-lanes-bench-history-mismatch");
            await delay(SETTLE_MS);
            const rssAfterReadBytes = process.memoryUsage.rss();
            return RunSchema.parse({ shape, readyMs, firstReadMs, rssBeforeBytes, rssReadyBytes, rssAfterReadBytes,
              addedRssBytes: Math.max(rssReadyBytes, rssAfterReadBytes) - rssBeforeBytes, historyArchive: true, cursorOffset, timelineHighWater });
          } finally { await lanes.close(); }
        } finally { database.close(); }
      } finally { admission.release(); }
    } finally { machine.release(); }
  } finally { await lock.close(); }
}

export function summarizeShape(shape: Shape, runs: readonly Run[]) {
  const range = (select: (run: Run) => number) => [Math.min(...runs.map(select)), Math.max(...runs.map(select))];
  const limiters = [
    ...(runs.some(run => run.readyMs > READY_LIMIT_MS) ? ["ready-time"] : []),
    ...(runs.some(run => run.addedRssBytes > ADDED_RSS_LIMIT_BYTES) ? ["added-rss"] : []),
  ];
  return { shape, lanes: LANES[shape], runCount: runs.length, verdict: limiters.length === 0 ? "pass" : "fail", limiters,
    ranges: { readyMs: range(run => run.readyMs), addedRssMiB: range(run => run.addedRssBytes / 1024 / 1024), firstReadMs: range(run => run.firstReadMs) },
    limits: { readyMs: READY_LIMIT_MS, addedRssMiB: ADDED_RSS_LIMIT_BYTES / 1024 / 1024 } };
}

const G4_SAMPLES = 20;
const G4_TIMEOUT_MS = 30_000;
const G4_LIMITS = { p50Ms: 400, p95Ms: 800, sseMs: 500, stallMs: 20, p50Ratio: 1.5, p95Ratio: 2, sseRatio: 1.5 };
const G4ProbeSchema = z.strictObject({
  stallMs: z.number().nonnegative(),
  stallSamples: z.int().positive(),
  scans: z.array(z.strictObject({ start: z.number(), end: z.number(), cached: z.boolean() })),
  scanFailures: z.int().nonnegative(),
});
const G2EvidenceSchema = z.object({
  gate: z.literal("G2"),
  commit: z.string().regex(/^[a-f0-9]{40}$/u),
  shapes: z.array(z.object({
    shape: ShapeSchema, verdict: z.enum(["pass", "fail"]), runCount: z.int().positive(),
    ranges: z.object({ readyMs: z.tuple([z.number(), z.number()]), addedRssMiB: z.tuple([z.number(), z.number()]) }),
  })).length(2),
});
const g4Probe = Symbol.for("relay.read-lanes.g4");
type G4Probe = z.infer<typeof G4ProbeSchema>;
type Span = Readonly<{ start: number; end: number }>;
const elapsed = (span: Span) => span.end - span.start;
const overlaps = (left: Span, right: Span) => left.start <= right.end && right.start <= left.end;
const percentile = (values: readonly number[], fraction: number) => {
  if (values.length === 0) throw new Error("read-lanes-g4-no-samples");
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
};

function withLaneRoute(shape: Shape, g4 = false) {
  const target = new URL("../../src/backend/storage/sqlite/dashboard-read-host.ts", import.meta.url).href;
  return registerHooks({ load(url, context, next) {
    const loaded = next(url, context);
    if (url !== target) return loaded;
    if (typeof loaded.source !== "string") throw new Error("read-lanes-g4-loader-source-refused");
    const source = loaded.source;
    const route = /input\.lanes\s*\?\?\s*(?:ReadLaneNameSchema\.options|\[\s*"navigation"\s*\])/u;
    const priorityRoute = "lanes.get(definition.lane)";
    if (source.split(route).length !== 2 || source.split(priorityRoute).length !== 2) throw new Error("read-lanes-bench-route-seam-changed");
    const routed = source.replace(route, `input.lanes ?? ${JSON.stringify(LANES[shape])}`)
      .replace(priorityRoute, 'lanes.get(definition.priority === "background" || ["activity", "search-metadata-export", "search-xlsx-selection"].includes(definition.name) ? "search" : "navigation")');
    if (!g4) return { ...loaded, source: routed };
    const notify = "else lane.held.push(request);";
    const key = /key:\s*canonicalJsonStringify\(\{\s*lane:\s*lane\.name,\s*read:\s*registered\.id,\s*args:\s*parsed\s*\}\)/u;
    if (routed.split(notify).length !== 2 || routed.split(key).length !== 2) {
      throw new Error("read-lanes-g4-probe-seam-changed");
    }
    const probe = 'globalThis[Symbol.for("relay.read-lanes.g4")]';
    return { ...loaded, source: routed
      .replace(notify, `${notify}\nif (registered.name === "notification-source-scan") ${probe}?.observe(request.settle.promise);`)
      .replace(key, found => `${found} + (registered.name === "notification-source-scan" ? ${probe}?.scanKey() ?? "" : "")`) };
  } });
}

async function serveG4(shape: Shape) {
  if (process.send === undefined) throw new Error("read-lanes-g4-ipc-required");
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  let scans: G4Probe["scans"] = [], scanFailures = 0, measuring = false, scanNumber = 0;
  Object.defineProperty(globalThis, g4Probe, { configurable: true, value: {
    // The real poll drives a full scan during contention while baseline polls keep their normal cache key.
    scanKey: () => measuring ? `:g4:${String(++scanNumber)}` : "",
    observe(reply: Promise<{ cached: boolean }>) {
      if (!measuring) return;
      const start = systemClock.nowMs();
      void reply.then(({ cached }) => scans.push({ start, end: systemClock.nowMs(), cached }), () => { scanFailures++; });
    },
  } });
  const hook = withLaneRoute(shape, true);
  process.on("message", (message: unknown) => {
    if (message === "g4-start") {
      scans = []; scanFailures = 0; measuring = true;
      histogram.reset(); histogram.enable();
      process.send?.({ type: "g4-started" });
    } else if (message === "g4-finish") {
      measuring = false;
      histogram.disable();
      process.send?.({ type: "g4-finished", metrics: { stallMs: histogram.max / 1e6, stallSamples: histogram.count, scans, scanFailures } });
    }
  });
  process.channel?.unref();
  try {
    const { runSecureEnvironmentEntrypoint } = await import("../dev/secure-env-bootstrap.js");
    await runSecureEnvironmentEntrypoint(["cli", "dashboard", "--prod"]);
  } finally {
    histogram.disable();
    hook.deregister();
    Reflect.deleteProperty(globalThis, g4Probe);
    if (process.connected) process.disconnect?.();
  }
}

async function admitG4Copy(profile: CopyProfile, workspace: string) {
  const [{ acquireRuntimeLifetimeLock }, { acquireEntrypointAdmission }, { openReadOnlyDatabase }] = await Promise.all([
    import("../../src/backend/storage/admission/lifetime-lock.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/sqlite/readonly-authority-snapshot.js"),
  ]);
  const lock = await acquireRuntimeLifetimeLock(runtimeProfiles[profile].lockPort);
  try {
    const machine = acquireEntrypointAdmission(workspace, "shared", lock);
    try {
      const { activeProfileId, installationId, profiles } = machine.readProfileRegistry();
      const row = profiles.find(person => person.profileId === activeProfileId);
      if (row?.lifecycle !== "ready" || row.credentialState !== "saved" || row.duoState !== "ready"
        || row.registration.onboardingCompletion === undefined) throw new Error("read-lanes-g4-copy-sign-in-required");
      const person = machine.admitProfile(row.profileId);
      try {
        const archive = openReadOnlyDatabase(join(person.stateRoot, "files", "imported-history.sqlite"), 250);
        try {
          const binding = z.object({ installation_id: z.uuid(), profile_id: z.uuid() })
            .parse(archive.prepare("SELECT installation_id, profile_id FROM history_header").get());
          if (binding.installation_id !== installationId || binding.profile_id !== row.profileId
            || archive.prepare("SELECT 1 FROM runs LIMIT 1").get() === undefined) throw new Error("read-lanes-g4-copy-history-required");
        } finally { archive.close(); }
        const database = openReadOnlyDatabase(join(person.stateRoot, "state.db"), 250);
        try {
          if (database.prepare("SELECT 1 FROM runs WHERE state IS NOT 'terminal' LIMIT 1").get() !== undefined) {
            throw new Error("read-lanes-g4-copy-has-active-runs");
          }
        } finally { database.close(); }
        return row.profileId;
      } finally { person.release(); }
    } finally { machine.release(); }
  } finally { await lock.close(); }
}

async function withG4Cleanup<T>(run: () => Promise<T>, close: () => Promise<void>): Promise<T> {
  const [work] = await Promise.allSettled([run()]);
  const [cleanup] = await Promise.allSettled([close()]);
  if (cleanup.status === "rejected") {
    if (work.status === "rejected") {
      const workError: unknown = work.reason, cleanupError: unknown = cleanup.reason;
      throw new AggregateError([workError, cleanupError], "read-lanes-g4-work-and-cleanup-failed");
    }
    throw new Error("read-lanes-g4-cleanup-failed", { cause: cleanup.reason });
  }
  if (work.status === "rejected") throw new Error("read-lanes-g4-work-failed", { cause: work.reason });
  return work.value;
}

async function measureG4(shape: Shape, profile: CopyProfile, input: { days: readonly [string, string]; workflow: string; query: string; profileId: string }) {
  const [
    { chromium }, { createDashboardClient }, { operatorCredentials, resumeKey }, { CrossDateSearchPageSchema },
    { CalendarWireSchema }, { DashboardStreamEnvelopeSchema }, { CommandResultSchema, SettingsCommandRequestSchema }, { deriveSettingsPatchFingerprint, SettingsPatchSchema },
    { FrontendBootstrapWireSchema }, { SHUTDOWN_BACKUP_WAIT_MS },
  ] = await Promise.all([
    import("playwright"), import("../../src/dashboard/client/index.js"), import("../profiles/copy-signin.js"),
    import("../../src/models/dashboard/search.js"), import("../../src/models/dashboard/calendar.js"),
    import("../../src/models/dashboard/subscription.js"), import("../../src/rules/commands/commands.js"),
    import("../../src/models/config/settings.js"),
    import("../../src/models/dashboard/bootstrap.js"), import("../../src/backend/app/bootstrap/secure-env-bootstrap.js"),
  ]);
  const startLoad = loadavg();
  const child = fork(fileURLToPath(import.meta.url), [profile, "--g4-backend", shape], {
    execArgv: ["--import", "tsx"], env: workerBootstrapEnvironment(), stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const closed = new Promise<boolean>(resolve => {
    child.once("close", (code, signal) => resolve(code === 0 && signal === null));
    child.once("error", () => resolve(false));
  });
  const receive = async (type: string, send?: "g4-start" | "g4-finish", timeoutMs = G4_TIMEOUT_MS): Promise<unknown> => {
    const signal = AbortSignal.timeout(timeoutMs);
    const received = Promise.withResolvers<unknown>();
    const listener = (message: unknown) => {
      if (message !== null && typeof message === "object" && "type" in message && message.type === type) received.resolve(message);
    };
    const expire = () => { received.reject(new Error(`read-lanes-g4-timeout-${type}`)); };
    child.on("message", listener);
    signal.addEventListener("abort", expire, { once: true });
    try {
      if (send !== undefined) child.send(send);
      return await Promise.race([received.promise, closed.then(() => { throw new Error("read-lanes-g4-backend-closed"); })]);
    } finally { child.off("message", listener); signal.removeEventListener("abort", expire); }
  };
  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return await withG4Cleanup(async () => {
    await receive("hrauto-dashboard-ready", undefined, SHUTDOWN_BACKUP_WAIT_MS + G4_TIMEOUT_MS);
    const origin = `http://127.0.0.1:${String(runtimeProfiles[profile].backendPort)}`;
    const auth: { proof?: string; session?: string } = {};
    const client = createDashboardClient({ baseUrl: origin, async fetchImpl(url, init) {
      const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(G4_TIMEOUT_MS) });
      if (response.ok) {
        const proof = response.headers.get("x-relay-resume"), session = response.headers.get("x-relay-session");
        if (proof !== null) auth.proof = proof;
        if (session !== null) auth.session = session;
      }
      return response;
    } });
    const state = await client.readProfileSession();
    if (state.state !== "signed-out" || state.signUpRequired === true || state.logoutIncomplete === true) throw new Error("read-lanes-g4-copy-session-refused");
    const credentials = operatorCredentials();
    const active = await client.signInProfile({ email: credentials.RELAY_EMAIL, password: credentials.RELAY_PASSWORD });
    const { proof, session } = auth;
    if (active.state !== "active" || active.profileId !== input.profileId || active.duoState !== "ready" || proof === undefined || session === undefined) {
      throw new Error("read-lanes-g4-copy-session-unavailable");
    }
    const browser = await chromium.launch({ headless: true });
    return await withG4Cleanup(async () => {
      const context = await browser.newContext({ locale: "en-US", serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
      context.setDefaultTimeout(G4_TIMEOUT_MS);
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const queue = await context.newPage();
      await context.addInitScript(({ owner, key, value }) => {
        if (location.origin === owner && localStorage.getItem(key) === null) localStorage.setItem(key, value);
      }, { owner: origin, key: resumeKey, value: proof });
      const dayPath = `/?${new URLSearchParams({ day: input.days[0], view: JSON.stringify({ workflow: input.workflow }) })}`;
      const boot = queue.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/bootstrap");
      await queue.goto(origin + dayPath);
      const bootstrap = FrontendBootstrapWireSchema.parse(await (await boot).json());
      await queue.getByRole("complementary", { name: "Workspace" }).waitFor();
      if (context.pages().length !== 1) throw new Error("read-lanes-g4-window-count");
      const option = queue.getByRole("button", { name: /^Options/u });
      const calendar = queue.getByRole("menu", { name: "Pick a date" });
      const readyQueueRow = '.dashboard-queue-column:not([aria-busy="true"]) [data-queue-scroll] :is([data-queue-open], [data-queue-batch-id])';
      const sound = "preferences.notifications.sound";
      await queue.locator(readyQueueRow).first().waitFor();
      const settingsDocument = await client.editableSettings();
      const original = settingsDocument.sections.flatMap(section => section.leaves).find(leaf => leaf.path === sound);
      const soundValue = z.enum(["default", "none"]).parse(original?.effectiveValue);
      if (original === undefined) throw new Error("read-lanes-g4-settings-leaf-missing");

      async function clickDay(day: string) {
        if (!await calendar.isVisible()) {
          if (!await queue.getByRole("menu", { name: "Queue options" }).isVisible()) await option.click();
          const date = queue.getByRole("menuitem", { name: /^Date/u });
          await date.focus();
          await date.press("ArrowRight");
        }
        const label = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
        const cell = calendar.getByRole("button", { name: new RegExp(label, "u") });
        await cell.evaluate((node, timeout) => {
          Reflect.deleteProperty(window, "relayG4Click");
          const started = Promise.withResolvers<void>();
          Reflect.set(window, "relayG4WorkStart", started.promise);
          const deadline = setTimeout(() => { started.reject(new Error("read-lanes-g4-pointerup-timeout")); }, timeout);
          void started.promise.catch(() => undefined);
          node.addEventListener("pointerup", () => {
            clearTimeout(deadline);
            Reflect.set(window, "relayG4Click", performance.timeOrigin + performance.now());
            started.resolve();
          }, { once: true });
        }, G4_TIMEOUT_MS);
        return async () => {
          const stream = queue.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === "/events/v1" && url.searchParams.get("topics") === `dashboard-day:${day}`;
          });
          await cell.click();
          if (!(await stream).ok()) throw new Error("read-lanes-g4-queue-stream-http");
          await queue.waitForURL(url => url.searchParams.get("day") === day);
          await queue.locator(readyQueueRow).first().waitFor();
          const span = await queue.evaluate(async () => {
            const start: unknown = Reflect.get(window, "relayG4Click");
            if (typeof start !== "number") throw new Error("read-lanes-g4-click-missing");
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            return { start, end: performance.timeOrigin + performance.now() };
          });
          return span;
        };
      }

      const read = (path: string, stream = false, contended = false) => queue.evaluate(async ({ path, token, stream, contended, timeout }) => {
        if (contended) {
          const started: unknown = Reflect.get(window, "relayG4WorkStart");
          if (!(started instanceof Promise)) throw new Error("read-lanes-g4-work-start-missing");
          await started;
        }
        const start = performance.timeOrigin + performance.now();
        const response = await fetch(path, { headers: { "x-relay-session": token }, signal: AbortSignal.timeout(timeout) });
        if (!response.ok) throw new Error(`read-lanes-g4-http-${String(response.status)}`);
        if (!stream) {
          const payload: unknown = await response.json();
          return { start, end: performance.timeOrigin + performance.now(), payload };
        }
        const reader = response.body?.getReader();
        if (reader === undefined || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("read-lanes-g4-stream-invalid");
        const decoder = new TextDecoder();
        let pending = "", first: number | undefined;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) throw new Error("read-lanes-g4-stream-ended");
            pending += decoder.decode(value, { stream: true });
            for (let end = pending.indexOf("\n\n"); end !== -1; end = pending.indexOf("\n\n")) {
              const block = pending.slice(0, end), data = block.split("\n").find(line => line.startsWith("data: "));
              pending = pending.slice(end + 2);
              if (data === undefined) continue;
              const frameAt = performance.timeOrigin + performance.now();
              first ??= frameAt;
              const envelope: unknown = JSON.parse(data.slice(6));
              if (envelope !== null && typeof envelope === "object" && "type" in envelope && envelope.type === "snapshot") {
                return { start, end: frameAt, firstFrameMs: first - start, payload: envelope };
              }
              if (envelope === null || typeof envelope !== "object" || !("type" in envelope) || envelope.type !== "hello") {
                throw new Error("read-lanes-g4-stream-no-snapshot");
              }
            }
          }
        } finally { await reader.cancel(); }
      }, { path, token: session, stream, contended, timeout: G4_TIMEOUT_MS });
      const snapshot = async (day: string, contended = false) => {
        const result = await read(`/events/v1?topics=dashboard-day:${day}`, true, contended);
        const envelope = DashboardStreamEnvelopeSchema.parse(result.payload);
        if (envelope.type !== "snapshot" || envelope.payload.day !== day || envelope.payload.queueSurfaces.length === 0) {
          throw new Error("read-lanes-g4-empty-or-mismatched-snapshot");
        }
        return { start: result.start, end: result.end, firstFrameMs: z.number().nonnegative().parse(result.firstFrameMs) };
      };
      const workload = async (day: string) => {
        const [found, calendarRead] = await Promise.all([
          read(`/api/v1/search?${new URLSearchParams({ q: input.query })}`, false, true),
          read(`/api/v1/calendar?${new URLSearchParams({ month: day.slice(0, 7), day })}`, false, true),
        ]);
        if (CrossDateSearchPageSchema.parse(found.payload).results.length === 0
          || CalendarWireSchema.parse(calendarRead.payload).day !== day) throw new Error("read-lanes-g4-empty-or-mismatched-search");
        return { search: { start: found.start, end: found.end }, calendar: { start: calendarRead.start, end: calendarRead.end } };
      };
      let current = soundValue, revision = settingsDocument.revision;
      // Settings takes over the dashboard, so dispatch its ordinary command from the Queue page.
      async function changeSetting() {
        const next = current === "default" ? "none" : "default";
        const patch = SettingsPatchSchema.parse({ [sound]: { set: next } });
        const command = SettingsCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: systemClock.now().toISOString(),
          requestedBy: bootstrap.actor.id, source: "settings-surface", family: "settings", type: "apply-settings",
          target: { expectedRevision: revision }, payload: { settingsSchemaHash: settingsDocument.settingsSchemaHash,
            patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
        const { start, end, payload } = await queue.evaluate(async ({ command, token, timeout }) => {
          const started: unknown = Reflect.get(window, "relayG4WorkStart");
          if (!(started instanceof Promise)) throw new Error("read-lanes-g4-work-start-missing");
          await started;
          const start = performance.timeOrigin + performance.now();
          const response = await fetch("/api/v1/commands", { method: "POST", body: JSON.stringify(command),
            headers: { "content-type": "application/json", "x-relay-session": token }, signal: AbortSignal.timeout(timeout) });
          if (!response.ok) throw new Error(`read-lanes-g4-settings-http-${String(response.status)}`);
          const payload: unknown = await response.json();
          return { start, end: performance.timeOrigin + performance.now(), payload };
        }, { command, token: session, timeout: G4_TIMEOUT_MS });
        const result = CommandResultSchema.parse(payload);
        if (result.state !== "applied" || result.commandId !== command.commandId || result.settingsRevision !== revision + 1) {
          throw new Error("read-lanes-g4-settings-save-failed");
        }
        revision = result.settingsRevision;
        current = next;
        return { start, end };
      }

      type Snapshot = Awaited<ReturnType<typeof snapshot>>;
      const baseline: Span[] = [], uncontendedSse: Snapshot[] = [];
      const contention: { click: Span; search: Span; calendar: Span; settings: Span; sse: Snapshot }[] = [];
      return await withG4Cleanup(async () => {
        for (let index = 0; index < G4_SAMPLES; index++) {
          const day = input.days[index % 2 === 0 ? 1 : 0];
          baseline.push(await (await clickDay(day))());
          uncontendedSse.push(await snapshot(day));
        }
        await receive("g4-started", "g4-start");
        for (let index = 0; index < G4_SAMPLES; index++) {
          const day = input.days[index % 2 === 0 ? 1 : 0];
          const clickDayNow = await clickDay(day);
          const [click, companions, sse, changed] = await Promise.allSettled([clickDayNow(), workload(day), snapshot(day, true), changeSetting()]);
          if (click.status !== "fulfilled" || companions.status !== "fulfilled" || sse.status !== "fulfilled" || changed.status !== "fulfilled") {
            const failed = Object.entries({ click, companions, sse, changed }).flatMap(([name, result]) =>
              result.status === "rejected" ? [new Error(name, { cause: result.reason })] : []);
            throw new AggregateError(failed, "read-lanes-g4-contention-workload-failed");
          }
          contention.push({ click: click.value, ...companions.value, settings: changed.value, sse: sse.value });
        }
        const { metrics } = z.object({ metrics: G4ProbeSchema }).parse(await receive("g4-finished", "g4-finish"));
        return { baseline, uncontendedSse, contention, metrics, startLoad, endLoad: loadavg() };
      }, async () => {
        const latest = await client.editableSettings();
        const leaf = latest.sections.flatMap(section => section.leaves).find(item => item.path === sound);
        if (leaf === undefined) throw new Error("read-lanes-g4-settings-restore-unproved");
        if (leaf.source !== original.source || leaf.settingsValue !== original.settingsValue) {
          const patch = SettingsPatchSchema.parse({ [sound]: original.settingsValue === undefined ? { clear: true } : { set: original.settingsValue } });
          const restored = await client.applySettings({ commandId: randomUUID(), requestedAt: systemClock.now().toISOString(),
            requestedBy: bootstrap.actor.id, source: "settings-surface", family: "settings", type: "apply-settings",
            target: { expectedRevision: latest.revision }, payload: { settingsSchemaHash: latest.settingsSchemaHash, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
          if (restored.state !== "applied") throw new Error("read-lanes-g4-settings-restore-failed");
          const restoredLeaf = (await client.editableSettings()).sections.flatMap(section => section.leaves).find(item => item.path === sound);
          if (restoredLeaf?.source !== original.source || restoredLeaf.settingsValue !== original.settingsValue) throw new Error("read-lanes-g4-settings-restore-unproved");
        }
      });
    }, () => browser.close());
  }, async () => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    stop();
    if (!await closed) throw new Error("read-lanes-g4-backend-close-unproved");
  });
}

type G4Run = Awaited<ReturnType<typeof measureG4>>;
function summarizeG4(shape: Shape, runs: readonly G4Run[], startGate: z.infer<typeof G2EvidenceSchema>) {
  const startup = startGate.shapes.find(row => row.shape === shape);
  if (startup === undefined) throw new Error("read-lanes-g4-g2-shape-missing");
  const passesG2 = startup.verdict === "pass" && startup.ranges.readyMs[1] <= READY_LIMIT_MS
    && startup.ranges.addedRssMiB[1] <= ADDED_RSS_LIMIT_BYTES / 1024 / 1024;
  const summaries = runs.map(({ baseline, uncontendedSse, contention, metrics }) => {
    const clicks = contention.map(sample => elapsed(sample.click)), alone = baseline.map(elapsed);
    const sseAlone = Math.max(...uncontendedSse.map(sample => sample.firstFrameMs));
    const p50Ms = percentile(clicks, 0.50), p95Ms = percentile(clicks, 0.95), sseMs = Math.max(...contention.map(sample => sample.sse.firstFrameMs));
    const overlap = Object.fromEntries((["search", "calendar", "settings", "sse"] as const).map(kind =>
      [kind, contention.filter(sample => overlaps(sample.click, sample[kind])).length]));
    const scanOverlap = contention.filter(sample => metrics.scans.some(scan => !scan.cached && overlaps(sample.click, scan))).length;
    return { p50Ms, p95Ms, sseMs, stallMs: metrics.stallMs,
      p50Ratio: p50Ms / percentile(alone, 0.50), p95Ratio: p95Ms / percentile(alone, 0.95), sseRatio: sseMs / sseAlone,
      overlap, scanOverlap, scanFailures: metrics.scanFailures };
  });
  const inconclusive = summaries.some(run => Object.values(run.overlap).some(count => count === 0) || run.scanOverlap === 0 || run.scanFailures > 0);
  const limits = (Object.keys(G4_LIMITS) as (keyof typeof G4_LIMITS)[]).filter(key => summaries.some(run => run[key] > G4_LIMITS[key]));
  return { shape, g2: startup, passesG2, verdict: inconclusive ? "inconclusive" : limits.length === 0 ? "pass" : "fail", limits, summaries };
}

// After importing a fresh signed-in copy with profile-copy.ts and running npm run web:build:
// node --import tsx scripts/bench/read-lanes.ts development --g4 --days YYYY-MM-DD,YYYY-MM-DD --workflow <workflow-id> --query <matching-text> --g2 <G2-report.json>
async function runG4(profile: CopyProfile, workspace: string, args: { days: string | undefined; workflow: string | undefined; query: string | undefined; g2: string | undefined; runs: string | undefined; shape: string | undefined }) {
  const days = z.tuple([z.iso.date(), z.iso.date()]).parse(args.days?.split(","));
  if (days[0] === days[1] || days[0].slice(0, 7) !== days[1].slice(0, 7)) throw new Error("read-lanes-g4-requires-two-distinct-days-in-one-month");
  const workflow = WorkflowIdSchema.parse(args.workflow);
  const query = z.string().min(1).max(160).parse(args.query);
  const startGate = G2EvidenceSchema.parse(JSON.parse(readFileSync(z.string().min(1).parse(args.g2), "utf8")));
  if (new Set(startGate.shapes.map(row => row.shape)).size !== 2) throw new Error("read-lanes-g4-g2-shapes-invalid");
  const repetitions = z.coerce.number().int().min(5).max(10).parse(args.runs ?? "5");
  const selected = args.shape === undefined ? ["B", "A"] as const : [ShapeSchema.parse(args.shape)];
  const profileId = await admitG4Copy(profile, workspace);
  const results: Record<Shape, G4Run[]> = { A: [], B: [] };
  const path = join(process.cwd(), `read-lanes-g4-${String(systemClock.nowMs())}.json`);
  const report = { gate: "G4", limits: G4_LIMITS, g2Commit: startGate.commit, profile, node: process.version,
    scanCache: "miss forced for notification polling during each contention window",
    runtime: "dashboard --prod (built web bundle, tsx backend)", windows: 1, host: { cpus: availableParallelism(), loadavg: loadavg() },
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), runs: results };
  const writeReport = (outcome: object) => {
    writeFileSync(path, `${JSON.stringify({ ...report, ...outcome }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  };
  try {
    for (let index = 0; index < repetitions; index++) {
      for (const shape of selected) {
        process.stderr.write(`G4 ${shape} ${String(index + 1)}/${String(repetitions)}\n`);
        results[shape].push(await measureG4(shape, profile, { days, workflow, query, profileId }));
      }
    }
  } catch (cause) {
    writeReport({ decision: "inconclusive" });
    throw new Error(`read-lanes-g4-incomplete (wrote ${path})`, { cause });
  }
  const shapes = selected.map(shape => summarizeG4(shape, results[shape], startGate));
  const eligible = shapes.find(shape => shape.passesG2 && shape.verdict !== "fail");
  const decision = eligible === undefined ? "stop-for-design" : eligible.verdict === "pass" ? eligible.shape : "inconclusive";
  writeReport({ decision, shapes });
  process.stdout.write(`${JSON.stringify({ decision, shapes }, null, 2)}\nwrote ${path}\n`);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string" }, shape: { type: "string" },
    g4: { type: "boolean" }, "g4-backend": { type: "string" }, days: { type: "string" }, workflow: { type: "string" }, query: { type: "string" }, g2: { type: "string" } } });
  const [profile] = z.tuple([CopyProfileSchema]).parse(positionals);
  // Runtime isolation and key custody bind the profile at module initialization.
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const { applicationDataWorkspace } = await import("../../src/backend/app/config/runtime-isolation.js");
  const workspace = applicationDataWorkspace(undefined, profile), lockPort = runtimeProfiles[profile].lockPort;
  if (values["g4-backend"] !== undefined) {
    await serveG4(ShapeSchema.parse(values["g4-backend"]));
  } else if (values.g4 === true) {
    await runG4(profile, workspace, { days: values.days, workflow: values.workflow, query: values.query, g2: values.g2, runs: values.runs, shape: values.shape });
  } else if (values.shape !== undefined) {
    process.stdout.write(`${JSON.stringify(await measure(ShapeSchema.parse(values.shape), workspace, lockPort))}\n`);
  } else {
    const runs = z.coerce.number().int().min(1).max(10).parse(values.runs ?? "3");
    const script = fileURLToPath(import.meta.url);
    const results: Record<Shape, Run[]> = { A: [], B: [] };
    // Alternate shapes so host drift touches both; every run is a cold process.
    for (let index = 0; index < runs; index++) {
      for (const shape of ShapeSchema.options) {
        const output = execFileSync(process.execPath, ["--import", "tsx", script, profile, "--shape", shape], { encoding: "utf8" });
        results[shape].push(RunSchema.parse(JSON.parse(output.trim().split("\n").at(-1) ?? "")));
      }
    }
    const report = { gate: "G2", runtime: "tsx (dashboard:prod read-worker entry and backend loader)", node: process.version,
      profile, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), host: { cpus: availableParallelism(), loadavg: loadavg() },
      shapes: ShapeSchema.options.map(shape => summarizeShape(shape, results[shape])), runs: results };
    const path = join(process.cwd(), `read-lanes-g2-${new Date(systemClock.nowMs()).toISOString().replaceAll(":", "-")}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(report.shapes, null, 2)}\nwrote ${path}\n`);
  }
}
