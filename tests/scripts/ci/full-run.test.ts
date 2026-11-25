import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { START_STEP, decideFullRun, fullRunProof, greenFullRun } from "../../../scripts/ci/full-run.js";
import type { Context, GitHub } from "../../../scripts/ci/full-run.js";

const repo = { owner: "owner", repo: "relay" };
const sha = "a".repeat(40);
const now = Date.parse("2026-11-22T12:00:00Z");
const hours = (count: number) => new Date(now - count * 3_600_000).toISOString();

interface FakeRun { id: number; event: string; path: string; head_sha: string; created_at: string; started: boolean; full?: string; repo?: string }
interface Fake { runs?: FakeRun[]; busy?: Record<string, number[]>; foreignChecks?: { sha: string; id: number; conclusion: string; slug: string }[];
  commits?: Record<string, { tree: string; parents: string[] }> }

// A GitHub API stand-in: each run has a `decide` job, and a `full` job whose check run shares its id.
function fake({ runs = [], busy = {}, foreignChecks = [], commits = {} }: Fake) {
  const calls: string[] = [];
  const runFor = (id: number) => runs.find(run => run.id === id);
  const method = (name: string, respond: (params: Record<string, unknown>) => unknown[]) =>
    Object.assign(async () => Promise.reject(new Error(`${name} must be paginated`)), { respond, label: name });
  const github: GitHub = {
    paginate: async <T>(operation: (params: Record<string, unknown>) => Promise<unknown>, params: Record<string, unknown>) => {
      const { respond, label } = operation as unknown as { respond: (params: Record<string, unknown>) => unknown[]; label: string };
      calls.push(label);
      return Promise.resolve(respond(params) as T[]);
    },
    rest: {
      actions: {
        getJobForWorkflowRun: async ({ job_id }) => {
          calls.push("getJob");
          const run = runFor(Number(job_id) - 1000);
          if (!run) throw new Error("API 404");
          return Promise.resolve({ data: { id: Number(job_id), run_id: run.id, name: "full", conclusion: run.full ?? null, head_sha: run.head_sha } });
        },
        getWorkflowRun: async ({ run_id }) => {
          calls.push("getRun");
          const run = runFor(Number(run_id));
          if (!run) throw new Error("API 404");
          return Promise.resolve({ data: { ...run, html_url: `https://example.test/runs/${run.id}`,
            head_repository: { full_name: run.repo ?? "owner/relay" } } });
        },
        listJobsForWorkflowRun: method("jobs", ({ run_id }) => {
          const run = runFor(Number(run_id));
          return [{ id: 1, run_id, name: "decide", conclusion: "success", head_sha: run?.head_sha,
            steps: [{ name: START_STEP, conclusion: run?.started ? "success" : "skipped" }] }];
        }),
        listWorkflowRuns: method("runs", ({ workflow_id, event, created }) => {
          expect(workflow_id).toBe("full.yml");
          expect(["schedule", "workflow_dispatch"]).toContain(event);
          const since = Date.parse(String(created).slice(2));
          return runs.filter(run => run.path.split("@")[0] === ".github/workflows/full.yml"
            && run.event === event && Date.parse(run.created_at) >= since).map(run => ({ ...run, html_url: `https://example.test/runs/${run.id}` }));
        }),
        listWorkflowRunsForRepo: method("busy", ({ status }) => (busy[String(status)] ?? []).map(id => ({ id }))),
      },
      checks: {
        listForRef: method("checks", ({ ref, check_name, filter }) => {
          expect({ check_name, filter }).toEqual({ check_name: "full", filter: "all" });
          return [...runs.filter(run => run.head_sha === ref && run.full !== undefined)
            .map(run => ({ id: run.id + 1000, conclusion: run.full, app: { slug: "github-actions" } })),
          ...foreignChecks.filter(check => check.sha === ref).map(check => ({ id: check.id, conclusion: check.conclusion, app: { slug: check.slug } }))];
        }),
      },
      repos: {
        getCommit: async ({ ref }) => {
          calls.push("getCommit");
          const commit = commits[String(ref)];
          if (!commit) throw new Error("API 404");
          return Promise.resolve({ data: { sha: String(ref), commit: { tree: { sha: commit.tree } }, parents: commit.parents.map(parent => ({ sha: parent })) } });
        },
      },
    },
  };
  return { github, calls };
}

