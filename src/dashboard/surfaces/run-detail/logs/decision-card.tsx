import { useState, type ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button, Checkbox, ChoicePicker } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

export type DecisionAnswered = Readonly<{ choice: string; time: string; by: string }>;
export type DecisionSuggestion = Readonly<{ option: string; evidence: string }>;
export type DecisionChoiceOption = Readonly<{ value: string; label: string; hint: string }>;

/**
 * The one card for every manual choice or input in Logs: title, one context line, an optional assistant
 * suggestion, the control, then Confirm and Cancel run. Enter submits; Escape is left to the open control.
 * Answered, it collapses to one line that stays in the log. `preview` (Explorer) shows the card without actions.
 */
export function DecisionCard({ title, context, tone, suggestion, applyAll, confirmLabel = "Confirm", cancelLabel = "Cancel run", confirmDisabled = false, answered, preview = false, onConfirm, onCancel, children }: {
  title: string; context?: string; tone?: "danger"; suggestion?: DecisionSuggestion;
  applyAll?: Readonly<{ count: number; checked: boolean; onChange: (checked: boolean) => void }>;
  confirmLabel?: string; cancelLabel?: string; confirmDisabled?: boolean; answered?: DecisionAnswered; preview?: boolean;
  onConfirm?: () => void; onCancel?: () => void; children?: ReactNode;
}) {
  if (answered) return <p className="m-0 flex items-center gap-2.5 text-body text-ui-secondary">
    <Check aria-hidden className="size-3.5 shrink-0 text-ui-positive" />
    <span>Answered: <span className="font-medium text-ui-primary">{answered.choice}</span> · <span className="tabular-nums">{answered.time}</span> · by {answered.by}</span>
  </p>;
  return <form aria-label={title} onSubmit={event => { event.preventDefault(); if (!preview && !confirmDisabled) onConfirm?.(); }}
    className={cn("flex flex-col gap-3 rounded-lg border bg-ui-panel p-4", tone === "danger" ? "border-ui-danger/40" : "border-ui-stroke-control")}>
    <div className="flex flex-col gap-1">
      <h4 className={cn("m-0 text-heading", tone === "danger" && "text-ui-danger")}>{title}</h4>
      {context && <p className="m-0 text-body text-ui-secondary">{context}</p>}
    </div>
    {suggestion && <p className="m-0 flex items-start gap-2.5 rounded-md bg-ui-info/10 px-3 py-2 text-body">
      <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-info" />
      <span><span className="font-medium">Assistant suggests: {suggestion.option}</span><span className="block text-ui-secondary">{suggestion.evidence}</span></span>
    </p>}
    {children}
    {applyAll && <Checkbox label={`Use for all ${applyAll.count} similar`} checked={applyAll.checked} onCheckedChange={value => applyAll.onChange(value === true)} disabled={preview} />}
    {!preview && <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="primary" disabled={confirmDisabled}>{confirmLabel}</Button>
      <Button type="button" onClick={onCancel}>{cancelLabel}</Button>
    </div>}
  </form>;
}

/** A short choice list as a dropdown; every option carries a one-line hint, and the recommended one comes preselected. */
export function DecisionChoice({ label, options, value, onChange, disabled }: {
  label: string; options: readonly DecisionChoiceOption[]; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const selected = options.find(option => option.value === value);
  return <div className="flex max-w-md flex-col gap-1">
    <ChoicePicker label={label} value={value} disabled={disabled} onChange={onChange} options={options.map(option => ({ value: option.value, label: option.label, description: option.hint }))} />
    {selected && <p className="m-0 text-caption text-ui-muted">{selected.hint}</p>}
  </div>;
}

/** Local state for the "Use for all N similar" box, so callers pass one prop. */
export function useApplyAll(count: number | undefined) {
  const [checked, setChecked] = useState(false);
  return count === undefined ? undefined : { count, checked, onChange: setChecked };
}
