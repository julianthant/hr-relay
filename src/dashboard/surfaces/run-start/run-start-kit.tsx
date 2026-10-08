/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStartKit.tsx
 *
 * The pieces every run-START surface shares, retyped against what the rebuild
 * actually serves. The dialog answers two questions before the operator
 * commits:
 *
 *   1. **What will this create?** `PlanPreview` — the exact `planned[]` rows
 *      the START-PLAN service returned, and `PlanRefusals` — every `refused[]`
 *      entry as a `Refusal` carrying the served code verbatim.
 *   2. **What actually happened?** `EnqueueResultBanner` — `applied`,
 *      `already-applied`, `conflict` or `rejected`, never collapsed into
 *      "Done", and never turned into a queue row by this surface.
 *
 * The demo's fixture-derived plan vocabulary (per-row role/panel/containment/
 * `bornAs`, the plan's `warnings` and `decisions` prose, the host line under
 * each instance select, and the duplicate-check / CRM-check flags) has no 1i
 * wire counterpart and is omitted rather than invented — the start-plan wire
 * serves identities and refusals, so that is what renders.
 */
import { Check, CheckCircle2, FlaskConical } from "lucide-react";
import type { SurfaceField } from "../../../models/workflow/ingress.js";
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
import type { StepOmissionDraft, StepOmissionFactDraft } from "./run-start-model.js";
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
      {/* Only when it is NOT the default. A chip that is always there is a chip
          the eye stops reading — and it would say the same thing as the
          Priority control two rows below it. */}
      {priority === "bulk" && <Badge tone="neutral">bulk</Badge>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-selections — what the workflow's own input surface FIXES
// ---------------------------------------------------------------------------

/**
 * One sub-selection, rendered the same way for every workflow that declares
 * one. In 1i the only sub-selections a descriptor declares are its input
 * surface's parser CONSTANTS — fields the panel contributes to every entry at
 * a value the workflow fixes. Fixed values and their reasons remain readable
 * without presenting an editable control.
 *
 * The operator-variable arm (a served option list) has no 1i wire counterpart —
 * declaring one here would mean inventing a contract the server never sends —
 * so it lands with the descriptor start-capability projection, not before.
 */
export function StartChoiceControl({ constant, reason }: { constant: SurfaceField; reason: string }) {
  return <LockedFact label={constant.field} value={surfaceValueLabel(constant)} reason={reason} />;
}

/** Fixed workflow facts use plain read-only values rather than disabled controls. */
export function LockedFact({ label, value, reason }: { label: string; value: string; reason: string }) {
  return <div><span className={cn(dsText.meta, "font-medium", dsFg.secondary)}>{label}</span><p className={cn(dsText.body, "mt-[var(--ds-space-tight)]", dsFg.base)}>{value}</p><p className={cn(dsText.meta, "mt-[var(--ds-space-tight)]", dsFg.muted)}>{reason}</p></div>;
}

/**
 * A run flag. A `Checkbox`, deliberately, and not a `Switch`: nothing here
 * takes effect until the primary action is pressed, and the switch primitive's
 * own contract is that it applies immediately.
 */
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

// ---------------------------------------------------------------------------
// Plan preview — what this start WILL create
// ---------------------------------------------------------------------------

/**
 * The server's exact proposal. Every column is a served identity: nothing here
 * is derived, counted, or renamed, because the operator is about to authorise
 * precisely these runs.
 */
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

/**
 * One proposed run, as a card (C57, D272 item 8 — `ref dashboard-surfaces` §10).
 *
 * The demo's `PlanRowCard` anatomy with the fields this wire actually serves:
 * `StartPlanResponse.planned[]` carries `{logicalKey, title, subtitle,
 * matchKey}` and no role, panel, containment, born-as status or note, so those
 * are ABSENT rather than invented — their `builds:` line is ledger 1's first
 * region-C row. What replaces the demo's `panel` / `containment` chips is the
 * pair this wire does serve, in the same slot — on the card's provenance line
 * rather than in chips, for the reason spelled out at the line itself.
 */
function PlanRowCard({ row }: { row: StartPlanResponse["planned"][number] }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-[var(--ds-space-tight)] py-[var(--ds-space-snug)]">
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-base)]">
          <span className={cn(dsText.ui, "min-w-0 flex-1 truncate font-medium", dsFg.base)}>{row.title}</span>
        </div>
        {/* The match key is on the card's PROVENANCE LINE,
            not in chips (unit F5b finding 5). `Chip`'s own rule says so: it is
            a single-line token that truncates inside its own border and
            recovers the cut on `title` — "if a fact cannot survive truncation
            it is not a chip: put it on the row's `MetaLine`, on its own line,
            where it can wrap." A match key is exactly that
            kind of fact: half of `eid:E1234567` is a different subject, and a
            `title` is reachable by mouse and by nobody else, which is the
            defect C48/C81 fixed two components up in this same file. */}
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