const scheduled = (id: number, extra: Partial<FakeRun> = {}): FakeRun => ({ id, event: "schedule", path: ".github/workflows/full.yml",
  head_sha: sha, created_at: hours(1), started: true, full: "success", ...extra });
const context = (pull_request?: Context["payload"]["pull_request"]): Context => ({ repo, runId: 99, sha, payload: { pull_request } });
const decide = (fixture: Fake) => decideFullRun({ github: fake(fixture).github, context: context(), now });

describe("scheduled full-run decision", () => {
  it("runs nothing when the development head already has a green full run", async () => {
    const { github, calls } = fake({ runs: [scheduled(1, { created_at: hours(30) })], busy: { in_progress: [5] } });
    expect(await decideFullRun({ github, context: context(), now })).toEqual({ start: false,
      reason: `Development ${sha} already passed its full run https://example.test/runs/1.` });
    expect(calls).toEqual(["checks", "getJob", "getRun"]);
  });

  it("starts a changed head when no full run started in six hours, even while CI is busy", async () => {
    const old = scheduled(1, { head_sha: "b".repeat(40), created_at: hours(7) });
    const skipOnly = scheduled(2, { head_sha: "b".repeat(40), started: false, full: "skipped" });
    expect(await decide({ runs: [old, skipOnly], busy: { in_progress: [5], queued: [6] } }))
      .toMatchObject({ start: true, reason: expect.stringContaining("no full run started in the last 6 hours") as string });
  });

  it("starts a changed head after a recent full run only when CI is idle", async () => {
    const recent = scheduled(1, { head_sha: "b".repeat(40), created_at: hours(2) });
    expect(await decide({ runs: [recent], busy: { in_progress: [99] } }))
      .toMatchObject({ start: true, reason: expect.stringContaining("CI is idle") as string });
    for (const busy of [{ queued: [5] }, { in_progress: [5] }] as Record<string, number[]>[]) {
      expect(await decide({ runs: [recent], busy })).toMatchObject({ start: false });
    }
  });

  it("retries a failed same head on the next idle tick and waits six hours while CI is busy", async () => {
    for (const full of ["failure", "cancelled"]) {
      const failed = scheduled(1, { full, created_at: hours(1) });
      expect(await decide({ runs: [failed] })).toMatchObject({ start: true, reason: expect.stringContaining("CI is idle") as string });
      expect(await decide({ runs: [failed], busy: { in_progress: [5] } }))
        .toMatchObject({ start: false, reason: expect.stringContaining("started in the last 6 hours") as string });
      expect(await decide({ runs: [{ ...failed, created_at: hours(7) }], busy: { in_progress: [5] } })).toMatchObject({ start: true });
    }
  });

  it("never overlaps a running full run, which keeps CI busy", async () => {
    const running = scheduled(1, { full: undefined, created_at: hours(1) });
    expect(await decide({ runs: [running], busy: { in_progress: [1] } })).toMatchObject({ start: false });
  });

  it("counts a dispatched full run as proof and as a recent start", async () => {
    const dispatched = scheduled(1, { event: "workflow_dispatch" });
    expect(await greenFullRun(fake({ runs: [dispatched] }).github, repo, sha)).toMatchObject({ id: 1 });
    const recent = scheduled(2, { event: "workflow_dispatch", head_sha: "b".repeat(40), created_at: hours(2) });
    const { github } = fake({ runs: [recent], busy: { in_progress: [5] } });
    expect((await decideFullRun({ github, context: context(), now })).start).toBe(false);
  });

  it("ignores success claims outside the standalone full workflow at this commit", async () => {
    const forged = [
      scheduled(1, { event: "push", started: false }),
      scheduled(2, { path: ".github/workflows/staging.yml", started: false }),
      scheduled(3, { repo: "fork/relay", started: false }),
      scheduled(4, { path: ".github/workflows/development.yml" }),
    ];
    const foreignChecks = [{ sha, id: 7, conclusion: "success", slug: "other-app" }];
    expect(await decide({ runs: forged, foreignChecks, busy: { in_progress: [5] } })).toMatchObject({ start: true });
    expect(await greenFullRun(fake({ runs: [scheduled(5, { path: ".github/workflows/full.yml@refs/heads/development" })] }).github, repo, sha))
      .toMatchObject({ id: 5 });
  });

  it("lets API failures fail the decision instead of starting or skipping silently", async () => {
    const { github } = fake({});
    github.rest.checks.listForRef = Object.assign(async () => Promise.reject(new Error("unused")),
      { respond: () => { throw new Error("API down"); }, label: "checks" });
    await expect(decideFullRun({ github, context: context(), now })).rejects.toThrow("API down");
  });
});

