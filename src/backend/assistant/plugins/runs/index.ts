import { z } from "zod";
import { CrossDateSearchStateFacetSchema, type CrossDateSearchResult } from "../../../../models/dashboard/search.js";
import { QueueStatusSchema } from "../../../../models/dashboard/projection.js";
import { operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import { ErrorCodeSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { AssistantToolRefusal, referenceSchema, type AssistantPlugin, type AssistantToolContext } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

const RunRow = z.strictObject({
  run: referenceSchema("R"), person: referenceSchema("P").nullable(), workflow: WorkflowIdSchema, status: CrossDateSearchStateFacetSchema,
  day: z.iso.date(), version: z.number().int().positive(), dryRun: z.boolean(), failureCode: ErrorCodeSchema.nullable(),
});

export function runReferences(result: CrossDateSearchResult, context: AssistantToolContext, workflowLabel: (id: string) => string) {
  const subject = result.metadata.subject;
  return {
    run: context.references.issue("R", result.runId, `${workflowLabel(result.workflowId)} run, ${result.partitionDay}`, result.runId),
    person: subject.state === "available" ? context.references.issue("P", subject.value, subject.value) : null,
  };
}
function runRow(result: CrossDateSearchResult, context: AssistantToolContext, workflowLabel: (id: string) => string): z.infer<typeof RunRow> {
  return RunRow.parse({ ...runReferences(result, context, workflowLabel), workflow: result.workflowId, status: result.state, day: result.partitionDay,
    version: result.metadata.version, dryRun: result.dryRun, failureCode: result.metadata.failureCode });
}

export function runsPlugin(deps: AssistantPluginDeps, workflowLabel: (id: string) => string): AssistantPlugin {
  const findParameters = z.strictObject({ workflow: WorkflowIdSchema.nullable(), status: CrossDateSearchStateFacetSchema.nullable(), day: z.iso.date().nullable(), limit: z.number().int().min(1).max(20) });
  const runParameters = z.strictObject({ run: referenceSchema("R") });
  const logsParameters = z.strictObject({ run: referenceSchema("R"), last: z.number().int().min(1).max(40) });
  const ReadRun = z.strictObject({
    run: referenceSchema("R"), person: referenceSchema("P").nullable(), workflow: WorkflowIdSchema, status: QueueStatusSchema,
    attempt: z.number().int().positive(), version: z.number().int().positive(),
    gate: z.strictObject({ state: z.enum(["absent", "open", "resolved"]), label: z.string().nullable(), resolution: z.enum(["approved", "rejected"]).nullable(), reason: z.string().nullable() }),
    outcome: z.strictObject({ state: z.enum(["absent", "terminal"]), result: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial"]).nullable(),
      dryRunPreview: z.boolean(), completedAt: z.iso.datetime().nullable(), reason: z.string().nullable() }),
    failure: z.strictObject({ code: ErrorCodeSchema, text: z.string().nullable() }).nullable(),
  });
  const Logs = z.strictObject({ total: z.number().int().nonnegative(), steps: z.array(z.strictObject({
    at: z.iso.datetime(), label: z.string(), state: z.enum(["pending", "active", "done", "failed", "blocked", "cancelled", "skipped"]),
    skipped: z.enum(["condition-false", "branch-not-selected", "operator-asserted", "step-omitted"]).nullable() })) });
  /** A pinned reference (the selected run) refuses once its row has moved on, before any fact is read out. */
  const currentDetail = (token: string, context: AssistantToolContext) => {
    const entry = context.references.resolve(token, ["R"]), detail = deps.runDetail(entry.target);
    if (entry.version !== undefined && detail.rowRevision !== entry.version) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
    return { id: entry.target, detail };
  };
  const indexed = (id: string) => deps.search({ q: id, scope: "run", facets: {}, limit: 1 }).results.find(result => result.runId === id);
  return { domain: "runs", tools: [
    { kind: "read", tier: "read", name: "find_runs",
      description: "List recent runs, newest first, filtered by workflow id, status or day (all nullable). Returns run and person references; use find_people to search by a person's name.",
      parameters: findParameters, output: z.strictObject({ runs: z.array(RunRow), more: z.boolean() }), privacy: [],
      async invoke(value, context) {
        const input = findParameters.parse(value);
        const page = deps.search({ q: "", scope: "all", limit: input.limit, facets: {
          ...(input.workflow === null ? {} : { workflow: input.workflow }), ...(input.status === null ? {} : { state: input.status }), ...(input.day === null ? {} : { day: input.day }) } });
        context.assertCurrent();
        return JsonValueSchema.parse({ runs: page.results.map(result => runRow(result, context, workflowLabel)), more: page.totalMatches > page.results.length });
      } },
    { kind: "read", tier: "read", name: "read_run",
      description: "Read one run's status, attempt, review gate, outcome and failure (catalog code and its text). Use it to explain why a run is waiting, failed or finished.",
      parameters: runParameters, output: ReadRun,
      privacy: [{ path: "gate.label", origin: "repository-authored" }, { path: "gate.reason", origin: "repository-authored" },
        { path: "outcome.reason", origin: "repository-authored" }, { path: "failure.text", origin: "repository-authored" }],
      async invoke(value, context) {
        const { id, detail } = currentDetail(runParameters.parse(value).run, context), result = indexed(id);
        context.assertCurrent();
        const { gate, outcome } = detail, failureCode = result?.metadata.failureCode ?? null;
        return JsonValueSchema.parse(ReadRun.parse({
          run: runParameters.parse(value).run, person: result === undefined ? null : runReferences(result, context, workflowLabel).person,
          workflow: detail.header.workflowId, status: detail.header.status, attempt: detail.header.attempt, version: detail.rowRevision,
          gate: { state: gate.state, label: gate.state === "absent" ? null : gate.label, resolution: gate.state === "resolved" ? gate.resolution : null, reason: gate.state === "absent" ? gate.reason : null },
          outcome: { state: outcome.state, result: outcome.state === "terminal" ? outcome.result : null, dryRunPreview: outcome.state === "terminal" && outcome.rehearsal === true,
            completedAt: outcome.state === "terminal" ? outcome.completedAt : null, reason: outcome.state === "absent" ? outcome.reason : null },
          failure: failureCode === null ? null : { code: failureCode, text: operatorFailureSentence(failureCode) },
        }));
      } },
    { kind: "read", tier: "read", name: "read_run_logs",
      description: "Read the last steps of one run's Logs timeline in order: label, state and why a skipped step did not run.",
      parameters: logsParameters, output: Logs, privacy: [{ path: "steps[].label", origin: "repository-authored" }],
      async invoke(value, context) {
        const input = logsParameters.parse(value), events = currentDetail(input.run, context).detail.timeline.events;
        context.assertCurrent();
        return JsonValueSchema.parse({ total: events.length, steps: events.slice(-input.last).map(event => ({ at: event.at, label: event.label, state: event.state,
          skipped: event.notRun.state === "present" ? event.notRun.reason : null })) });
      } },
  ] };
}
