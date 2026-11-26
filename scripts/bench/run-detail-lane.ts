import { execFileSync } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { searchPartitionDay } from "../../src/models/dashboard/search-calendar.js";
import { DashboardStreamEnvelopeSchema } from "../../src/models/dashboard/subscription.js";
import { systemClock } from "../../src/rules/time/clock.js";

async function takeRunPanel(origin: string, runId: string, day: string) {
  const topics = encodeURIComponent(`dashboard-day:${day},run:${runId}`);
  const response = await fetch(`${origin}/events/v1?topics=${topics}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok || response.body === null) throw new Error(`run-detail-bench-stream-status: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("run-detail-bench-stream-closed");
      pending += decoder.decode(chunk.value, { stream: true });
      let boundary = pending.indexOf("\n\n");
      while (boundary >= 0) {
        const data = pending.slice(0, boundary).split("\n").find(line => line.startsWith("data: "));
        pending = pending.slice(boundary + 2);
        boundary = pending.indexOf("\n\n");
        if (data === undefined) continue;
        const event = DashboardStreamEnvelopeSchema.parse(JSON.parse(data.slice(6)));
        if (!("rows" in event)) continue;
        for (const row of event.rows) {
          if (row.model !== "run-panel" || row.key !== runId) continue;
          if (row.value.state === "refused") throw new Error(`run-detail-bench-panel-refused: ${row.value.error.code}`);
          return { ...row, value: row.value };
        }
      }
    }
  } finally {
    await reader.cancel();
  }
}

export async function measureRunDetailReads(origin: string, runId: string, day: string) {
  const prefix = `${origin}/api/v1/runs/${runId}`;
  const routes = [];
  for (const suffix of ["", "/logs", "/attempt-history"] as const) {
    const started = systemClock.monotonicMs();
    const response = await fetch(prefix + suffix, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`run-detail-bench-route-status: ${suffix || "/"} ${response.status}`);
    const bytes = (await response.arrayBuffer()).byteLength;
    routes.push({ route: suffix || "/", ms: systemClock.monotonicMs() - started, bytes });
  }
  const started = systemClock.monotonicMs();
  const panel = await takeRunPanel(origin, runId, day);
  return { routes, panelMs: systemClock.monotonicMs() - started, panel };
}

async function benchmark(profile: "staging" | "development", repetitions: number) {
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const [{ applicationDataWorkspace, rebuildRuntimeIsolation }, { composeDashboardRuntime }, { composeProfileRuntime },
    { acquireEntrypointAdmission }, { acquireRuntimeLifetimeLock }] = await Promise.all([
    import("../../src/backend/app/config/runtime-isolation.js"),
    import("../../src/backend/app/composition/dashboard/compose.js"),
    import("../../src/backend/app/composition/storage-compose.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/admission/lifetime-lock.js"),
  ]);
  const lock = await acquireRuntimeLifetimeLock(runtimeProfiles[profile].lockPort);
  try {
    const admission = acquireEntrypointAdmission(applicationDataWorkspace(undefined, profile), "exclusive", lock);
    try {
      const owner = composeProfileRuntime({ admission, clock: systemClock, hostFacts: { primaryDisplay: null } });
      try {
        const selected = owner.session.resumeSignedInProfile({ at: systemClock.now().toISOString() });
        if (selected.state !== "active") throw new Error("run-detail-bench-copy-sign-in-required");
        const { database } = owner.selectedContext(selected.token);
        const history = database.dashboardHistory();
        if (history === database) throw new Error("run-detail-bench-copy-history-required");
        const run = history.authority.runs.listPage({ offset: 0, limit: 100 }).find(candidate =>
          candidate.lifecycle.state === "terminal" && history.authority.timelineEvents.page({
            after: 0, limit: 1, runId: candidate.envelope.runId,
          }).length > 0);
        if (run === undefined) throw new Error("run-detail-bench-copy-run-required");
        const runtime = await composeDashboardRuntime({ admission, lifetimeLock: lock, repoRoot: process.cwd(),
          profile: { runtime: owner, token: selected.token }, isolation: rebuildRuntimeIsolation,
          backendPortOverride: 0, frontendPortOverride: 0 });
        try {
          const origin = `http://127.0.0.1:${runtime.port}`;
          const day = searchPartitionDay(new Date(run.envelope.enqueuedAt));
          const results = [];
          for (let index = 0; index < repetitions; index++) {
            const { routes, panelMs } = await measureRunDetailReads(origin, run.envelope.runId, day);
            results.push({ routes, panelMs });
          }
          return { profile, node: process.version, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            host: { cpus: availableParallelism(), loadavg: loadavg() }, results };
        } finally { await runtime.stop(); }
      } finally { await owner.close(); }
    } finally { admission.release(); }
  } finally { await lock.close(); }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true,
    options: { runs: { type: "string", default: "5" } } });
  const [profile] = z.tuple([z.enum(["staging", "development"])]).parse(positionals);
  const repetitions = z.coerce.number().int().min(1).max(20).parse(values.runs);
  process.stdout.write(`${JSON.stringify(await benchmark(profile, repetitions), null, 2)}\n`);
}
