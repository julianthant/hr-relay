import { execFileSync } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { systemClock, type Clock } from "../../src/rules/time/clock.js";

const percentile = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN;
};

/** Gate G6: the main-thread share of the Settings editor read, with its store part read on the navigation lane. */
async function benchmark(profile: "staging" | "development", repetitions: number) {
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const [{ applicationDataWorkspace }, { composeProfileRuntime }, { acquireEntrypointAdmission }, { acquireRuntimeLifetimeLock },
    { createComposedDashboardReadHost }, { composeSettings }, { activeSettingsRuntimeIdentity }] = await Promise.all([
    import("../../src/backend/app/config/runtime-isolation.js"),
    import("../../src/backend/app/composition/storage-compose.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/admission/lifetime-lock.js"),
    import("../../src/backend/app/composition/dashboard/runtime-resources.js"),
    import("../../src/backend/app/composition/dashboard/settings.js"),
    import("../../src/backend/runtime/settings/settings-runtime.js"),
  ]);
  const lock = await acquireRuntimeLifetimeLock(runtimeProfiles[profile].lockPort);
  try {
    const admission = acquireEntrypointAdmission(applicationDataWorkspace(undefined, profile), "exclusive", lock);
    try {
      const hostFacts = { primaryDisplay: null };
      const owner = composeProfileRuntime({ admission, clock: systemClock, hostFacts });
      try {
        const selected = owner.session.resumeSignedInProfile({ at: systemClock.now().toISOString() });
        if (selected.state !== "active") throw new Error("settings-editor-bench-copy-sign-in-required");
        const context = owner.selectedContext(selected.token);
        const lanes = createComposedDashboardReadHost({ admission: context.admission, database: context.database, clock: systemClock });
        try {
          // Each read alternates the fiscal year, so the main-thread document is built every time rather than reused.
          let read = 0;
          const fiscalYear = systemClock.fiscalYear();
          const clock: Clock = { ...systemClock, fiscalYear: (at?: Date) => at === undefined ? fiscalYear + (read % 2) : systemClock.fiscalYear(at) };
          const { editable } = composeSettings({ database: context.database, readLanes: lanes, hostFacts, clock, active: activeSettingsRuntimeIdentity,
            environment: process.env, credentials: context.credentials, resolveSettings: context.resolveSettings });
          await editable();
          const samples = [];
          for (; read < repetitions; read++) {
            const cpu = process.threadCpuUsage(), started = systemClock.monotonicMs();
            await editable();
            const used = process.threadCpuUsage(cpu);
            samples.push({ mainCpuMs: (used.user + used.system) / 1000, wallMs: systemClock.monotonicMs() - started });
          }
          const main = samples.map(sample => sample.mainCpuMs);
          return { profile, node: process.version, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            host: { cpus: availableParallelism(), loadavg: loadavg() },
            mainCpuMs: { p50: percentile(main, 0.5), p95: percentile(main, 0.95), max: Math.max(...main) },
            gate: { limitMs: 5, pass: Math.max(...main) <= 5 }, samples };
        } finally { await lanes.close(); }
      } finally { await owner.close(); }
    } finally { admission.release(); }
  } finally { await lock.close(); }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "20" } } });
  const [profile] = z.tuple([z.enum(["staging", "development"])]).parse(positionals);
  const repetitions = z.coerce.number().int().min(1).max(200).parse(values.runs);
  process.stdout.write(`${JSON.stringify(await benchmark(profile, repetitions), null, 2)}\n`);
}
