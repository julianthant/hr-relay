import type { WorkflowOperationDisplaySnapshot } from "../../models/workflow/operation-display-snapshot.js";
import type { DeclaredActionOccurrence } from "../../rules/workflow/task-provenance.js";
import { canonicalJsonStringify, type JsonValue } from "../../rules/validation/canonical-json.js";
import { confirmedStepOccurrence, DeclaredStepResultSchema, type DeclaredStepResult } from "../../models/events/confirmed-action.js";
export type { DeclaredStepResult } from "../../models/events/confirmed-action.js";

type Invocation = WorkflowOperationDisplaySnapshot["invocations"][number];
type Reference = Invocation["outcomes"][number]["when"]["value"];

export type ConfirmedOutcomeEvidence = Readonly<{
  reference: Reference;
  action: DeclaredActionOccurrence;
  state: "confirmed" | "unavailable";
  present?: boolean;
  value?: JsonValue;
}>;


/** Select only a frozen declared outcome from exact confirmed invocation evidence. */
export function selectDeclaredStepResult(input: Readonly<{
  snapshot: WorkflowOperationDisplaySnapshot;
  entryId: string;
  taskId: string;
  invocationId: string;
  runId: string;
  attempt: number;
  claimGeneration: number;
  taskAttempt: number;
  evidence: readonly ConfirmedOutcomeEvidence[];
}>): DeclaredStepResult {
  const invocation = input.snapshot.invocations.find(candidate => candidate.entryId === input.entryId
    && candidate.taskId === input.taskId && candidate.id === input.invocationId && candidate.contractRole === "task");
  if (invocation === undefined) throw new Error("declared-step-result-invocation-missing");
  const stepOccurrence = confirmedStepOccurrence({ runId: input.runId, attempt: input.attempt,
    claimGeneration: input.claimGeneration, taskAttempt: input.taskAttempt, occurrencePath: invocation.occurrencePath });
  const result = (value: object): DeclaredStepResult => DeclaredStepResultSchema.parse({ version: 1, stepOccurrence, ...value });
  if (invocation.outcomes.length === 0) return result({ state: "no-match" });
  const matching: Array<{ candidate: Invocation["outcomes"][number]; source: DeclaredActionOccurrence }> = [];
  for (const candidate of invocation.outcomes) {
    const evidence = input.evidence.filter(fact => canonicalJsonStringify(fact.reference) === canonicalJsonStringify(candidate.when.value));
    if (evidence.length !== 1) return result({ state: evidence.length === 0 ? "unavailable" : "ambiguous" });
    const fact = evidence[0];
    const source = fact.action;
    if (fact.state !== "confirmed" || fact.present === undefined
      || source.runId !== input.runId || source.nodeId !== input.entryId || source.taskId !== input.taskId
      || source.invocationId !== input.invocationId || source.attempt !== input.attempt
      || source.claimGeneration !== input.claimGeneration || source.taskAttempt !== input.taskAttempt
      || source.occurrencePath.join("/") !== invocation.occurrencePath.join("/")) return result({ state: "unavailable" });
    let matches = false;
    switch (candidate.when.kind) {
      case "is-present": matches = fact.present; break;
      case "is-absent": matches = !fact.present; break;
      case "equals": matches = fact.present && fact.value !== undefined
        && canonicalJsonStringify(fact.value) === canonicalJsonStringify(candidate.when.expected); break;
      case "not-equals": matches = fact.present && fact.value !== undefined
        && canonicalJsonStringify(fact.value) !== canonicalJsonStringify(candidate.when.expected); break;
    }
    if (matches) matching.push({ candidate, source });
  }
  if (matching.length > 1) return result({ state: "ambiguous" });
  if (matching.length === 0) return result({ state: "no-match" });
  return result({ state: "selected", caseId: matching[0].candidate.id, label: matching[0].candidate.label, source: matching[0].source });
}
