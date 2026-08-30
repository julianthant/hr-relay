/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStartKit.tsx
 *
 * The pieces every run-START surface shares, retyped against what the rebuild
 * actually serves. The demo answered three questions before the operator
 * commits, and so does this:
 *
 *   1. **Where will this write?** `InstanceSelector` — per system, from the
 *      bootstrap's served `SystemInstance` availability. A test instance the
 *      server declares unavailable is offered DISABLED with the server's own
 *      reason; hiding it would teach the operator the product has never heard
 *      of it (DESIGN.md).
 *   2. **What will this create?** `PlanPreview` — the exact `planned[]` rows
 *      the START-PLAN service returned, and `PlanRefusals` — every `refused[]`
 *      entry as a `Refusal` carrying the served code verbatim.
 *   3. **What actually happened?** `EnqueueResultBanner` — `applied`,
 *      `already-applied`, `conflict` or `rejected`, never collapsed into
 *      "Done", and never turned into a queue row by this surface.
 *
 * The demo's fixture-derived plan vocabulary (per-row role/panel/containment/
 * `bornAs`, the plan's `warnings` and `decisions` prose, the host line under
 * each instance select, and the duplicate-check / CRM-check flags) has no 1i
 * wire counterpart and is omitted rather than invented — the start-plan wire
 * serves identities and refusals, so that is what renders.
 */
import { Check, CheckCircle2, FlaskConical, TriangleAlert } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  Checkbox,
  Field,
  KeyValueList,
  LockedValue,
  MetaLine,
  Refusal,
  Select,
  Well,
  dsFg,
  dsIcon,
  dsText,
} from "../ds/ui.js";
import { fmtClock } from "./format.js";
import type { CommandResult } from "../../domain/commands.js";
import type { SurfaceField } from "../../domain/workflow/ingress.js";
import type { StartPlanResponse } from "../client/index.js";
import { SYSTEM_LABEL, type BrowserSystemId } from "./system-chip-model.js";
import {
  testSystemsOf,
  surfaceValueLabel,
  type InstanceChoice,
  type SystemInstance,
  type SystemInstancePrimitive,
} from "./run-start-kit-model.js";

export type { InstanceChoice, SystemInstance, SystemInstancePrimitive };

/* the instance choice, and the systems it sends to a TEST instance lives in `run-start-kit-model.ts` — see the note there */

// ---------------------------------------------------------------------------
// Instance selector — production vs test, per system
// ---------------------------------------------------------------------------

/**
 * Which machine this run is about to touch, at the moment the choice is made.
 * `prod` is always available by contract; `test` is a served
 * `CapabilityAvailability`, so an unwired test instance keeps its option and
 * states the server's reason instead of vanishing.
 */
export function InstanceSelector({
  systems,
  value,
  onChange,
}: {
  systems: readonly SystemInstancePrimitive[];
  value: InstanceChoice;
  onChange: (next: InstanceChoice) => void;
}) {
  const test = testSystemsOf(systems, value);
  if (systems.length === 0) {
    /*
      The zero-system Well is a rebuild-only arm and STAYS (D272 item 9,
      ledger 1 row C94 — "keep honest empty states"). The demo's fixtures
      always declare at least one system, so it has no counterpart to be exact
      against; here the set is served and CAN be empty, and a chooser that
      renders nothing at all is indistinguishable from one that failed to load.
      The sentence states the declaration, never a guess about the workflow.
    */
    return (
      <Well>
        <span className={dsFg.muted}>This start declares no browser system.</span>
      </Well>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--ds-space-base)]">
      <div className="grid grid-cols-1 gap-[var(--ds-space-base)] min-[420px]:grid-cols-2">
        {systems.map((entry) => {
          const hasTest = entry.test.state === "available";
          const instance: SystemInstance = hasTest ? (value[entry.system] ?? "prod") : "prod";
          return (
            <Field
              key={entry.system}
              label={SYSTEM_LABEL[entry.system]}
              description={
                hasTest ? undefined : (
                  <span className={dsFg.faint}>
                    {entry.test.state === "unavailable" ? entry.test.reason : "no test instance"}
                  </span>
                )
              }
              disabled={!hasTest}
            >
              <Select
                value={instance}
                onChange={(event) => {
                  onChange({ ...value, [entry.system]: event.target.value === "test" ? "test" : "prod" });
                }}
                disabled={!hasTest}
              >
                <option value="prod">Production</option>
                <option value="test" disabled={!hasTest}>
                  {hasTest ? "Test instance" : "Test instance — not wired"}
                </option>
              </Select>
            </Field>
          );
        })}
      </div>
      {test.length > 0 && (
        <Banner tone="info" title={`Targeting the TEST instance of ${test.map((system) => SYSTEM_LABEL[system]).join(", ")}`}>
          Every row this start creates carries a <strong>test</strong> badge for its whole life, and its ledger entries are
          filed under the test instance. Nothing reaches production {systems.length > test.length ? "on those systems" : ""}.
        </Banner>
      )}
    </div>
  );
}

