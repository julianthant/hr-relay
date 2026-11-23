import { z } from "zod";
import { isDirectExecution } from "./scope-files.js";

const suiteNames = ["unit", "integration", "architecture"] as const;
const contextSchema = z.object({
  workflow: z.enum(["fast", "portable", "release", "full"]), event: z.enum(["pull_request", "push", "workflow_dispatch", "schedule"]),
  base: z.string(), head: z.string(), draft: z.boolean(), filters: z.record(z.string(), z.string()),
  affected: z.object({ core: z.boolean(), shardCount: z.number().int().nonnegative(),
    shards: z.array(z.array(z.string().startsWith("tests/")).min(1)) }).optional(),
});
const matrixSchema = z.object({ include: z.array(z.object({
  suite: z.enum(["unit", "integration", "architecture", "native"]),
  shard: z.number().int().positive(), shards: z.number().int().positive(),
  files: z.array(z.string().startsWith("tests/")).min(1).optional(),
})) });
export const ciPlanSchema = z.object({
  workflow: z.enum(["fast", "portable", "release", "full"]), fullRelease: z.boolean(),
  lint: z.boolean(), perf: z.boolean(), smoke: z.boolean(),
  unit: z.boolean(), integration: z.boolean(), architecture: z.boolean(),
  ubuntu: matrixSchema, macos: matrixSchema,
  testJobs: z.number().int().nonnegative(),
}).refine(plan => plan.testJobs === plan.ubuntu.include.length + plan.macos.include.length,
  "CI matrix count is inconsistent.");
export type CiPlan = z.infer<typeof ciPlanSchema>;

export function createCiPlan(input: unknown): CiPlan {
  const context = contextSchema.parse(input);
  const manual = context.event === "workflow_dispatch";
  const fast = context.workflow === "fast";
  const full = context.workflow === "full";
  if (full ? !(manual || context.event === "schedule") || context.head !== "development" : context.event === "schedule") {
    throw new Error("Full CI runs only on the development schedule or dispatch.");
  }
  if (context.event === "push" && !(fast && context.head.startsWith("task/"))) {
    throw new Error("Push CI runs only fast checks on task branches.");
  }
  if (fast && (manual || context.base !== "development")) {
    throw new Error("Fast CI requires a development pull request.");
  }
  if (fast !== (context.affected !== undefined)) {
    throw new Error("Only fast CI takes the affected integration plan.");
  }
  if (context.workflow === "portable" && (manual || (context.base !== "staging" && !(context.base === "main" && context.head === "staging")))) {
    throw new Error("Portable CI requires a staging or staging-to-main pull request.");
  }
  if (context.workflow === "release" && !manual && context.base !== "main") {
    throw new Error("Release CI requires a main pull request or manual release.");
  }
  const taskPush = context.event === "push";
  const requiredFilters = ["shared", ...suiteNames, ...(taskPush ? ["smoke"] : [])];
  if (!manual && !full && requiredFilters.some(name => !["true", "false"].includes(context.filters[name]))) {
    throw new Error("Path-filter outputs are incomplete or invalid.");
  }
  const fullRelease = full || (context.workflow === "release" && (manual || context.head.startsWith("hotfix/")));
  const enabled = (suite: typeof suiteNames[number]) =>
    manual || full || context.filters.shared === "true" || context.filters[suite] === "true";
  const selected = { unit: enabled("unit"), integration: enabled("integration"), architecture: enabled("architecture") };
  const affected = context.draft ? [] : context.affected?.shards ?? [];
  if (fast) selected.integration = affected.length > 0;
  if (!manual && context.draft) {
    selected.integration = false;
    selected.architecture = false;
  }
  const jobs = (suite: z.infer<typeof matrixSchema>["include"][number]["suite"], shards: number) =>
    Array.from({ length: shards }, (_, i) => ({ suite, shard: i + 1, shards }));
  const ubuntu = [
    ...(selected.unit ? jobs("unit", 3) : []),
    ...(selected.architecture ? jobs("architecture", 2) : []),
    ...(fast ? affected.map((files, i) => ({ suite: "integration" as const, shard: i + 1, shards: affected.length, files }))
      : selected.integration ? jobs("integration", 30) : []),
  ];
  const nativeShards = selected.integration ? 5 : selected.unit ? 1 : 0;
  const macos = fullRelease ? jobs("native", nativeShards) : [];
  return ciPlanSchema.parse({ ...selected, workflow: context.workflow, fullRelease,
    lint: !fast || !context.draft,
    perf: !fast && (full || !manual) && !context.draft,
    smoke: (full || !manual) && !context.draft && (!fast || (taskPush && context.filters.smoke === "true")),
    ubuntu: { include: ubuntu }, macos: { include: macos },
    testJobs: ubuntu.length + macos.length,
  });
}

