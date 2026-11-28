import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { Badge, Switch } from "../../ds/ui.js";
import * as launchDraft from "./run-launch-draft-model.js";
import { StepOmissionFactsForm } from "./run-start-kit.js";
import { forcedStepOmissions, type StepOmissionFactDraft } from "./run-start-model.js";
import type { RunStartWorkflow } from "./run-start.js";
import { childStepViews, includedRowCount, lastIncludedSwitch, retainedRowSteps, rowIncluded, sourceBadge, type OpenStepRow, type ManualRows, type StepRow, type StepsFailure } from "./run-steps-model.js";

export function RunStartSteps({
  workflow, snapshot, rows, selectedStepKeys, manualRows, forcedByStep, handOffByStep, openRows, isRerun, multiSubject,
  inputDriven, sending, stepLabel, stepsFailure, copiedOmissions, update,
}: {
  workflow: RunStartWorkflow;
  snapshot: RerunValuesSnapshot | null;
  rows: readonly StepRow[];
  selectedStepKeys: readonly string[];
  manualRows: ManualRows;
  forcedByStep: ReturnType<typeof forcedStepOmissions>;
  handOffByStep: ReturnType<typeof forcedStepOmissions>;
  openRows: readonly OpenStepRow[];
  isRerun: boolean;
  multiSubject: boolean;
  inputDriven: (row: StepRow) => boolean;
  sending: boolean;
  stepLabel: (key: string) => string;
  stepsFailure: StepsFailure | null;
  copiedOmissions: launchDraft.LaunchDraft["copiedOmissions"];
  update: (change: (current: launchDraft.LaunchDraft) => launchDraft.LaunchDraft) => void;
}) {
  const stepLabels = (keys: readonly string[]): string => keys.map(key => rows.find(row => row.stepKey === key)?.label ?? stepLabel(key)).join(", ");
  const children = childStepViews(rows);
  const forcedByChild = forcedStepOmissions(children, children.map(({ key }) => key).filter(key => !manualRows.includes(key)));
  /** Use the shared cascade; locked omissions cannot be changed by another checkbox path. */
  const toggleRow = (row: StepRow, next: boolean) => {
    if (workflow !== undefined) update(current => launchDraft.toggleRow(current, workflow, snapshot, row, next));
  };
  const toggleManual = (row: StepRow, next: boolean) => update(current => launchDraft.toggleManual(current, snapshot, row, next));

  const changeFact = (row: StepRow, form: StepOmissionForm, field: string, next: StepOmissionFactDraft) =>
    update(current => launchDraft.changeFact(current, snapshot, row, form, field, next));
  /** The fields of a row still holding a value copied unedited from the earlier run. */
  const copiedFields = (row: StepRow): ReadonlySet<string> => new Set(Object.keys(copiedOmissions).flatMap(index => {
    const candidate = snapshot?.values[Number(index)];
    return candidate?.targetStepKey !== undefined && candidate.targetStepKey === row.stepKey ? [candidate.targetFieldPath] : [];
  }));
  return (
                <section aria-labelledby="run-start-steps" className="launch-section">
                  <div className="launch-section-head">
                    <div><h4 id="run-start-steps">Steps</h4><span>{includedRowCount(rows, selectedStepKeys, manualRows, snapshot)} of {rows.length} included</span></div>
                    <p>{isRerun ? "Choose steps. Status shows the earlier result." : "Turn off a step done by hand. Reads take manual values."}</p>
                  </div>
                  <RunList label="Steps">
                    {rows.map((row) => {
                      const included = rowIncluded(row, selectedStepKeys, manualRows, snapshot);
                      const retained = snapshot?.retainedSteps === undefined ? undefined : retainedRowSteps(row, snapshot);
                      const missingPrerequisite = row.requiresStep !== undefined && !selectedStepKeys.includes(row.requiresStep) ? row.requiresStep : undefined;
                      const forcedBy = missingPrerequisite === undefined
                        ? (row.stepKey === undefined ? forcedByChild.get(row.key) : forcedByStep.get(row.stepKey)) ?? []
                        : [missingPrerequisite];
                      const open = openRows.find(candidate => candidate.row.key === row.key);
                      const badge = isRerun && snapshot !== null ? sourceBadge(row, snapshot) : undefined;
                      const doneByHand = row.stop === undefined && row.form !== undefined && row.form.fields.length === 0;
                      const oneSubjectOnly = multiSubject && (row.form?.fields.length ?? 0) > 0 && included;
                      const disabled = forcedBy.length > 0 || inputDriven(row) || sending || lastIncludedSwitch(row, rows, selectedStepKeys, manualRows) || oneSubjectOnly;
                      const check = retained !== undefined
                        ? { checked: included, disabled: sending || retained.length === 0 || retained.some(step => !step.repeatable), onChange: (next: boolean) => toggleRow(row, next) }
                        : row.kind === "switch" ? { checked: included, disabled, onChange: (next: boolean) => toggleRow(row, next) } : undefined;
                      const needs = row.stepKey === undefined ? [] : handOffByStep.get(row.stepKey) ?? [];
                      const note = retained !== undefined ? included ? undefined : "Uses the earlier result."
                        : forcedBy.length > 0 ? `Omitted with ${row.child === undefined || missingPrerequisite !== undefined ? stepLabels(forcedBy) : rows.filter(other => forcedBy.includes(other.key)).map(other => other.label).join(", ")}.`
                        : needs.length > 0 ? `Needs ${stepLabels(needs)}. Turn off if done by hand.`
                        : oneSubjectOnly ? "One person only." : !included && row.stop !== undefined
                          ? row.note === undefined ? row.stop : `${row.note.replace(/\.?$/u, ".")} ${row.stop}`
                          : doneByHand && !included ? "Done outside Relay." : row.note;
                      const failure = stepsFailure !== null && stepsFailure.rowKey === row.key ? { [stepsFailure.fieldKey]: stepsFailure.text } : {};
                      return <RunListRow key={row.key} title={row.label} description={note}
                        {...(check === undefined ? { locked: true } : { check })}
                        below={open === undefined ? undefined : <StepOmissionFactsForm step={row.label} form={open.form} draft={open.draft} errors={failure}
                          copied={copiedFields(row)} onChange={(field, next) => changeFact(row, open.form, field, next)} disabled={sending} />}>
                        {badge !== undefined && <Badge tone={badge === "completed" ? "success" : badge === "failed" ? "danger" : "neutral"} className="launch-step-status" data-status={badge}>{badge === "completed" ? "Completed" : badge === "skipped" ? "Skipped" : badge === "failed" ? "Failed" : badge === "cancelled" ? "Cancelled" : "Not started"}</Badge>}
                        {retained === undefined && row.kind === "locked-manual" && <>
                          <Switch label={<>Enter manually<span className="sr-only"> for {row.label}</span></>} checked={manualRows.includes(row.key)} disabled={sending || multiSubject && !manualRows.includes(row.key)} onCheckedChange={next => toggleManual(row, next)} className="!min-h-0 !w-auto !py-0" /></>}
                      </RunListRow>;
                    })}
                  </RunList>
                  {stepsFailure !== null && stepsFailure.rowKey === "" && <p role="alert" className="text-caption text-ui-danger">{stepsFailure.text}</p>}
                </section>
  );
}