/** the badge a started row will carry — shown in the preview, then on the row */
export function RunFlagChips({
  dryRun,
  test,
  priority,
}: {
  dryRun: boolean;
  test: readonly BrowserSystemId[];
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
      {test.length > 0 && (
        <Badge tone="warning">
          <TriangleAlert aria-hidden className={dsIcon.sm} />
          test · {test.map((system) => SYSTEM_LABEL[system]).join(", ")}
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
 * a value the workflow fixes. DESIGN.md's rule for exactly this case: a choice
 * the target fixes is a `LockedValue` with its reason, never a one-option
 * select, so "you may not change this" is legible without clicking it.
 *
 * The operator-variable arm (a served option list) has no 1i wire counterpart —
 * declaring one here would mean inventing a contract the server never sends —
 * so it lands with the descriptor start-capability projection, not before.
 */
export function StartChoiceControl({ constant, reason }: { constant: SurfaceField; reason: string }) {
  return <LockedFact label={constant.field} value={surfaceValueLabel(constant)} reason={reason} />;
}

/**
 * A value the operator may not change, with the reason ON SCREEN (C48/C81,
 * D272 item 9 — `ref dashboard-surfaces` §10).
 *
 * `LockedValue` puts its `reason` on `title`, and a tooltip is unavailable to
 * touch and to the keyboard — DESIGN.md bans a fact that is reachable by mouse
 * alone, and the 1440x900 parity reference showed both of this modal's locked
 * values with their reason nowhere on the page. The demo draws the same `<p>`
 * beneath (`DemoRunStartKit.tsx:175-183`).
 *
 * It is ONE component because there were two of these and they were already
 * drifting: the sub-selection had the label span and the active-run policy had
 * a hand-rolled copy of it. Two near-identical renderings are two things that
 * happen to agree today (`src/dashboard/CLAUDE.md`, 2026-08-26).
 */
export function LockedFact({
  label,
  value,
  reason,
}: {
  label: string;
  value: string;
  reason: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
      <span className={cn(dsText.meta, "font-medium", dsFg.secondary)}>{label}</span>
      {/* `reason` is deliberately NOT handed to `LockedValue` (unit F5b finding
          4). It puts what it is given on `title`, and `title` is not a second
          rendering of the same fact — it joins the accessible description, so a
          screen reader reads the sentence once from the tooltip and again from
          the `<p>` below. The `<p>` is the whole point of this component; the
          tooltip is the thing it replaced. */}
      <LockedValue value={value} />
      <p className={cn(dsText.meta, dsFg.muted)}>{reason}</p>
    </div>
  );
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
  test,
  className,
}: {
  plan: StartPlanResponse;
  test: readonly BrowserSystemId[];
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-[var(--ds-space-base)]", className)}>
      <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        <span className={cn(dsText.ui, "font-semibold", dsFg.base)}>
          {plan.planned.length === 1 ? "1 run" : `${String(plan.planned.length)} runs`}
        </span>
        <RunFlagChips dryRun={plan.dryRun} test={test} priority={plan.priority} />
      </div>

      {plan.planned.length === 0 ? (
        <Well>
          <span className={dsFg.muted}>Nothing to create — every entry was refused.</span>
        </Well>
      ) : (
        <ul aria-label="Runs this start will create" className="flex flex-col gap-[var(--ds-space-snug)]">
          {plan.planned.map((row) => (
            <li key={row.runId}>
              <PlanRowCard row={row} />
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
 * `StartPlanResponse.planned[]` carries `{runId, traceId, title, subtitle,
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
        {/* The match key and the trace id are on the card's PROVENANCE LINE,
            not in chips (unit F5b finding 5). `Chip`'s own rule says so: it is
            a single-line token that truncates inside its own border and
            recovers the cut on `title` — "if a fact cannot survive truncation
            it is not a chip: put it on the row's `MetaLine`, on its own line,
            where it can wrap." A match key and a trace id are exactly that
            kind of fact: half of `eid:E1234567` is a different subject, and a
            `title` is reachable by mouse and by nobody else, which is the
            defect C48/C81 fixed two components up in this same file. */}
        <MetaLine
          items={[
            row.subtitle,
            `match key ${row.matchKey}`,
            `trace ${row.traceId}`,
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
