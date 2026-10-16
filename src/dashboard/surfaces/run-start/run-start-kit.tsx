import type { RefObject } from "react";
import { Check, CheckCircle2, FlaskConical } from "lucide-react";
import type { SurfaceField, InputRunSurface, TypedInputDraft } from "../../../models/workflow/ingress.js";
import { cn } from "../../lib/utils.js";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  Checkbox,
  DateInput,
  Field,
  Input,
  KeyValueList,
  MetaLine,
  Refusal,
  Select,
  SegmentedChoice,
  Textarea,
  Well,
  dsFg,
  dsIcon,
  dsText,
} from "../../ds/ui.js";
import { fmtClock } from "../shared/status/format.js";
import type { CommandResult } from "../../../rules/commands/commands.js";
import type { StartPlanResponse } from "../../client/index.js";
import { surfaceValueLabel } from "./run-start-kit-model.js";
import { typedInputMode, typedInputDefaults, inputRunFieldLabel, inputRunDelimiterHint, type RunInputPreview, type StepOmissionDraft, type StepOmissionFactDraft } from "./run-start-model.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";
/** the non-default run flags shown in the preview and confirmation */
export function RunFlagChips({
  dryRun,
  priority,
}: {
  dryRun: boolean;
  priority?: "interactive" | "bulk";
}) {
  return (
    <span className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
      {dryRun && (
        <Badge tone="info">
          <FlaskConical aria-hidden className={dsIcon.sm} />
          dry run
        </Badge>
      )}
      {/** Only when it is NOT the default. */}
      {priority === "bulk" && <Badge tone="neutral">bulk</Badge>}
    </span>
  );
}

// Sub-selections — what the workflow's own input surface FIXES

/** One sub-selection, rendered the same way for every workflow that declares
 * one; a descriptor declares only its input surface */
export function StartChoiceControl({ constant, reason }: { constant: SurfaceField; reason: string }) {
  return <LockedFact label={constant.field} value={surfaceValueLabel(constant)} reason={reason} />;
}

/** Fixed workflow facts use plain read-only values rather than disabled controls. */
export function LockedFact({ label, value, reason }: { label: string; value: string; reason: string }) {
  return <div><span className={cn(dsText.meta, "font-medium", dsFg.secondary)}>{label}</span><p className={cn(dsText.body, "mt-[var(--ds-space-tight)]", dsFg.base)}>{value}</p><p className={cn(dsText.meta, "mt-[var(--ds-space-tight)]", dsFg.muted)}>{reason}</p></div>;
}

/** A run flag. A `Checkbox`, deliberately, and not a `Switch`: nothing here
 * takes effect until the primary action is pressed, and the switch primitive's */
export function StartFlagControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
      label={label}
    />
  );
}

// Plan preview — what this start WILL create

/** The server's exact proposal. Every column is a served identity: nothing here
 * is derived, counted, or renamed, because the operator is about to authorise */
