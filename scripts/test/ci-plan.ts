import { z } from "zod";
import { isDirectExecution } from "./scope-files.js";

const suiteNames = ["unit", "integration", "architecture"] as const;
const contextSchema = z.object({
  workflow: z.enum(["portable", "release"]), event: z.enum(["pull_request", "workflow_dispatch"]),
  base: z.string(), head: z.string(), draft: z.boolean(), filters: z.record(z.string(), z.string()),
});
const matrixSchema = z.object({ include: z.array(z.object({
  suite: z.enum(["unit", "integration", "architecture", "native"]),
  shard: z.number().int().positive(), shards: z.number().int().positive(),
})) });
export const ciPlanSchema = z.object({
  workflow: z.enum(["portable", "release"]), fullRelease: z.boolean(), releaseBatch: z.boolean(),
  unit: z.boolean(), integration: z.boolean(), architecture: z.boolean(),
  ubuntu: matrixSchema, macos: matrixSchema, windows: matrixSchema,
  testJobs: z.number().int().nonnegative(),
}).refine(plan => plan.testJobs === plan.ubuntu.include.length + plan.macos.include.length + plan.windows.include.length,
  "CI matrix count is inconsistent.");
export type CiPlan = z.infer<typeof ciPlanSchema>;

export function createCiPlan(input: unknown): CiPlan {
  const context = contextSchema.parse(input);
  const manual = context.event === "workflow_dispatch";
  if (context.workflow === "portable" && (manual || context.base !== "staging")) {
    throw new Error("Portable CI requires a staging pull request.");
  }
  if (context.workflow === "release" && !manual && context.base !== "main") {
    throw new Error("Release CI requires a main pull request or manual release.");
  }
  if (!manual && ["shared", ...suiteNames].some(name => !["true", "false"].includes(context.filters[name]))) {
    throw new Error("Path-filter outputs are incomplete or invalid.");
  }
  const fullRelease = context.workflow === "release" && (manual || context.head === "staging");
  const enabled = (suite: typeof suiteNames[number]) =>
    manual || context.filters.shared === "true" || context.filters[suite] === "true";
  const selected = { unit: enabled("unit"), integration: enabled("integration"), architecture: enabled("architecture") };
  if (!manual && context.draft) {
    selected.integration = false;
    selected.architecture = false;
  }
  const jobs = (suite: z.infer<typeof matrixSchema>["include"][number]["suite"], shards: number) =>
    Array.from({ length: shards }, (_, i) => ({ suite, shard: i + 1, shards }));
  const ubuntu = [
    ...(selected.unit ? jobs("unit", selected.integration ? 2 : 3) : []),
    ...(selected.architecture ? jobs("architecture", 2) : []),
    ...(selected.integration ? jobs("integration", 14) : []),
  ];
  const nativeShards = selected.integration ? 5 : selected.unit ? 1 : 0;
  const macos = fullRelease ? jobs("native", nativeShards) : [];
  const windows = fullRelease ? jobs("native", selected.integration ? 5 : selected.unit ? 1 : 0) : [];
  return ciPlanSchema.parse({ ...selected, workflow: context.workflow, fullRelease,
    releaseBatch: !manual && fullRelease && selected.architecture,
    ubuntu: { include: ubuntu }, macos: { include: macos }, windows: { include: windows },
    testJobs: ubuntu.length + macos.length + windows.length,
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
    if (plan.workflow === "release") {
      requireResult(results, "macos", plan.fullRelease ? "success" : "skipped");
      requireResult(results, "windows", plan.fullRelease ? "success" : "skipped");
    }
  }
}

export function verifyProofs(input: unknown, outcomes: unknown): void {
  const plan = ciPlanSchema.parse(input);
  const results = resultsSchema.parse(outcomes);
  for (const job of ["changes", "static", "privacy", "integration", "architecture"]) requireResult(results, job, "success");
  requireResult(results, "ubuntu", plan.unit || plan.integration || plan.architecture ? "success" : "skipped");
  if (plan.workflow === "release") {
    requireResult(results, "unit-proofs", "success");
    requireResult(results, "macos", plan.fullRelease && (plan.unit || plan.integration) ? "success" : "skipped");
    requireResult(results, "windows", plan.fullRelease && (plan.unit || plan.integration) ? "success" : "skipped");
    requireResult(results, "release-batch", plan.releaseBatch ? "success" : "skipped");
  }
  verifyUnitProof(plan, results);
}

export function verifyCiResults(input: unknown, outcomes: unknown): void {
  const plan = ciPlanSchema.parse(input);
  const results = resultsSchema.parse(outcomes);
  verifyProofs(plan, results);
  requireResult(results, "timings", plan.testJobs > 0 ? "success" : "skipped");
}

const workflowsSchema = z.array(z.object({ id: z.number().int().positive(), path: z.string() }));
export function registeredTimingWorkflows(input: unknown): number[] {
  return workflowsSchema.parse(input).filter(workflow =>
    [".github/workflows/ci.yml", ".github/workflows/release.yml"].includes(workflow.path)).map(workflow => workflow.id);
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
