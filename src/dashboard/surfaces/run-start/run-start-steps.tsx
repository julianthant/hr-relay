import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { Badge, Switch } from "../../ds/ui.js";
import * as launchDraft from "./run-launch-draft-model.js";
import { StepOmissionFactsForm } from "./run-start-kit.js";
import type { StepOmissionFactDraft, forcedStepOmissions } from "./run-start-model.js";
import type { RunStartWorkflow } from "./run-start.js";
import { includedRowCount, lastIncludedSwitch, rowIncluded, sourceBadge, type OpenStepRow, type ManualRows, type StepRow, type StepsFailure } from "./run-steps-model.js";
import { LOG_TIMELINE_STYLES } from "../run-detail/logs/log-timeline-model.js";

export function RunStartSteps({
  workflow, snapshot, rows, selectedStepKeys, manualRows, forcedByStep, openRows, isRerun, multiSubject,
  inputDriven, sending, stepLabel, stepsFailure, copiedOmissions, update,
}: {
  workflow: RunStartWorkflow;
  snapshot: RerunValuesSnapshot | null;
  rows: readonly StepRow[];
  selectedStepKeys: readonly string[];
  manualRows: ManualRows;
  forcedByStep: ReturnType<typeof forcedStepOmissions>;
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
  const stepLabels = (keys: readonly string[]): string => keys.map(stepLabel).join(", ");
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
                    <div><h4 id="run-start-steps">Steps</h4><span>{includedRowCount(rows, selectedStepKeys, manualRows)} of {rows.length} included</span></div>
                    <p>{isRerun ? "Choose steps. Status shows the earlier result." : "Replace reading steps with manual values. Form actions stay included."}</p>
                  </div>
                  <RunList label="Steps">
                    {rows.map((row) => {
                      const included = rowIncluded(row, selectedStepKeys, manualRows);
                      const forcedBy = row.stepKey === undefined ? [] : forcedByStep.get(row.stepKey) ?? [];
                      const open = openRows.find(candidate => candidate.row.key === row.key);
                      const badge = isRerun && snapshot !== null ? sourceBadge(row, snapshot) : undefined;
                      const oneSubjectOnly = multiSubject && row.form !== undefined && included;
                      const disabled = forcedBy.length > 0 || inputDriven(row) || sending || lastIncludedSwitch(row, rows, selectedStepKeys, manualRows) || oneSubjectOnly;
                      const note = forcedBy.length > 0 ? `Omitted with ${stepLabels(forcedBy)}.`
                        : oneSubjectOnly ? "One person only." : row.note;
                      const failure = stepsFailure !== null && stepsFailure.rowKey === row.key ? { [stepsFailure.fieldKey]: stepsFailure.text } : {};
                      return <RunListRow key={row.key} title={row.label} description={note}
                        {...(row.kind === "switch" ? { check: { checked: included, disabled, onChange: next => toggleRow(row, next) } } : { locked: true })}
                        below={open === undefined ? undefined : <StepOmissionFactsForm step={row.label} form={open.form} draft={open.draft} errors={failure}
                          copied={copiedFields(row)} onChange={(field, next) => changeFact(row, open.form, field, next)} disabled={sending} />}>
                        {badge !== undefined && <Badge tone={badge === "completed" ? "success" : badge === "failed" ? "danger" : "neutral"} className="launch-step-status" data-status={badge}>{badge === "completed" ? "Completed" : badge === "skipped" ? "Skipped" : badge === "failed" ? "Failed" : badge === "cancelled" ? LOG_TIMELINE_STYLES.cancelled.label : "Not started"}</Badge>}
                        {row.kind === "locked-manual" && <>
                          <Switch label={<>Enter manually<span className="sr-only"> for {row.label}</span></>} checked={manualRows.includes(row.key)} disabled={sending || multiSubject && !manualRows.includes(row.key)} onCheckedChange={next => toggleManual(row, next)} className="!min-h-0 !w-auto !py-0" /></>}
                      </RunListRow>;
                    })}
                  </RunList>
                  {stepsFailure !== null && stepsFailure.rowKey === "" && <p role="alert" className="text-caption text-ui-danger">{stepsFailure.text}</p>}
                </section>
  );
}