const resultsSchema = z.record(z.string(), z.object({ result: z.enum(["success", "failure", "cancelled", "skipped"]) }));
type Results = z.infer<typeof resultsSchema>;
function requireResult(results: Results, job: string, expected: "success" | "skipped"): void {
  if (results[job]?.result !== expected) throw new Error(`CI ${job} must be ${expected}.`);
}

export function verifyUnitProof(input: unknown, outcomes: unknown): void {
  const plan = ciPlanSchema.parse(input);
  const results = resultsSchema.parse(outcomes);
  requireResult(results, "changes", "success");
  if (plan.unit) {
    requireResult(results, "ubuntu", "success");
    if (plan.workflow === "release" || plan.workflow === "full") {
      requireResult(results, "macos", plan.fullRelease ? "success" : "skipped");
    }
  }
}

export function verifyProofs(input: unknown, outcomes: unknown): void {
  const plan = ciPlanSchema.parse(input);
  const results = resultsSchema.parse(outcomes);
  for (const job of ["changes", "static", "privacy"]) requireResult(results, job, "success");
  requireResult(results, "lint", plan.lint ? "success" : "skipped");
  for (const job of ["integration", "architecture"]) requireResult(results, job, plan.workflow === "fast" ? "skipped" : "success");
  if (plan.workflow === "fast") {
    for (const job of ["macos", "unit-proofs", "unit"]) requireResult(results, job, "skipped");
  }
  requireResult(results, "ubuntu", plan.unit || plan.integration || plan.architecture ? "success" : "skipped");
  if (plan.workflow === "release" || plan.workflow === "full") {
    requireResult(results, "unit-proofs", "success");
    requireResult(results, "macos", plan.fullRelease && (plan.unit || plan.integration) ? "success" : "skipped");
  }
  for (const job of ["perf", "smoke"] as const) requireResult(results, job, plan[job] ? "success" : "skipped");
  verifyUnitProof(plan, results);
}

export function verifyCiResults(input: unknown, outcomes: unknown): void {
  const plan = ciPlanSchema.parse(input);
  const results = resultsSchema.parse(outcomes);
  verifyProofs(plan, results);
}

export function publishTimings(input: unknown, outcomes: unknown): boolean {
  const plan = ciPlanSchema.parse(input);
  const results = resultsSchema.parse(outcomes);
  try {
    verifyProofs(plan, results);
  } catch (error) {
    if (error instanceof Error && /^CI \S+ must be (?:success|skipped)\.$/u.test(error.message)) return false;
    throw error;
  }
  return plan.testJobs > 0;
}

const workflowsSchema = z.array(z.object({ id: z.number().int().positive(), path: z.string() }));
export function registeredTimingWorkflows(input: unknown): number[] {
  return workflowsSchema.parse(input).filter(workflow =>
    [".github/workflows/staging.yml", ".github/workflows/production.yml"].includes(workflow.path)).map(workflow => workflow.id);
}

const historySchema = z.object({ currentRunId: z.number().int().positive(), runs: z.array(z.object({
  id: z.number().int().positive(), created_at: z.iso.datetime(), conclusion: z.literal("success"),
})) });
export function timingRunIds(input: unknown): number[] {
  const history = historySchema.parse(input);
  return history.runs.filter(run => run.id !== history.currentRunId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).map(run => run.id);
}

export function hasTimingArtifact(input: unknown): boolean {
  return z.array(z.object({ name: z.string(), expired: z.boolean() })).parse(input)
    .some(artifact => artifact.name === "ci-timings" && !artifact.expired);
}

if (isDirectExecution(import.meta.url)) {
  const [command, payload, outcomes] = process.argv.slice(2);
  const input: unknown = JSON.parse(payload ?? "");
  let result: unknown;
  if (command === "plan") result = createCiPlan(input);
  else if (command === "workflows") result = registeredTimingWorkflows(input);
  else if (command === "history") result = timingRunIds(input);
  else if (command === "artifact") result = hasTimingArtifact(input);
  else if (command === "publish") result = publishTimings(input, JSON.parse(outcomes ?? ""));
  else if (command === "unit-proof" || command === "proofs" || command === "verify") {
    const plan = input;
    const results: unknown = JSON.parse(outcomes ?? "");
    if (command === "unit-proof") verifyUnitProof(plan, results);
    else if (command === "proofs") verifyProofs(plan, results);
    else verifyCiResults(plan, results);
    result = true;
  } else throw new Error(`Unknown CI plan command: ${command}`);
  process.stdout.write(JSON.stringify(result) + "\n");
}
