import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Button, ChoicePicker } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

export type DecisionAnswered = Readonly<{ choice: string; time: string; by: string }>;
export type DecisionChoiceOption = Readonly<{ value: string; label: string; hint: string }>;

/**
 * The one card for every manual choice or input in Logs: title, one context line, the control, then
 * Confirm and Cancel run. Enter submits; Escape is left to the open control.
 * Answered, it collapses to one line that stays in the log. `preview` (Explorer) shows the card without actions.
 */
export function DecisionCard({ title, context, tone, confirmLabel = "Confirm", cancelLabel = "Cancel run", confirmDisabled = false, answered, preview = false, onConfirm, onCancel, children }: {
  title: string; context?: string; tone?: "danger";
  confirmLabel?: string; cancelLabel?: string; confirmDisabled?: boolean; answered?: DecisionAnswered; preview?: boolean;
  onConfirm?: () => void; onCancel?: () => void; children?: ReactNode;
}) {
  if (answered) return <p className="m-0 flex items-center gap-2.5 text-body text-ui-secondary">
    <Check aria-hidden className="size-3.5 shrink-0 text-ui-positive" />
    <span>Answered: <span className="font-medium text-ui-primary">{answered.choice}</span> · <span className="tabular-nums">{answered.time}</span> · by {answered.by}</span>
  </p>;
  return <form aria-label={title} onSubmit={event => { event.preventDefault(); if (!preview && !confirmDisabled) onConfirm?.(); }}
    className="flex flex-col gap-3 rounded-lg border border-ui-stroke bg-ui-panel p-4">
    <div className="flex flex-col gap-1">
      <h4 className={cn("m-0 text-heading", tone === "danger" && "text-ui-danger")}>{title}</h4>
      {context && <p className="m-0 text-body text-ui-secondary">{context}</p>}
    </div>
    {children}
    {!preview && <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="primary" disabled={confirmDisabled}>{confirmLabel}</Button>
      <Button type="button" onClick={onCancel}>{cancelLabel}</Button>
    </div>}
  </form>;
}

/** A short choice list as a dropdown at a fixed narrow width; every option carries a one-line hint, and the recommended one comes preselected. */
export function DecisionChoice({ label, options, value, onChange, disabled }: {
  label: string; options: readonly DecisionChoiceOption[]; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const selected = options.find(option => option.value === value);
  return <div className="flex w-80 max-w-full flex-col gap-1 self-start">
    <ChoicePicker label={label} value={value} disabled={disabled} onChange={onChange} options={options.map(option => ({ value: option.value, label: option.label, description: option.hint }))} />
    {selected && <p className="m-0 text-caption text-ui-muted">{selected.hint}</p>}
  </div>;
}
