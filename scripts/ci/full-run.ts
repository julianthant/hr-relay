// actions/github-script imports this file on its own Node runtime without npm ci, so it has no imports.

const WORKFLOW = ".github/workflows/development.yml";
const SIX_HOURS = 6 * 60 * 60_000;
const FULL_EVENTS = ["schedule", "workflow_dispatch"];
export const START_STEP = "Start the full run";

interface Run { id: number; event: string; path: string; head_sha: string; html_url: string; head_repository?: { full_name: string } | null }
interface Job { id: number; run_id: number; name: string; conclusion: string | null; head_sha: string;
  steps?: { name: string; conclusion: string | null }[] }
interface CheckRun { id: number; conclusion: string | null; app?: { slug: string } | null }
interface Commit { sha: string; commit: { tree: { sha: string } }; parents: { sha: string }[] }
interface PullRequest { base: { ref: string }; head: { ref: string; sha: string; repo?: { full_name: string } | null } }
type Params = Record<string, unknown>;
type Repo = { owner: string; repo: string };

export interface GitHub {
  paginate: <T>(method: (params: Params) => Promise<unknown>, params: Params) => Promise<T[]>;
  rest: {
    actions: {
      getJobForWorkflowRun: (params: Params) => Promise<{ data: Job }>;
      getWorkflowRun: (params: Params) => Promise<{ data: Run }>;
      listJobsForWorkflowRun: (params: Params) => Promise<unknown>;
      listWorkflowRuns: (params: Params) => Promise<unknown>;
      listWorkflowRunsForRepo: (params: Params) => Promise<unknown>;
    };
    checks: { listForRef: (params: Params) => Promise<unknown> };
    repos: { getCommit: (params: Params) => Promise<{ data: Commit }> };
  };
}
export interface Context { repo: Repo; runId: number; sha: string; payload: { pull_request?: PullRequest } }

// A green full run is the `full` job of a scheduled or dispatched development.yml run at exactly this commit.
export async function greenFullRun(github: GitHub, repo: Repo, sha: string): Promise<Run | undefined> {
  const checks = await github.paginate<CheckRun>(github.rest.checks.listForRef,
    { ...repo, ref: sha, check_name: "full", filter: "all", per_page: 100 });
  for (const check of checks) {
    if (check.conclusion !== "success" || check.app?.slug !== "github-actions") continue;
    const { data: job } = await github.rest.actions.getJobForWorkflowRun({ ...repo, job_id: check.id });
    if (job.name !== "full" || job.conclusion !== "success" || job.head_sha !== sha) continue;
    const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: job.run_id });
    if (FULL_EVENTS.includes(run.event) && run.path.split("@")[0] === WORKFLOW && run.head_sha === sha
      && run.head_repository?.full_name === `${repo.owner}/${repo.repo}`) return run;
  }
  return undefined;
}

export async function decideFullRun({ github, context, now }: { github: GitHub; context: Context; now: number }):
  Promise<{ start: boolean; reason: string }> {
  const { repo, sha } = context;
  const green = await greenFullRun(github, repo, sha);
  if (green) return { start: false, reason: `Development ${sha} already passed its full run ${green.html_url}.` };
  // A running full run keeps CI busy, so an idle tick never overlaps one.
  const busy: Run[] = [];
  for (const status of ["queued", "in_progress"]) {
    busy.push(...(await github.paginate<Run>(github.rest.actions.listWorkflowRunsForRepo, { ...repo, status, per_page: 100 }))
      .filter(run => run.id !== context.runId));
  }
  if (busy.length === 0) return { start: true, reason: `Development ${sha} has no green full run and CI is idle.` };
  const recent: Run[] = [];
  for (const event of FULL_EVENTS) {
    recent.push(...(await github.paginate<Run>(github.rest.actions.listWorkflowRuns, { ...repo, workflow_id: "development.yml",
      event, created: `>=${new Date(now - SIX_HOURS).toISOString()}`, per_page: 100 })).filter(run => run.id !== context.runId));
  }
  for (const run of recent) {
    const jobs = await github.paginate<Job>(github.rest.actions.listJobsForWorkflowRun,
      { ...repo, run_id: run.id, filter: "latest", per_page: 100 });
    if (jobs.some(job => job.name === "decide" && job.steps?.some(step => step.name === START_STEP && step.conclusion === "success"))) {
      return { start: false, reason: `CI has ${busy.length} queued or running runs and full run ${run.html_url} started in the last 6 hours.` };
    }
  }
  return { start: true, reason: `Development ${sha} has no green full run and no full run started in the last 6 hours.` };
}

// Staging and release pull requests pass only on a green full run of the exact content they carry.
export async function fullRunProof({ github, context }: { github: GitHub; context: Context }): Promise<string> {
  const pr = context.payload.pull_request;
  if (!pr) throw new Error("The full-run proof needs a pull request.");
  const { repo } = context;
  if (pr.head.repo?.full_name !== `${repo.owner}/${repo.repo}`) throw new Error(`Pull request head ${pr.head.repo?.full_name} is not ${repo.owner}/${repo.repo}.`);
  const { ref, sha } = pr.head;
  if (pr.base.ref === "staging" && ref === "main") return `Main-to-staging sync ${sha} needs no full run: main moves only through the production gate.`;
  if (pr.base.ref === "staging" && ref === "development") {
    const run = await greenFullRun(github, repo, sha);
    if (!run) throw new Error(`No green full run proves ${sha}; merge only a development commit whose full run passed.`);
    return `Full run ${run.html_url} proves ${sha}.`;
  }
  if (pr.base.ref === "main" && ref === "staging") {
    const { data: head } = await github.rest.repos.getCommit({ ...repo, ref: sha });
    for (const candidate of [head.sha, ...head.parents.map(parent => parent.sha)]) {
      const run = await greenFullRun(github, repo, candidate);
      if (!run) continue;
      const tree = candidate === head.sha ? head.commit.tree.sha : (await github.rest.repos.getCommit({ ...repo, ref: candidate })).data.commit.tree.sha;
      if (tree === head.commit.tree.sha) return `Cut ${candidate} passed full run ${run.html_url}, and staging ${sha} carries its exact tree.`;
    }
    throw new Error(`No green full run proves staging ${sha} or a parent cut with its exact tree.`);
  }
  throw new Error(`No full-run proof rule for ${ref} into ${pr.base.ref}.`);
}