/**
 * What was NOT planned, and why. A refusal is one of DESIGN.md's two exemptions
 * to the no-prose rule: it must say what was not done and why, or the operator
 * cannot act on it. The code and message are the server's, verbatim.
 */
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

// ---------------------------------------------------------------------------
// The result — applied | already-applied | conflict | rejected
// ---------------------------------------------------------------------------

/**
 * The command's answer, never collapsed. `applied` says the request was
 * accepted — not that a row exists: the queue changes when the authoritative
 * projection says so (ref frontend-backend-integration §0.5), and this surface never inserts one.
 */
export function EnqueueResultBanner({
  result,
  onReload,
  onDismiss,
}: {
  result: CommandResult;
  /** conflict only — the ONE cure for a plan built against a version that moved */
  onReload?: () => void;
  onDismiss?: () => void;
}) {
  // C72 (D272 item 9) — the demo says **Close** on a settled start and
  // **Dismiss** on a refusal (`DemoRunStartKit.tsx:341,379-383`). The two words
  // are not decoration: closing a receipt and dismissing a refusal are
  // different acts, and one word for both makes them read as the same one.
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
    // C69 (D272 item 8) — a conflict banner with no exit names a state the
    // operator cannot leave: D253 refuses a re-send of the same envelope
    // identically, so the plan token in this form is spent for good. Reloading
    // rebuilds the form's basis on the version the server actually serves and
    // sends the operator back to plan again, which is the demo's own cure
    // (`DemoRunStart.tsx:685-688`).
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

// ---------------------------------------------------------------------------
// Stage rail — the start's linear spine
// ---------------------------------------------------------------------------

export interface StageSpec {
  key: string;
  label: string;
}

/**
 * A linear stage rail. Completed stages are re-enterable (going back is how a
 * mistyped entry gets fixed); stages ahead of the current one are not — the
 * pipeline refuses to skip planning.
 *
 * A settled stage swaps its number for a check: in a pipeline where every stage
 * is a place a silent substitution could enter, "how much of this is answered"
 * is the thing the operator is tracking. The rail is a `<nav>` of buttons, so
 * the whole pipeline is one tab-stop group and the current stage carries
 * `aria-current="step"`.
 */
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

// ---------------------------------------------------------------------------
// D307 — the facts an omitted step's form asks for
// ---------------------------------------------------------------------------

/**
 * ONE omitted step's form, drawn from the step's own declared field
 * vocabulary.
 *
 * Every kind gets the control its kind means and nothing more: there is no
 * free-text date box that a `us-date` refusal would then have to explain, and
 * no enum typed by hand. The refusal that DOES reach a control is the declared
 * schema's own — `Field`'s error slot replaces the help line, so the operator
 * never has to choose which of two sentences to believe.
 *
 * The form is a `fieldset` named by its step: a screen reader reaching these
 * controls hears which omitted step it is filling in, and every control is an
 * ordinary tab stop inside it.
 */
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
                {/* An empty first option, and never a pre-selected one: a
                    status this run would assert about a real person is the
                    operator's answer or it is missing. */}
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
