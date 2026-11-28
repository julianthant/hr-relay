import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { assertHeadlessCopySettings } from "./idle-three-tab.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { RunLogSearchResponseSchema } from "../../src/models/dashboard/run-detail.js";
import type { HeadlessCopySession } from "../profiles/headless-copy-signin.js";

const FullSha = z.string().regex(/^[0-9a-f]{40}$/u);
const Fixture = z.strictObject({ runId: z.uuid(), day: z.iso.date(), workflow: z.string().min(1), query: z.string().trim().min(3).max(256) });

function percentiles(values: readonly number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const at = (p: number) => ordered[Math.ceil(p * ordered.length) - 1];
  return { p50: at(0.5), p95: at(0.95), range: [ordered[0], ordered.at(-1)] };
}

async function measure({ context, page, origin }: HeadlessCopySession, fixture: z.output<typeof Fixture>, expectIndex: boolean) {
  const { runId, day, workflow, query } = fixture;
  if (context.pages().length !== 1) throw new Error("log-window-bench-window-count");
  page.setDefaultTimeout(10_000);
  const queryString = new URLSearchParams({ day, view: JSON.stringify({ workflow }) });
  await page.goto(`${origin}/?${queryString.toString()}`);
  const row = page.locator(`[data-demo-row-id="${runId}"] [data-queue-open]`);
  await row.waitFor();
  const visible = page.getByRole("region", { name: "Run logs", exact: true });
  const paint = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const openedAt = performance.now();
  await row.press("Enter");
  await visible.waitFor();
  await page.getByRole("button", { name: "Search logs" }).waitFor();
  await paint();
  const openMs = performance.now() - openedAt;

  await page.getByRole("button", { name: "Search logs" }).click();
  const response = expectIndex ? page.waitForResponse(value => new URL(value.url()).pathname === `/api/v1/runs/${runId}/log-search`) : undefined;
  const searchAt = performance.now();
  await page.getByRole("searchbox", { name: "Search logs" }).fill(query);
  if (response !== undefined) {
    const reply = await response;
    if (!reply.ok()) throw new Error(`log-window-bench-search-http-${String(reply.status())}`);
    const hits = RunLogSearchResponseSchema.parse(await reply.json());
    if (hits.runId !== runId || hits.matchedNoteIds.length === 0) throw new Error("log-window-bench-search-hit-missing");
  }
  const count = page.getByRole("search").getByText(/^1 of [1-9]\d*$/u);
  await count.waitFor();
  await paint();
  return { openMs, searchMs: performance.now() - searchAt, matches: Number((await count.innerText()).split(" ").at(-1)) };
}

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  fixture: { type: "string" }, output: { type: "string" }, runs: { type: "string", default: "20" },
} });
const [base, target] = z.tuple([FullSha, FullSha]).parse(positionals);
const fixture = Fixture.parse(JSON.parse(readFileSync(z.string().parse(values.fixture), "utf8")));
const output = z.string().parse(values.output);
const repetitions = z.coerce.number().int().min(5).max(20).parse(values.runs);
process.env[RUNTIME_PROFILE_ENV] = "development";
const [{ checkoutGit, developmentCopyCheckout, withHeadlessCopySignin }, { acquireRuntimeLifetimeLock },
  { openReadOnlyDatabase }, { readAppSettings }] = await Promise.all([
  import("../profiles/headless-copy-signin.js"), import("../../src/backend/storage/admission/lifetime-lock.js"),
  import("../../src/backend/storage/sqlite/readonly-authority-snapshot.js"), import("../../src/backend/storage/sqlite/settings-storage.js"),
]);
const checkout = developmentCopyCheckout();
const original = checkoutGit(checkout, ["rev-parse", "HEAD"]);
const stop = new AbortController();
const interrupt = () => stop.abort(new Error("log-window-bench-interrupted"));
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let historyDigest: string | undefined;

async function switchTo(sha: string) {
  const lock = await acquireRuntimeLifetimeLock(runtimeProfiles.development.lockPort);
  try {
    developmentCopyCheckout();
    if (checkoutGit(checkout, ["rev-parse", `${sha}:package-lock.json`]) !== checkoutGit(checkout, ["rev-parse", `${original}:package-lock.json`])) {
      throw new Error("log-window-bench-lockfile-mismatch");
    }
    checkoutGit(checkout, ["checkout", "--detach", sha]);
  } finally { await lock.close(); }
}

async function sample(sha: string, expectIndex: boolean) {
  stop.signal.throwIfAborted();
  await switchTo(sha);
  const trials: ({ state: "measured"; openMs: number; searchMs: number; matches: number; load: number }
    | { state: "error"; error: string; load: number })[] = [];
  try {
    await withHeadlessCopySignin(async session => {
      const hash = createHash("sha256");
      for await (const bytes of createReadStream(join(session.stateRoot, "files", "imported-history.sqlite"))) {
        if (!Buffer.isBuffer(bytes)) throw new Error("log-window-bench-history-read-invalid");
        hash.update(bytes);
      }
      const observed = hash.digest("hex");
      historyDigest ??= observed;
      if (observed !== historyDigest) throw new Error("log-window-bench-history-changed");
      for (let index = 0; index < repetitions; index++) {
        session.signal.throwIfAborted();
        trials.push({ state: "measured", ...await measure(session, fixture, expectIndex), load: loadavg()[0] });
      }
    }, { expectedSha: sha, signal: stop.signal, beforeStart({ stateRoot }) {
      const state = openReadOnlyDatabase(join(stateRoot, "state.db"), 250);
      try {
        const settings = readAppSettings(state);
        assertHeadlessCopySettings(settings?.saved?.settings ?? settings?.initialization.settings.settings);
        if (state.prepare("SELECT 1 FROM runs WHERE state <> 'terminal' LIMIT 1").get() !== undefined) {
          throw new Error("log-window-bench-active-runs");
        }
      } finally { state.close(); }
    } });
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9-]+$/u.test(error.message) ? error.message : "log-window-bench-browser-or-sample-error";
    trials.push({ state: "error", error: code, load: loadavg()[0] });
  }
  return trials;
}

try {
  const before = await sample(base, false);
  const after = await sample(target, true);
  const summarize = (sha: string, trials: Awaited<ReturnType<typeof sample>>) => {
    const hits = trials.filter(trial => trial.state === "measured");
    return { sha, trials, failures: trials.length - hits.length, unrun: Math.max(0, repetitions - trials.length), ...(hits.length === 0 ? {} : {
      openMs: percentiles(hits.map(hit => hit.openMs)), searchMs: percentiles(hits.map(hit => hit.searchMs)),
    }) };
  };
  const baseline = summarize(base, before), candidate = summarize(target, after);
  const matchCounts = [...new Set([...before, ...after].flatMap(trial => trial.state === "measured" ? [trial.matches] : []))];
  writeFileSync(output, `${JSON.stringify({ baseline, candidate, matchCounts, windows: 1, node: process.version, cores: availableParallelism() }, null, 2)}\n`,
    { mode: 0o600, flag: "wx" });
  if (baseline.failures || candidate.failures || baseline.unrun || candidate.unrun || matchCounts.length !== 1) process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await switchTo(original);
}