export function PlanPreview({
  plan,
  className,
  compact = false,
}: {
  plan: StartPlanResponse;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={cn("flex flex-col gap-[var(--ds-space-base)]", className)}>
      {!compact && <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        <span className={cn(dsText.ui, "font-semibold", dsFg.base)}>
          {plan.planned.length === 1 ? "1 run" : `${String(plan.planned.length)} runs`}
        </span>
        <RunFlagChips dryRun={plan.dryRun} priority={plan.priority} />
      </div>}

      {plan.planned.length === 0 ? (
        <Well>
          <span className={dsFg.muted}>Nothing to create — every entry was refused.</span>
        </Well>
      ) : (
        <ul aria-label="Runs this start will create" className="flex flex-col gap-[var(--ds-space-snug)]">
          {plan.planned.map((row) => (
            <li key={row.logicalKey}>
              <PlanRowCard row={row} />
              {row.supersedeTargets !== undefined && (
                <div className="flex flex-col gap-[var(--ds-space-tight)] py-[var(--ds-space-snug)]">
                  <span className={dsText.body}>{row.supersedeTargets.length === 0 ? "No active runs to replace." : "Active runs to replace:"}</span>
                  {row.supersedeTargets.map((target) => <MetaLine key={target.runId}
                    items={[target.traceId, target.runId, `revision ${target.version}`, `attempt ${target.attempt}`, `generation ${target.claimGeneration}`]} />)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <MetaLine
        tone="faint"
        items={[
          `plan ${plan.startPlanId}`,
          `planned by ${plan.plannedBy}`,
          // C61 — an operator-facing instant is a clock reading, never a raw
          // ISO string. Same defect the context rail's R6 f.10 fixed.
          `expires ${fmtClock(plan.expiresAt)}`,
        ]}
      />
    </section>
  );
}

/** Render only planned fields; absent role, containment and status facts must not be invented. */
function PlanRowCard({ row }: { row: StartPlanResponse["planned"][number] }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-[var(--ds-space-tight)] py-[var(--ds-space-snug)]">
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-base)]">
          <span className={cn(dsText.ui, "min-w-0 flex-1 truncate font-medium", dsFg.base)}>{row.title}</span>
        </div>
        {/* Wrap complete match keys; truncated subject identity cannot rely on pointer-only recovery. */}
        <MetaLine
          items={[
            row.subtitle,
            `match key ${row.matchKey}`,
          ]}
        />
      </CardBody>
    </Card>
  );
}

/** Keep the server’s refusal code and sentence verbatim so the operator can act on both. */
export function PlanRefusals({ refused }: { refused: StartPlanResponse["refused"] }) {
  if (refused.length === 0) return null;
  return (
    <ul className="flex flex-col gap-[var(--ds-space-snug)]">
      {refused.map((entry) => (
        <li key={`${String(entry.entry)}-${entry.code}`}>
          <Refusal
            title={`Entry ${String(entry.entry)} was not planned`}
            code={entry.code}
            outcome="nothing is enqueued for it"
          >
            {entry.message}
          </Refusal>
        </li>
      ))}
    </ul>
  );
}



/** Command acceptance does not prove queue insertion; only authoritative projection updates create rows. */
export function EnqueueResultBanner({
  result,
  onReload,
  onDismiss,
}: {
  result: Exclude<CommandResult, { state: "pending" }>;
  /** conflict only — the ONE cure for a plan built against a version that moved */
  onReload?: () => void;
  onDismiss?: () => void;
}) {
  // Close receipts and dismiss refusals; the exit wording preserves their different outcomes.
  const dismissWith = (word: string) =>
    onDismiss ? (
      <Button size="sm" variant="secondary" onClick={onDismiss}>
        {word}
      </Button>
    ) : undefined;

  if (result.state === "rejected") {
    return (
      <Refusal
        title="The start was refused"
        code={result.code}
        outcome="nothing is enqueued"
        action={dismissWith("Dismiss")}
      >
        {result.message}
      </Refusal>
    );
  }

  if (result.state === "conflict") {
    // Conflicts spend the plan token; reload the served basis before planning again.
    return (
      <Banner
        tone="warning"
        title="The start plan moved under this form"
        action={
          onReload ? (
            <Button size="sm" variant="primary" onClick={onReload}>
              Reload the form
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-[var(--ds-space-snug)]">
          <span>{result.message}</span>
          <KeyValueList
            items={[{ key: "server holds version", value: String(result.currentVersion), tone: "warning" }]}
          />
        </div>
      </Banner>
    );
  }

  if (result.state === "confirmation-required") {
    return <Banner tone="warning" title="Confirmation required" action={dismissWith("Close")}>{result.message}</Banner>;
  }

  return (
    <Banner
      tone="success"
      title={result.state === "applied" ? "Start applied" : "Already applied"}
      icon={<CheckCircle2 aria-hidden className={dsIcon.lg} />}
      action={dismissWith("Close")}
    >
      <div className="flex flex-col gap-[var(--ds-space-snug)]">
        <KeyValueList
          items={result.affectedTargets.map((target) => ({
            key: target.family,
            value: "runId" in target ? target.runId : target.family,
          }))}
        />
        <MetaLine items={[`command ${result.commandId}`]} />
      </div>
    </Banner>
  );
}



export interface StageSpec {
  key: string;
  label: string;
}

/** Re-enter completed stages to correct input; future stages cannot skip planning. */
export function StageRail({
  stages,
  current,
  reachable,
  onSelect,
}: {
  stages: readonly StageSpec[];
  current: string;
  reachable: ReadonlySet<string>;
  onSelect: (key: string) => void;
}) {
  const currentIndex = stages.findIndex((stage) => stage.key === current);
  return (
    <nav
      aria-label={`Start stages — step ${String(currentIndex + 1)} of ${String(stages.length)}`}
      className="flex flex-wrap items-center gap-[var(--ds-space-tight)]"
    >
      {stages.map((stage, index) => {
        const isCurrent = stage.key === current;
        const canGo = reachable.has(stage.key);
        const settled = canGo && index < currentIndex;
        return (
          <span key={stage.key} className="flex items-center gap-[var(--ds-space-tight)]">
            {index > 0 && (
              <span aria-hidden className={cn(dsText.meta, index <= currentIndex ? dsFg.muted : dsFg.faint)}>
                ›
              </span>
            )}
            <Button
              size="sm"
              variant={isCurrent ? "primary" : canGo ? "outline" : "ghost"}
              disabled={!canGo && !isCurrent}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelect(stage.key)}
            >
              {settled ? (
                <Check aria-hidden className={cn(dsIcon.sm, "text-[color:var(--ds-success-fg)]")} />
              ) : (
                <span className={cn(dsText.nums, isCurrent ? "opacity-80" : "opacity-60")}>{index + 1}</span>
              )}
              {stage.label}
            </Button>
          </span>
        );
      })}
    </nav>
  );
}



/** Use declared field controls and schema refusals; do not invent another validation vocabulary. */
export function StepOmissionFactsForm({
  step,
  form,
  draft,
  errors,
  onChange,
  onTouch,
  previous,
  compact = false,
}: {
  step: string;
  form: StepOmissionForm;
  draft: StepOmissionDraft;
  /** field key → the refusal to draw; a key absent from it draws its help line */
  errors: Readonly<Record<string, string>>;
  onChange: (fieldKey: string, next: StepOmissionFactDraft) => void;
  onTouch: (fieldKey: string) => void;
  previous?: Readonly<Record<string, { value: string; onUse: () => void }>>;
  compact?: boolean;
}) {
  if (form.fields.length === 0) {
    return (
      <p className={cn(dsText.meta, dsFg.muted)}>
        This step asks for nothing — omitting it leaves no fact for you to supply.
      </p>
    );
  }
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-[var(--ds-space-cozy)] @min-[480px]:grid-cols-2">
      {/* The legend NAMES the group, so a screen reader landing inside it
          knows which omitted step these boxes stand in for. */}
      <legend className={cn(dsText.meta, "font-medium", dsFg.secondary, compact && "sr-only")}>
        {`What this run reads instead of ${step}`}
      </legend>
      {form.fields.map((field) => {
        const value = draft[field.key];
        const error = errors[field.key] ?? null;
        const help = field.help;
        const saved = previous?.[field.key];
        const savedControl = saved && <div className="mt-[5px] flex items-center justify-between gap-2 text-caption text-ui-muted"><span>{compact ? "Previous" : "Saved"} <span className="tabular-nums">{saved.value}</span></span><Button size="sm" variant="ghost" className="h-auto p-0 text-caption text-ui-info" aria-label={`Copy ${step} · ${field.label}`} onClick={saved.onUse}>Use previous</Button></div>;
        if (field.kind === "boolean") {
          return (
            <div key={field.key}>
            <Checkbox
              checked={value === true}
              onCheckedChange={(next) => {
                onTouch(field.key);
                onChange(field.key, next === true);
              }}
              label={field.label}
              {...(help === undefined ? {} : { description: help })}
            />
            {savedControl}
            </div>
          );
        }
        const text = typeof value === "string" ? value : "";
        const commonField = {
          label: field.label,
          ...(help === undefined ? {} : { description: help }),
          error,
        };
        if (field.kind === "enum") {
          return (
            <Field key={field.key} {...commonField}>
              <Select
                value={text}
                onBlur={() => onTouch(field.key)}
                onChange={(event) => {
                  onTouch(field.key);
                  onChange(field.key, event.target.value);
                }}
              >
                {/* Do not preselect asserted facts; real-person answers require an explicit operator choice. */}
                <option value="">Choose a value…</option>
                {field.values.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
              {savedControl}
            </Field>
          );
        }
        if (field.kind === "text-list") {
          return (
            <Field key={field.key} {...commonField} hint="One per line">
              <Textarea
                rows={3}
                value={text}
                onBlur={() => onTouch(field.key)}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
              {savedControl}
            </Field>
          );
        }
        return (
          <Field key={field.key} {...commonField}>
            {field.kind === "us-date" ? <DateInput label={field.label} textEntry textDateFormat="MM/DD/YYYY" value={text} onChange={next => { onTouch(field.key); onChange(field.key, next); }} /> : <Input
              value={text}
              {...(field.kind === "eid" ? { placeholder: "12345678", inputMode: "numeric" as const } : {})}
              {...(field.kind === "integer" ? { inputMode: "numeric" as const } : {})}
              onBlur={() => onTouch(field.key)}
              onChange={(event) => onChange(field.key, event.target.value)}
            />}
            {savedControl}
          </Field>
        );
      })}
    </fieldset>
  );
}

export function TypedInput({
  surface,
  workflowId,
  text,
  onText,
  preview,
  inputRef,
  draft = {},
  onValue,
  presentation = "served",
}: {
  surface: InputRunSurface;
  workflowId: string;
  text: string;
  onText: (next: string) => void;
  preview: RunInputPreview;
  draft?: TypedInputDraft;
  onValue?: (field: string, value: string | boolean) => void;
  presentation?: "mock" | "served";
  /** the dialog's handle on the box, so an exit from a banner can focus it */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const declaration = surface.typedInput;
  const values = declaration === undefined ? draft : { ...typedInputDefaults(declaration), ...draft };
  const mode = declaration === undefined ? undefined : typedInputMode(declaration, values);
  const field = <Field label={mode?.inputLabel ?? inputRunFieldLabel(surface.parser)} description={mode?.hint ?? inputRunDelimiterHint(surface.parser)} error={presentation === "served" ? preview.problem : undefined}>
    <Textarea key={workflowId} ref={inputRef} autoFocus rows={4} value={text}
      placeholder={mode?.placeholder ?? (inputRunFieldLabel(surface.parser) === "Kuali ID" ? surface.placeholder.replaceAll("Kuali document numbers", "Kuali IDs") : surface.placeholder)}
      onChange={event => onText(event.target.value)} />
  </Field>;
  const controls = declaration && <>
    <SegmentedChoice label={declaration.modeLabel} value={mode?.value ?? declaration.initialMode}
      options={declaration.modes.map(candidate => ({ value: candidate.value, label: candidate.label }))}
      onChange={value => onValue?.(declaration.modeField, value)} />
    {declaration.controls.filter(control => control.placement === "input" && control.modes.includes(mode?.value ?? declaration.initialMode)).map(control =>
      <Checkbox key={control.field} label={control.label} checked={values[control.field] === true} onCheckedChange={value => onValue?.(control.field, value === true)} />)}
  </>;
  if (presentation === "mock") return <>{controls}{field}
    {preview.entries.length > 0 && <ul aria-label="Parsed inputs" className="launch-parsed-input m-0 flex list-none flex-col gap-1 p-0">{preview.entries.map(entry => <li key={entry.index} className="flex items-center gap-2 rounded-md border border-ui-stroke px-2 text-body"><span className="text-ui-muted">{entry.index + 1}</span><span className="truncate">{entry.sourceText}</span></li>)}</ul>}
  </>;
  return <>{controls}<div className="flex flex-col gap-[var(--ds-space-snug)]">{field}
    {preview.entries.length > 0 && <section aria-label="Parsed input" className="mt-3 flex flex-col gap-3">
      <div className="flex items-center justify-between"><h4 className="text-body font-semibold">Parsed input</h4><Badge tone="neutral">{preview.entries.length} {preview.entries.length === 1 ? "run" : "runs"}</Badge></div>
      <ul className="launch-parsed-input overflow-hidden rounded-md border border-ui-stroke divide-y divide-ui-stroke">{preview.entries.map(entry => <li key={entry.index} className="flex min-w-0 items-center gap-2 bg-ui-table px-[10px] py-2"><span className="text-body">{entry.index + 1}.</span><span className="min-w-0 flex-1 truncate font-mono text-caption">{entry.sourceText}</span><span className="text-caption text-ui-muted">1 run</span></li>)}</ul>
    </section>}
  </div></>;
}