describe("staging and release full-run proof", () => {
  const head = (ref: string, headSha = sha, full_name = "owner/relay") => ({ ref, sha: headSha, repo: { full_name } });
  const prove = (fixture: Fake, base: string, prHead: ReturnType<typeof head>) =>
    fullRunProof({ github: fake(fixture).github, context: context({ base: { ref: base }, head: prHead }) });

  it("passes a cut only on a green full run of its exact head", async () => {
    await expect(prove({ runs: [scheduled(1)] }, "staging", head("development"))).resolves.toBe(`Full run https://example.test/runs/1 proves ${sha}.`);
    for (const full of ["failure", "cancelled", "skipped"]) {
      await expect(prove({ runs: [scheduled(1, { full })] }, "staging", head("development"))).rejects.toThrow("No green full run proves");
    }
    await expect(prove({ runs: [scheduled(1, { head_sha: "b".repeat(40) })] }, "staging", head("development"))).rejects.toThrow("No green full run proves");
  });

  it("passes the main-to-staging sync without a full run and refuses other heads", async () => {
    await expect(prove({}, "staging", head("main"))).resolves.toContain("Main-to-staging sync");
    await expect(prove({ runs: [scheduled(1)] }, "staging", head("cut/x"))).rejects.toThrow("No full-run proof rule");
    await expect(prove({ runs: [scheduled(1)] }, "staging", head("development", sha, "fork/relay"))).rejects.toThrow("is not owner/relay");
    await expect(fullRunProof({ github: fake({}).github, context: context() })).rejects.toThrow("needs a pull request");
  });

  it("passes a staging release only through a parent cut with a green full run and the same tree", async () => {
    const cut = "c".repeat(40);
    const previous = "d".repeat(40);
    const merge = "e".repeat(40);
    const commits = { [merge]: { tree: "t1", parents: [previous, cut] }, [cut]: { tree: "t1", parents: [] }, [previous]: { tree: "t0", parents: [] } };
    const runs = [scheduled(1, { head_sha: cut })];
    await expect(prove({ runs, commits }, "main", head("staging", merge))).resolves
      .toBe(`Cut ${cut} passed full run https://example.test/runs/1, and staging ${merge} carries its exact tree.`);
    await expect(prove({ runs, commits: { ...commits, [cut]: { tree: "t2", parents: [] } } }, "main", head("staging", merge)))
      .rejects.toThrow("No green full run proves staging");
    await expect(prove({ runs: [scheduled(1, { head_sha: cut, full: "failure" })], commits }, "main", head("staging", merge)))
      .rejects.toThrow("No green full run proves staging");
    await expect(prove({ runs: [scheduled(1, { head_sha: merge })], commits }, "main", head("staging", merge))).resolves.toContain(`Cut ${merge}`);
  });
});

it("loads under plain Node without imports, as actions/github-script does", () => {
  const file = fileURLToPath(new URL("../../../scripts/ci/full-run.ts", import.meta.url));
  expect(readFileSync(file, "utf8")).not.toMatch(/^import /mu);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const m = await import(${JSON.stringify(file)}); console.log(Object.keys(m).sort().join(","));`], { encoding: "utf8" });
  expect(result.stderr).not.toMatch(/Error/u);
  expect(result.stdout.trim()).toBe("START_STEP,decideFullRun,fullRunProof,greenFullRun");
});
