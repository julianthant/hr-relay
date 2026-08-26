/**
 * The spreadsheet intake workspace — ref data-intake-and-edit-data §2.2's upload → map → validate →
 * run, and ref dashboard-surfaces §11's surface contract (2i-E3, D173).
 *
 * ## One axis carries the whole design: PROPOSED against DECIDED
 *
 * The single thing this surface must make impossible is mistaking the
 * machine's guess for the operator's decision — §2.5 is explicit that a
 * confident-but-wrong header match ("Name" → `fullName` when the real name is
 * in "Legal Name") is the silent substitution this program bans. So the
 * distinction gets the whole visual budget rather than a colour: a **decided**
 * binding is a solid control in the row's own column, and a **suggestion** is
 * recessed, dashed, in a DIFFERENT column, and always carries an explicit verb
 * to accept it. The two can never be confused because they are never in the
 * same place — and mechanically, only `confirm-intake-mapping` mints a binding,
 * which is reachable from nothing but a click.
 *
 * ## It is a workspace, not a dialog
 *
 * The session is DURABLE (`intake_sessions`, D170): it survives reload, and
 * mapping a dozen columns then reviewing four hundred rejections takes minutes
 * during which the operator will want to look at the queue. A modal would trap
 * that, and trapping a task whose whole state is already safe on the server is
 * the definition of a modal used out of laziness. So the workspace lives at
 * `?intake=<sessionId>`, addressable and abandonable at any moment.
 *
 * ## Three bands, and the outcome band never scrolls away
 *
 * Source (what we are reading) → Decision (mapping | review) → Outcome (what
 * would happen, and what blocks it). The outcome band is sticky because the
 * operator scrolling a long grid must always be able to read WHY Run is
 * disabled; a disabled button with its explanation off-screen is how a person
 * concludes the product is broken.
 *
 * ## Every refusal is the server's own sentence
 *
 * The kernel's rejections name exactly what is wrong — a stale layout
 * fingerprint, an unreviewed plan, a session that moved under the reviewed
 * version. None of them is re-worded here, and none is swallowed: a command
 * that fails puts its message on screen with `role="alert"` and changes
 * nothing else, because the wire is the truth and the next read re-derives it.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  GitCompare,
  Info,
  ListChecks,
  RotateCcw,
  Table2,
} from "lucide-react";
import type { z } from "zod";
import { systemClock } from "../../domain/clock.js";
import type { CommandResult } from "../../domain/commands.js";
import { settleCommandResult } from "../app/command-result.js";
import type {
  DetectedColumnSchema,
  ColumnBindingSchema,
} from "../../domain/intake/mapping.js";
import type { RowRejectSchema } from "../../domain/intake/manifest.js";
import type { IntakeTargetSchema } from "../../domain/intake/projection.js";
import type { SuggestionSchema } from "../../domain/intake/suggestions.js";
import type { IntakeSessionWire } from "../../domain/intake/wire.js";
import { DashboardClientError, type IntakeUploadResult } from "../client/index.js";
import {
  Badge,
  Banner,
  Button,
  Chip,
  CountBadge,
  Dropzone,
  EmptyState,
  Field,
  IconButton,
  Input,
  KeyValueList,
  MetaLine,
  Panel,
  PanelBody,
  PanelHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Refusal,
  SectionLabel,
  Select,
  Separator,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Table,
  Tabs,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Well,
  dsIcon,
  dsMotion,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useDashboardClient } from "../state/client-context.js";
import { CaptureStart } from "./capture-start.js";
import { fmtClock, pluralize, shortHash } from "./format.js";
import {
  correctionText,
  headerCandidateOptionLabel,
  intakeTab,
  type IntakeTab,
  layoutFingerprint,
  layoutMetaItems,
  manifestIdentifierFacts,
  manifestStage,
  type RerunMembershipRow,
  rerunStage,
  sourceLabel,
  suggestionProposalText,
} from "./intake-model.js";

type DetectedColumn = z.infer<typeof DetectedColumnSchema>;
type ColumnBinding = z.infer<typeof ColumnBindingSchema>;
type IntakeTarget = z.infer<typeof IntakeTargetSchema>;
type Suggestion = z.infer<typeof SuggestionSchema>;
type RowReject = z.infer<typeof RowRejectSchema>;

const SOURCE_SURFACE = "intake-workspace";

/**
 * What the file picker offers. It is a HINT — a dragged file that does not
 * match still reaches the server, which refuses it by media type and magic
 * bytes. Filtering here instead would make an unreadable file simply vanish.
 */
const INTAKE_ACCEPT = ".csv,.xlsx,.xls";

/** Ref data-intake-and-edit-data's own words for each rejection code, in the operator's terms. */
const REJECT_CODE_LABEL: Record<RowReject["code"], string> = {
  "unmapped-required": "unmapped field",
  "cell-coercion": "cell could not be read",
  "field-schema": "value out of shape",
  "workflow-schema": "row rejected by the workflow",
  "duplicate-identity": "duplicate person",
  "cross-field": "fields disagree",
};

/* ── command plumbing ─────────────────────────────────────────────────────── */

/** The five mapping arms plus the enqueue, as the workspace issues them. */
type IntakeCommand =
  | { readonly type: "inspect-intake"; readonly payload: { sheet?: string; headerRowIndex?: number } }
  | {
    readonly type: "confirm-intake-mapping";
    readonly payload: { targetFieldId: string; sourceColumnId: string; headerFingerprint: string };
  }
  | {
    readonly type: "correct-intake-row";
    readonly payload: { sourceRow: number; field: string; correctedValue: string };
  }
  | { readonly type: "exclude-intake-row"; readonly payload: { sourceRow: number; reason: string } }
  | { readonly type: "validate-intake" }
  | { readonly type: "enqueue-intake-manifest"; readonly payload: { dryRun: boolean } };

/**
 * A command outcome the surface renders rather than throws.
 *
 * `conflict` and `rejected` are ANSWERS — the operator acts on them — so they
 * are values here exactly as they are on the wire. A transport or schema
 * failure is different in kind and keeps its own arm, so "the server said no"
 * never reads the same as "the server could not be reached".
 */
type CommandProblem =
  | { readonly kind: "rejected"; readonly code: string; readonly message: string }
  | { readonly kind: "conflict"; readonly currentVersion: number; readonly message: string }
  | { readonly kind: "transport"; readonly message: string };

/**
 * D253 / Track D row D3 — WHETHER the command landed is the fold's answer, not
 * this surface's. What stays here is the PRESENTATION vocabulary: this
 * workspace draws a rejection as a `Refusal` with a code chip and a conflict as
 * a warning `Banner` whose meta line carries the version, so the two refusals
 * keep their own facts and a transport failure keeps its own arm beside them.
 */
function problemOf(result: CommandResult): CommandProblem | undefined {
  const settlement = settleCommandResult(result);
  if (settlement.kind === "applied") return undefined;
  return settlement.reason === "rejected"
    ? { kind: "rejected", code: settlement.code, message: settlement.message }
    : { kind: "conflict", currentVersion: settlement.currentVersion, message: settlement.message };
}

/**
 * Wraps something that has just MOUNTED so it arrives rather than blinks.
 *
 * It is a WRAPPER rather than props spread onto `Banner`, because `Banner`
 * declares its props explicitly and forwards nothing else — spreading
 * `data-demo-enter` onto it type-checks (a spread skips excess-property
 * checking) and is then dropped at runtime, which is a transition that
 * silently never runs. The extra element is the price of the attribute
 * actually reaching the DOM.
 *
 * Travel and clock are both tokens, so `prefers-reduced-motion` zeroes this
 * with no branch here.
 */
function Arriving({ children }: { children: ReactNode }) {
  const entering = useDsEnterTransition();
  return (
    <div
      {...entering}
      className={cn(
        dsMotion.enter,
        "data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))] data-[demo-enter=from]:opacity-0",
      )}
    >
      {children}
    </div>
  );
}

function ProblemNotice({ problem, onDismiss }: { problem: CommandProblem; onDismiss: () => void }) {
  const action = (
    <Button size="sm" variant="ghost" onClick={onDismiss}>
      Dismiss
    </Button>
  );
  if (problem.kind === "rejected") {
    return (
      <Arriving>
        <Refusal title="The server refused that" code={problem.code} outcome="nothing changed" action={action}>
          {problem.message}
        </Refusal>
      </Arriving>
    );
  }
  if (problem.kind === "conflict") {
    return (
      <Arriving>
        <Refusal
          title="This session moved while you were reading it"
          code="version-conflict"
          outcome="nothing was enqueued"
          meta={[`now at version ${String(problem.currentVersion)}`]}
          action={action}
        >
          {problem.message}
        </Refusal>
      </Arriving>
    );
  }
  return (
    <Arriving>
      <Banner tone="danger" title="The command did not reach the server" action={action}>
        {problem.message}
      </Banner>
    </Arriving>
  );
}

/* ── source band ──────────────────────────────────────────────────────────── */

/**
 * What we are reading, and the two choices that change it.
 *
 * Both choices are DESTRUCTIVE in a specific, nameable way — the kernel drops
 * every binding, correction and exclusion when the sheet or header row moves,
 * because they all named rows and columns under the old layout — so this
 * confirms first and says exactly how many of each will go. Discovering that
 * afterwards would be the definition of a surprise.
 */
function SourceBand({
  session,
  busy,
  onInspect,
}: {
  session: IntakeSessionWire;
  busy: boolean;
  onInspect: (selection: { sheet?: string; headerRowIndex?: number }) => void;
}) {
  const [confirming, setConfirming] = useState<{ sheet?: string; headerRowIndex?: number } | null>(null);
  const discards = session.bindings.length + session.corrections.length + session.exclusions.length;

  const request = (selection: { sheet?: string; headerRowIndex?: number }): void => {
    if (discards === 0) {
      onInspect(selection);
      return;
    }
    setConfirming(selection);
  };

  const settled = session.headerRowIndex;

  return (
    <section aria-label="Source file" className="flex flex-col gap-[var(--ds-space-base)]">
      <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        <FileSpreadsheet aria-hidden className={cn(dsIcon.lg, "text-[color:var(--ds-fg-muted)]")} />
        <span className="flex min-w-0 flex-col">
          <span className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>
            {sourceLabel(session)}
          </span>
          <MetaLine
            items={[
              `sha256 ${session.artifact.sha256.slice(0, 12)}…`,
              `${String(session.rowCount)} data rows`,
              `${String(session.columns.length)} columns`,
              `uploaded ${fmtClock(session.createdAt)}`,
            ]}
          />
        </span>
        <span className="flex-1" />
        <Badge tone={session.state === "enqueued" ? "success" : "neutral"}>{session.state}</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-[var(--ds-space-base)]">
        {session.sheets.length > 1 && (
          <Field label="Sheet" className="min-w-[var(--ds-w-session-card)]">
            <Select
              value={session.sheet}
              disabled={busy || session.state === "enqueued"}
              onChange={(event) => request({ sheet: event.currentTarget.value })}
            >
              {session.sheets.map((sheet) => (
                <option key={sheet} value={sheet}>
                  {sheet}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label="Header row"
          description={headerReasonSentence(session.headerDiscoveryReason, settled)}
          className="min-w-[var(--ds-w-side-panel)]"
        >
          <Select
            value={settled === null ? "" : String(settled)}
            disabled={busy || session.state === "enqueued"}
            onChange={(event) => request({ headerRowIndex: Number(event.currentTarget.value) })}
          >
            {settled === null && <option value="">Pick the row that holds the headers</option>}
            {session.headerCandidates.map((candidate) => (
              <option key={candidate.rowIndex} value={String(candidate.rowIndex)}>
                {headerCandidateOptionLabel(candidate)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {confirming !== null && (
        <Arriving>
        <Banner
          tone="warning"
          title="Changing the layout discards the decisions made under the old one"
          action={
            <span className="flex gap-[var(--ds-space-tight)]">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Keep this layout
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const selection = confirming;
                  setConfirming(null);
                  onInspect(selection);
                }}
              >
                Change it anyway
              </Button>
            </span>
          }
        >
          {`${String(session.bindings.length)} bound ${pluralize(session.bindings.length, "column")}, `
            + `${String(session.corrections.length)} ${pluralize(session.corrections.length, "correction")} and `
            + `${String(session.exclusions.length)} ${pluralize(session.exclusions.length, "exclusion")} `
            + "name rows and columns under the current header row, so re-reading the file drops them."}
        </Banner>
        </Arriving>
      )}
    </section>
  );
}

/** Why the header row is what it is — the discovery reason, in words. */
function headerReasonSentence(reason: IntakeSessionWire["headerDiscoveryReason"], settled: number | null): string {
  if (settled === null) {
    if (reason === "no-rows") return "This sheet has no non-empty row to read headers from.";
    if (reason === "ambiguous-candidates") {
      return "Two rows rank the same, so nothing was chosen for you — pick the header row.";
    }
    return "No row was confidently a header, so nothing was chosen for you — pick one.";
  }
  return reason === "preselected"
    ? "Chosen by ranking, and changeable — every column below is read relative to it."
    : "You chose this row; every column below is read relative to it.";
}

/* ── mapping grid ─────────────────────────────────────────────────────────── */

function columnLabel(column: DetectedColumn): string {
  const header = column.header.trim().length === 0 ? "(blank header)" : column.header;
  return column.occurrence === 1 ? header : `${header} (${String(column.occurrence)})`;
}

/**
 * One row per DECLARED TARGET FIELD, never one per source column.
 *
 * The workflow's fields are the fixed axis and the file is the variable, which
 * is ref data-intake-and-edit-data §2.2 step 2 in as many words. Turning it around would make the
 * grid's shape depend on the spreadsheet, and an operator could finish it
 * without ever seeing a field the workflow wanted.
 */
function MappingGrid({
  session,
  busy,
  pending,
  onConfirm,
}: {
  session: IntakeSessionWire;
  busy: boolean;
  /** the in-flight command key, so the pressed control alone shows a spinner */
  pending: string | null;
  onConfirm: (targetFieldId: string, sourceColumnId: string) => void;
}) {
  const bindingOf = useMemo(
    () => new Map<string, ColumnBinding>(session.bindings.map((binding) => [binding.targetFieldId, binding])),
    [session.bindings],
  );
  const columnOf = useMemo(
    () => new Map<string, DetectedColumn>(session.columns.map((column) => [column.sourceColumnId, column])),
    [session.columns],
  );
  const suggestionsFor = useMemo(() => {
    const grouped = new Map<string, Suggestion[]>();
    for (const suggestion of session.suggestions) {
      grouped.set(suggestion.targetFieldId, [...(grouped.get(suggestion.targetFieldId) ?? []), suggestion]);
    }
    return grouped;
  }, [session.suggestions]);

  if (session.headerFingerprint === null) {
    return (
      <EmptyState
        icon={<Table2 aria-hidden className={dsIcon.lg} />}
        title="No header row is settled yet"
        description="Columns are read relative to the header row, so nothing can be mapped until one is chosen above."
      />
    );
  }

  const locked = busy || session.state === "enqueued";

  return (
    <div className="overflow-x-auto">
      <Table label={`Map ${session.workflow} fields to columns of ${session.sourceName ?? "this file"}`}>
        <THead>
          <TR>
            <TH>Workflow field</TH>
            <TH>Bound column</TH>
            <TH>Suggested</TH>
          </TR>
        </THead>
        <TBody>
          {session.targets.map((target) => {
            const binding = bindingOf.get(target.targetFieldId);
            const bound = binding === undefined ? undefined : columnOf.get(binding.sourceColumnId);
            const proposals = (suggestionsFor.get(target.targetFieldId) ?? [])
              .filter((suggestion) => suggestion.sourceColumnId !== binding?.sourceColumnId);
            return (
              <TR key={target.targetFieldId}>
                <TD className="align-top">
                  <TargetCell target={target} />
                </TD>
                <TD className="align-top">
                  <BoundColumnCell
                    target={target}
                    bound={bound}
                    columns={session.columns}
                    locked={locked}
                    onPick={(sourceColumnId) => onConfirm(target.targetFieldId, sourceColumnId)}
                  />
                </TD>
                <TD className="align-top">
                  <SuggestionCell
                    proposals={proposals}
                    columnOf={columnOf}
                    locked={locked}
                    accepting={pending === `bind:${target.targetFieldId}`}
                    onAccept={(sourceColumnId) => onConfirm(target.targetFieldId, sourceColumnId)}
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

function TargetCell({ target }: { target: IntakeTarget }) {
  return (
    <span className="flex flex-col gap-[var(--ds-space-hair)]">
      <span className="flex items-baseline gap-[var(--ds-space-snug)]">
        <span className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>{target.label}</span>
        {target.required && <Badge tone="warning">required</Badge>}
      </span>
      <MetaLine items={[target.targetFieldId, `canonical ${target.canonicalFieldId}`]} />
    </span>
  );
}

/**
 * The DECIDED half. A bound column is a solid control holding a real value and
 * showing the file's own sample cells beneath it, so the operator confirms what
 * a column HOLDS rather than what it is called — which is the only defence
 * against a correctly-named column full of the wrong data.
 */
function BoundColumnCell({
  target,
  bound,
  columns,
  locked,
  onPick,
}: {
  target: IntakeTarget;
  bound: DetectedColumn | undefined;
  columns: readonly DetectedColumn[];
  locked: boolean;
  onPick: (sourceColumnId: string) => void;
}) {
  return (
    <span className="flex min-w-[var(--ds-w-member-detail)] flex-col gap-[var(--ds-space-tight)]">
      <Select
        aria-label={`Column bound to ${target.label}`}
        value={bound?.sourceColumnId ?? ""}
        disabled={locked}
        onChange={(event) => {
          const next = event.currentTarget.value;
          // The empty option is the resting state of an UNBOUND field, not an
          // "unbind" action: there is no arm that removes a binding, so
          // offering one that silently did nothing would be a lie.
          if (next.length === 0) return;
          onPick(next);
        }}
      >
        <option value="">— not bound —</option>
        {columns.map((column) => (
          <option key={column.sourceColumnId} value={column.sourceColumnId}>
            {columnLabel(column)}
          </option>
        ))}
      </Select>
      {bound !== undefined && bound.samples.length > 0 && (
        <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
          {bound.samples.slice(0, 3).join(" · ")}
        </span>
      )}
    </span>
  );
}

/**
 * The PROPOSED half — recessed, dashed, and in its own column.
 *
 * §2.5: a suggestion is a hint the operator confirms, never a pre-applied
 * binding, and the grid must not even pre-HIGHLIGHT an ambiguous one. So an
 * ambiguous proposal is drawn with its ambiguity stated and no visual
 * preference; picking one of two indistinguishable columns for the operator is
 * the silent guess in miniature.
 */
function SuggestionCell({
  proposals,
  columnOf,
  locked,
  accepting,
  onAccept,
}: {
  proposals: readonly Suggestion[];
  columnOf: ReadonlyMap<string, DetectedColumn>;
  locked: boolean;
  /** true while THIS target's binding is in flight — the press is answered */
  accepting: boolean;
  onAccept: (sourceColumnId: string) => void;
}) {
  if (proposals.length === 0) {
    return <span className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>no proposal</span>;
  }
  return (
    <span className="flex flex-col gap-[var(--ds-space-tight)]">
      {proposals.map((proposal) => {
        const column = columnOf.get(proposal.sourceColumnId);
        return (
          <span
            key={proposal.sourceColumnId}
            className={cn(
              "flex flex-col gap-[var(--ds-space-hair)] rounded-[var(--ds-radius-md)]",
              "border border-dashed border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)]",
              "px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
            )}
          >
            <span className="flex items-center gap-[var(--ds-space-snug)]">
              <span className={cn(dsText.body, "min-w-0 flex-1 truncate text-[color:var(--ds-recess-fg)]")}>
                {column === undefined ? proposal.sourceColumnId : columnLabel(column)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={locked}
                loading={accepting}
                onClick={() => onAccept(proposal.sourceColumnId)}
                aria-label={`Bind ${column === undefined ? proposal.sourceColumnId : columnLabel(column)}`}
              >
                Use it
              </Button>
            </span>
            <MetaLine
              items={[
                suggestionProposalText(proposal),
                proposal.ambiguous ? "another column scores the same — check both" : undefined,
              ]}
            />
          </span>
        );
      })}
    </span>
  );
}

/* ── validation review ────────────────────────────────────────────────────── */

/**
 * The pre-run rejection review (ref data-intake-and-edit-data §5).
 *
 * Rows are grouped by SOURCE ROW rather than listed per rejection, because a
 * row with three bad cells is one person the operator decides about once. Each
 * group offers the two arms that resolve it — correct a cell, or exclude the
 * row with a reason — and nothing else: there is deliberately no "ignore".
 */
function ValidationReview({
  session,
  busy,
  pending,
  onCorrect,
  onExclude,
}: {
  session: IntakeSessionWire;
  busy: boolean;
  pending: string | null;
  onCorrect: (sourceRow: number, field: string, correctedValue: string) => void;
  onExclude: (sourceRow: number, reason: string) => void;
}) {
  if (session.validation.state === "none") {
    return (
      <EmptyState
        icon={<ListChecks aria-hidden className={dsIcon.lg} />}
        title="This mapping has not been validated"
        description={
          session.bindings.length === 0
            ? "Bind at least one column, then validate to see which rows this file can actually run."
            : "Every mapping change clears the previous result, so the review below always describes the current mapping. Validate to rebuild it."
        }
      />
    );
  }

  const validation = session.validation;
  const byRow = new Map<number, RowReject[]>();
  for (const reject of validation.rejected) {
    byRow.set(reject.sourceRow, [...(byRow.get(reject.sourceRow) ?? []), reject]);
  }
  const rows = [...byRow.entries()].sort((left, right) => left[0] - right[0]);
  const locked = busy || session.state === "enqueued";
  // A correction names a TARGET FIELD, so the control is labelled with the
  // field's own operator-facing label rather than its path — `emplId` is the
  // wire's word for it, "Employee ID (EID)" is the operator's.
  const labelOf = (targetFieldId: string): string =>
    session.targets.find((target) => target.targetFieldId === targetFieldId)?.label ?? targetFieldId;

  return (
    <div className="flex flex-col gap-[var(--ds-space-loose)]">
      <MetaLine
        items={[
          `validated ${fmtClock(validation.validatedAt)}`,
          `values read as of ${fmtClock(validation.readAt)}`,
        ]}
      />

      {rows.length === 0 && validation.excluded.length === 0 && session.corrections.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 aria-hidden className={dsIcon.lg} />}
          title={`All ${String(validation.validRows)} rows are runnable`}
          description="Nothing was rejected and nothing was excluded, so every row in this file would fan out."
        />
      ) : (
        <>
          {rows.length > 0 && (
            <>
              <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                Every rejected row is fixed or excluded before this file can run — there is
                deliberately no way to ignore one. An exclusion is durable and keeps the reason it
                was made with.
              </span>
              {rows.map(([sourceRow, rejects]) => (
                <RejectedRow
                  key={sourceRow}
                  sourceRow={sourceRow}
                  rejects={rejects}
                  locked={locked}
                  pending={pending}
                  labelOf={labelOf}
                  onCorrect={onCorrect}
                  onExclude={onExclude}
                />
              ))}
            </>
          )}

          {/*
            * IN121 / `DemoIntake.tsx:917-922` — what the operator has already
            * fixed, listed rather than counted.
            *
            * A correction MOVES a row out of the rejection list, so the
            * previous shape hid its own successes: correct the last bad cell
            * and every trace of the work vanished behind "all rows are
            * runnable", while the manifest still recorded each one. It sits
            * where the demo puts it — after the rejections, before the
            * exclusions — and it is drawn as the exclusions' twin, because
            * the two are the same kind of thing: a durable, dated decision
            * this operator made about one source row.
            */}
          {session.corrections.length > 0 && (
            <section aria-label="Corrected cells" className="flex flex-col gap-[var(--ds-space-tight)]">
              <SectionLabel>Corrections</SectionLabel>
              {session.corrections.map((correction) => (
                <span
                  key={`${String(correction.sourceRow)}:${correction.field}`}
                  className="flex flex-wrap items-baseline gap-[var(--ds-space-snug)]"
                >
                  <Chip label="row">{String(correction.sourceRow)}</Chip>
                  <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg-secondary)]")}>
                    {correctionText(correction, labelOf(correction.field))}
                  </span>
                  <MetaLine items={[fmtClock(correction.correctedAt)]} />
                </span>
              ))}
            </section>
          )}

          {validation.excluded.length > 0 && (
            <section aria-label="Excluded rows" className="flex flex-col gap-[var(--ds-space-tight)]">
              <SectionLabel>Excluded by you</SectionLabel>
              {session.exclusions.map((exclusion) => (
                <span key={exclusion.sourceRow} className="flex flex-wrap items-baseline gap-[var(--ds-space-snug)]">
                  <Chip label="row">{String(exclusion.sourceRow)}</Chip>
                  <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{exclusion.reason}</span>
                  <MetaLine items={[fmtClock(exclusion.excludedAt)]} />
                </span>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The offending value, exactly as the durable manifest would keep it.
 *
 * It is REDACTED by the canonical field's own declared transform, so an EID
 * reads as its last four and a name as a digest — and the transform is named
 * beside it, because "…3698" presented as the cell's contents would be a lie
 * about what the operator is looking at. The real cell is in the file; that is
 * where the correction is made from.
 */
function rejectRawText(reject: RowReject): string | undefined {
  if (reject.kind !== "cell-coercion" && reject.kind !== "field-schema") return undefined;
  const raw = reject.raw;
  if (raw.state === "redacted") return `withheld (${raw.classification})`;
  if (raw.state === "transformed") return `${String(raw.value)} (${raw.transform})`;
  // The `allowed` arm is the only one carrying arbitrary JSON, and a cell that
  // is an object has no honest one-line rendering — say so rather than print
  // `[object Object]` where a value belongs.
  return typeof raw.value === "object" && raw.value !== null
    ? "(a structured value)"
    : String(raw.value);
}

function RejectedRow({
  sourceRow,
  rejects,
  locked,
  pending,
  labelOf,
  onCorrect,
  onExclude,
}: {
  sourceRow: number;
  rejects: readonly RowReject[];
  locked: boolean;
  pending: string | null;
  labelOf: (targetFieldId: string) => string;
  onCorrect: (sourceRow: number, field: string, correctedValue: string) => void;
  onExclude: (sourceRow: number, reason: string) => void;
}) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [reason, setReason] = useState("");
  const correctable = rejects.filter(
    (reject): reject is Extract<RowReject, { kind: "cell-coercion" | "field-schema" }> =>
      reject.kind === "cell-coercion" || reject.kind === "field-schema",
  );

  return (
    <section
      aria-label={`Source row ${String(sourceRow)}`}
      /*
       * The CONTAINER is quiet and the VERDICT is loud. Four rejected rows
       * stacked as four filled red blocks is a wall that hides exactly what the
       * operator is scanning for — which row, and what is wrong with it. So the
       * card sits on the recessed plane every other grouped fact uses, and the
       * failed tone is spent where it carries information: the badge and the
       * sentence.
       */
      className={cn(
        "flex flex-col gap-[var(--ds-space-tight)] rounded-[var(--ds-radius-lg)]",
        "border border-[color:var(--ds-border)] bg-[var(--ds-recess-bg)]",
        "p-[var(--ds-space-base)]",
      )}
    >
      <span className="flex flex-wrap items-baseline gap-[var(--ds-space-snug)]">
        <Chip label="row" tone="danger">
          {String(sourceRow)}
        </Chip>
        {rejects.map((reject) => (
          <Badge key={reject.rejectId} tone="danger">
            {REJECT_CODE_LABEL[reject.code]}
          </Badge>
        ))}
      </span>

      {rejects.map((reject) => (
        <span key={reject.rejectId} className="flex flex-col gap-[var(--ds-space-hair)]">
          <span role="alert" className={cn(dsText.body, "text-[color:var(--ds-status-failed-fg)]")}>
            {reject.reason}
          </span>
          <MetaLine
            items={[
              /*
               * IN106 / `DemoIntake.tsx:844` — the raw code, under the reason
               * it names. The badge above spells the SAME code in the
               * operator's words, and a re-worded label is not a thing anyone
               * can quote back to us: a `Refusal` on this surface always
               * carries its code for exactly that reason, and a rejection is
               * the same kind of sentence one row down.
               */
              `code ${reject.code}`,
              "column" in reject ? `column ${reject.column.header}` : undefined,
              "field" in reject ? reject.field : undefined,
              rejectRawText(reject) === undefined ? undefined : `value ${rejectRawText(reject) ?? ""}`,
            ]}
          />
        </span>
      ))}

      <Separator />

      {correctable.map((reject) => (
        <span key={reject.rejectId} className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
          <Input
            aria-label={`Corrected ${labelOf(reject.field)} for source row ${String(sourceRow)}`}
            value={drafts[reject.field] ?? ""}
            disabled={locked}
            placeholder={`corrected ${labelOf(reject.field)}`}
            className="min-w-[var(--ds-w-member-detail)] flex-1"
            onChange={(event) => {
              const next = event.currentTarget.value;
              setDrafts((current) => ({ ...current, [reject.field]: next }));
            }}
          />
          <Button
            size="sm"
            disabled={locked || (drafts[reject.field] ?? "").trim().length === 0}
            loading={pending === `fix:${String(sourceRow)}:${reject.field}`}
            onClick={() => onCorrect(sourceRow, reject.field, drafts[reject.field] ?? "")}
          >
            Fix cell
          </Button>
        </span>
      ))}

      <span className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
        <Input
          aria-label={`Reason for excluding source row ${String(sourceRow)}`}
          value={reason}
          disabled={locked}
          placeholder="why this person is not in this batch"
          className="min-w-[var(--ds-w-member-detail)] flex-1"
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={locked || reason.trim().length === 0}
          loading={pending === `exclude:${String(sourceRow)}`}
          onClick={() => onExclude(sourceRow, reason.trim())}
        >
          Exclude row
        </Button>
      </span>
    </section>
  );
}

/* ── manifest + rerun stages ─────────────────────────────────────────────── */

function ManifestStageView({ session }: { session: IntakeSessionWire }) {
  const stage = manifestStage(session);
  if (stage.kind === "unavailable") {
    return (
      <EmptyState
        title="No manifest identity is available"
        description="This older intake session was created before manifest identities were reserved. No manifest is invented for it."
      />
    );
  }
  if (stage.kind === "reserved") {
    return (
      <section className="flex flex-col gap-[var(--ds-space-cozy)]">
        <Banner tone="info" title="Manifest identity reserved">
          This identity is reserved for this session. It is not a committed manifest, and no runs have been enqueued.
        </Banner>
        <span className="flex min-w-0 items-start gap-[var(--ds-space-snug)]">
          <KeyValueList items={[{ key: "reserved plan id", value: stage.manifestId }]} className="min-w-0 flex-1" />
          <IdentifierPopover
            label="Show full reserved manifest identifier"
            title="Reserved manifest identifier"
            facts={manifestIdentifierFacts(session)}
          />
        </span>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-[var(--ds-space-cozy)]">
      <Banner tone="success" title={`${String(stage.rows.filter((row) => row.disposition === "valid").length)} of ${String(stage.rows.length)} source rows will run`}>
        Every source row below has exactly one disposition. The counts are derived from those dispositions, never summed from the
        rejection history — a row that was rejected and then corrected is counted once, as valid.
      </Banner>
      <span className="flex min-w-0 items-start gap-[var(--ds-space-snug)]">
        <KeyValueList items={stage.facts} className="min-w-0 flex-1" />
        <IdentifierPopover
          label="Show full manifest identifiers"
          title="Manifest identifiers"
          facts={manifestIdentifierFacts(session)}
        />
      </span>
      <div className="max-w-full overflow-x-auto">
        <Table label="Source row dispositions" className="min-w-[52rem]">
          <THead>
            <TR>
              <TH align="right">Row</TH>
              <TH>Disposition</TH>
              <TH>Item</TH>
              <TH>Input hash</TH>
              <TH>Parsed input</TH>
            </TR>
          </THead>
          <TBody>
            {stage.rows.map((row) => (
              <TR key={row.sourceRow}>
                <TD numeric align="right">{String(row.sourceRow)}</TD>
                <TD><Badge tone={row.tone}>{row.disposition}</Badge></TD>
                <TD numeric>{row.itemId ?? "—"}</TD>
                <TD numeric>{row.inputHash ?? "—"}</TD>
                <TD className="max-w-[var(--ds-w-member-detail)]">
                  <span className="block truncate" title={row.parsedInput}>{row.parsedInput}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </section>
  );
}

function RerunMembership({ label, rows }: { label: string; rows: readonly RerunMembershipRow[] }) {
  return (
    <Well className="flex flex-col gap-[var(--ds-space-tight)]">
      <SectionLabel>{label}</SectionLabel>
      {rows.length === 0 ? (
        <span className={cn(dsText.body, "text-[color:var(--ds-fg-faint)]")}>nothing</span>
      ) : rows.map((row) => (
        <span key={row.itemId} className={cn(dsText.body, dsText.nums, "break-all text-[color:var(--ds-fg-secondary)]")}>
          {row.itemId} · input {shortHash(row.inputHash)}…
        </span>
      ))}
    </Well>
  );
}

function RerunStageView({ session }: { session: IntakeSessionWire }) {
  const stage = rerunStage(session);
  if (stage.kind === "none") {
    return (
      <EmptyState
        title="No prior intake of this source"
        description="A rerun diff compares this plan with an earlier intake of the same file. This source has not been imported before, so there is nothing to compare it with — and nothing is invented to fill the gap."
      />
    );
  }
  if (stage.kind === "same-plan") {
    return (
      <section className="flex flex-col gap-[var(--ds-space-cozy)]">
        <Banner tone="warning" title="This file has already been enqueued, with this exact plan">
          Running it again would file the same rows a second time. Nothing has changed since.
        </Banner>
        <MetaLine items={[`manifest ${shortHash(stage.manifestId)}…`, `made ${fmtClock(stage.createdAt)}`]} />
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-[var(--ds-space-cozy)]">
      <Banner tone="info" title={`Compared with ${shortHash(stage.manifestId)}…, made ${fmtClock(stage.createdAt)}`}>
        This file has run before, and the plan has changed since. The exact changed axes and membership are below.
      </Banner>
      <div className="flex flex-wrap gap-[var(--ds-space-tight)]">
        {stage.axes.map((axis) => (
          <Chip key={axis.label} label={axis.label} tone="info">
            {`${shortHash(axis.was)}… → ${shortHash(axis.now)}…`}
          </Chip>
        ))}
        {stage.unchanged !== undefined && <Chip label="unchanged">{String(stage.unchanged)}</Chip>}
        <Chip label="added" tone={stage.added.length > 0 ? "info" : "neutral"}>{String(stage.added.length)}</Chip>
        <Chip label="removed" tone={stage.removed.length > 0 ? "warning" : "neutral"}>{String(stage.removed.length)}</Chip>
        <Chip label="mapping">{stage.mapping}</Chip>
        <Chip label="contract" tone={stage.contract === "changed" ? "warning" : "neutral"}>{stage.contract}</Chip>
        <Chip label="changed inputs" tone={stage.changedInputs.length > 0 ? "info" : "neutral"}>{String(stage.changedInputs.length)}</Chip>
      </div>
      <div className="grid grid-cols-1 gap-[var(--ds-space-cozy)] min-[640px]:grid-cols-2">
        <RerunMembership label={`In this plan, not in ${stage.manifestId}`} rows={stage.added} />
        <RerunMembership label={`In ${stage.manifestId}, not here`} rows={stage.removed} />
      </div>
      {stage.changedInputs.length > 0 && (
        <div className="max-w-full overflow-x-auto">
          <Table label="Changed input hashes" className="min-w-[44rem]">
            <THead>
              <TR><TH>Item</TH><TH>Previous input hash</TH><TH>Current input hash</TH></TR>
            </THead>
            <TBody>
              {stage.changedInputs.map((change) => (
                <TR key={change.itemId}>
                  <TD numeric>{change.itemId}</TD>
                  <TD numeric>{change.beforeInputHash}</TD>
                  <TD numeric>{change.afterInputHash}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      <Banner tone="info" title="Reruns never relabel replayed data as newly observed" icon={<GitCompare aria-hidden className={dsIcon.lg} />}>
        A rerun reuses the immutable source artifact and exact validated input hashes. Only a value actually re-read from a system is recorded as observed.
      </Banner>
    </section>
  );
}

/**
 * The complete identifier behind a dense, eye-scan-friendly value. Popover is
 * the design system's accessible home for load-bearing detail that would make
 * the resting surface noisy; the body wraps opaque tokens instead of clipping
 * them again as `KeyValueList` correctly does in dense lists.
 */
function IdentifierPopover({
  label,
  title,
  facts,
}: {
  label: string;
  title: string;
  facts: { key: string; value: string }[];
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton size="xs" label={label} icon={<Info aria-hidden className={dsIcon.sm} />} />
      </PopoverTrigger>
      <PopoverContent title={title} width="lg" align="start">
        <dl className="flex flex-col gap-[var(--ds-space-base)]">
          {facts.map((fact) => (
            <div key={fact.key} className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
              <dt className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{fact.key}</dt>
              <dd className={cn(dsText.body, dsText.nums, "min-w-0 break-words text-[color:var(--ds-fg)]")}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/* ── outcome band ─────────────────────────────────────────────────────────── */

/**
 * What would happen, and what stops it.
 *
 * The blockers listed here are the ones DERIVABLE from the served wire — no
 * header row, nothing bound, an unvalidated mapping. They are a courtesy, not
 * the authority: the readiness verdict belongs to the kernel, which judges it
 * against the manifest it would actually write, and its refusal is rendered
 * verbatim above. A surface that decided readiness itself would eventually
 * disagree with the server about what is about to happen.
 */
function OutcomeBand({
  session,
  busy,
  pending,
  supportsDryRun,
  dryRun,
  onDryRun,
  onValidate,
  onRun,
}: {
  session: IntakeSessionWire;
  busy: boolean;
  pending: string | null;
  supportsDryRun: boolean;
  dryRun: boolean;
  onDryRun: (next: boolean) => void;
  onValidate: () => void;
  onRun: () => void;
}) {
  const validation = session.validation;
  const noHeader = session.headerRowIndex === null;
  const nothingBound = session.bindings.length === 0 && session.constants.length === 0;
  const blockers = [
    noHeader ? "no header row is settled" : undefined,
    nothingBound ? "no column is bound" : undefined,
  ].filter((entry): entry is string => entry !== undefined);

  const validated = validation.state === "validated";
  const rejectedRows = validated ? new Set(validation.rejected.map((entry) => entry.sourceRow)).size : 0;
  const fingerprint = layoutFingerprint(session);

  return (
    <div
      className={cn(
        "sticky bottom-0 flex flex-wrap items-center gap-[var(--ds-space-base)]",
        "border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
        "px-[var(--ds-space-loose)] py-[var(--ds-space-base)]",
      )}
    >
      <span className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
        {validated ? (
          <span className="flex items-center gap-[var(--ds-space-snug)]">
            <CountBadge value={validation.validRows} tone={validation.validRows > 0 ? "success" : "warning"} />
            <span className={cn(dsText.body, "text-[color:var(--ds-fg)]")}>
              {`of ${String(session.rowCount)} rows would run`}
            </span>
            <MetaLine
              items={[
                `${String(rejectedRows)} rejected`,
                `${String(validation.excluded.length)} excluded`,
              ]}
            />
          </span>
        ) : (
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
            {blockers.length > 0
              ? `Not ready — ${blockers.join(" and ")}.`
              : "This mapping has not been validated, so nothing is known about its rows yet."}
          </span>
        )}
        {/*
          * IN8 / IN9 / `DemoIntake.tsx:355-358` — the layout every decision on
          * this screen is fenced against, echoed where the deciding buttons
          * are. `faint` because it is a standing note about the session, not a
          * fact about what is about to happen; `MetaLine`'s own docstring
          * names this exact line as one of the seven it was extracted for.
          */}
        <span className="flex items-center gap-[var(--ds-space-snug)]">
          <MetaLine tone="faint" items={layoutMetaItems(session)} />
          {fingerprint !== undefined && (
            <IdentifierPopover
              label="Show full layout fingerprint"
              title="Layout fingerprint"
              facts={[{ key: "fingerprint", value: fingerprint }]}
            />
          )}
        </span>
      </span>

      <span className="flex-1" />

      {supportsDryRun && (
        <label className="flex cursor-pointer items-center gap-[var(--ds-space-tight)]">
          <input
            type="checkbox"
            checked={dryRun}
            disabled={busy}
            onChange={(event) => onDryRun(event.currentTarget.checked)}
          />
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>Dry run</span>
        </label>
      )}

      <Button
        variant="secondary"
        loading={pending === "validate"}
        disabled={busy || blockers.length > 0 || session.state === "enqueued"}
        onClick={onValidate}
      >
        {validated ? "Re-validate" : "Validate"}
      </Button>
      <Button
        variant="primary"
        loading={pending === "run"}
        disabled={busy || !validated || session.state === "enqueued"}
        onClick={onRun}
      >
        {validated ? `Run ${String(validation.validRows)} rows` : "Run"}
      </Button>
    </div>
  );
}

/* ── the workspace ────────────────────────────────────────────────────────── */

type SessionState =
  | { readonly state: "empty" }
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly session: IntakeSessionWire }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "refused"; readonly code: string; readonly message: string };

export function IntakeWorkspace({
  workflowId,
  workflowLabel,
  actorId,
  supportsDryRun,
  sessionId,
  onSession,
  onClose,
  onEnqueued,
}: {
  workflowId: string;
  workflowLabel: string;
  actorId: string;
  /** the descriptor's own dry-run boundary; the kernel refuses a claim it lacks */
  supportsDryRun: boolean;
  sessionId: string | undefined;
  onSession: (next: string | undefined) => void;
  onClose: () => void;
  /** the fan-out landed — the queue now holds runs the operator should see */
  onEnqueued: () => void;
}) {
  const client = useDashboardClient();
  const [resource, setResource] = useState<SessionState>({ state: "empty" });
  /**
   * WHICH control is in flight, not merely THAT one is.
   *
   * Every intake command is a round trip, and locking the whole surface while
   * showing no spinner anywhere means the operator presses "Use it" and the
   * interface appears to do nothing. The key names the exact control so it —
   * and only it — carries the spinner, which is the difference between "the
   * page is stuck" and "the thing I pressed is working".
   */
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<CommandProblem | null>(null);
  const busy = pending !== null;
  /**
   * Undefined until the operator picks one: a VALIDATED session opens on its
   * review, because reviewing what the mapping rejects is the thing validation
   * exists to produce, and landing back on the grid would hide it behind a tab.
   * What the operator clicked always wins afterwards.
   */
  const [tab, setTab] = useState<IntakeTab | undefined>(undefined);
  const [dryRun, setDryRun] = useState(false);

  useEffect(() => {
    if (sessionId === undefined) {
      setResource({ state: "empty" });
      return;
    }
    let live = true;
    setResource({ state: "loading" });
    client.intakeSession(sessionId).then(
      (session) => {
        if (live) setResource({ state: "loaded", session });
      },
      (caught: unknown) => {
        if (!live) return;
        setResource({ state: "failed", message: messageOf(caught) });
      },
    );
    return () => {
      live = false;
    };
  }, [client, sessionId]);

  const upload = useCallback(
    (file: File): void => {
      setPending("upload");
      setProblem(null);
      void file.arrayBuffer().then(
        (bytes) => client.uploadIntakeFile({
          workflowId,
          fileName: file.name,
          // A browser that cannot name the type sends nothing rather than a
          // guess; the route reads magic bytes and refuses by name either way.
          mediaType: file.type.length > 0 ? file.type : "application/octet-stream",
          bytes,
        }),
      ).then(
        (result: IntakeUploadResult) => {
          setPending(null);
          if (result.state === "refused") {
            setResource({ state: "refused", code: result.code, message: result.message });
            return;
          }
          setResource({ state: "loaded", session: result.session });
          onSession(result.session.intakeSessionId);
        },
        (caught: unknown) => {
          setPending(null);
          setResource({ state: "failed", message: messageOf(caught) });
        },
      );
    },
    [client, onSession, workflowId],
  );

  const issue = useCallback(
    (session: IntakeSessionWire, command: IntakeCommand, pendingKey: string): void => {
      setPending(pendingKey);
      setProblem(null);
      client.executeCommand({
        commandId: crypto.randomUUID(),
        requestedAt: systemClock.now().toISOString(),
        requestedBy: actorId,
        source: SOURCE_SURFACE,
        family: "intake",
        type: command.type,
        target: {
          intakeSessionId: session.intakeSessionId,
          expectedVersion: session.expectedVersion,
        },
        ...("payload" in command ? { payload: command.payload } : {}),
      }).then(
        (result) => {
          const failure = problemOf(result);
          if (failure !== undefined) {
            setPending(null);
            setProblem(failure);
            return;
          }
          // Applied: the session moved, so every derived view — bindings,
          // suggestions, dispositions, the CAS token Run posts — is re-read
          // rather than patched locally. Patching would be the one place this
          // surface could come to disagree with authority.
          client.intakeSession(session.intakeSessionId).then(
            (next) => {
              setPending(null);
              setResource({ state: "loaded", session: next });
              // Validation's whole point is the review, so land on it. The
              // Enqueue hands the operator the committed manifest. The stage
              // is not a prediction: it mounts only after the re-read serves
              // the terminal projection from authority.
              if (command.type === "validate-intake") setTab("review");
              if (command.type === "enqueue-intake-manifest") setTab("manifest");
            },
            (caught: unknown) => {
              setPending(null);
              // The command DID apply; only the re-read failed. Saying so is
              // the difference between "retry it" and "do not retry it".
              setProblem({
                kind: "transport",
                message: `${command.type} applied, but re-reading the session failed: ${messageOf(caught)}`,
              });
            },
          );
        },
        (caught: unknown) => {
          setPending(null);
          setProblem({ kind: "transport", message: messageOf(caught) });
        },
      );
    },
    [actorId, client],
  );

  const body = ((): ReactNode => {
    if (resource.state === "loading") {
      return <Skeleton className="h-[var(--ds-h-review-page-min)] w-full" />;
    }
    if (resource.state === "failed") {
      return (
        <Banner tone="danger" title="This intake session could not be read">
          {resource.message}
        </Banner>
      );
    }
    if (resource.state === "refused" || resource.state === "empty") {
      return (
        // The zone GROWS to fill the surface. It is the only act available on
        // this screen, and a thin band floating in an empty panel reads as a
        // detail of a page whose real content failed to load.
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-base)]">
          {resource.state === "refused" && (
            <Refusal title="That file could not be read" code={resource.code} outcome="no session was opened">
              {resource.message}
            </Refusal>
          )}
          <Dropzone
            label={`Drop a spreadsheet of people for ${workflowLabel}`}
            accept={INTAKE_ACCEPT}
            hint="A .csv or .xlsx, up to 25 MB. Nothing runs until you map its columns and review what it rejects."
            busy={busy}
            onFile={upload}
            className="min-h-[var(--ds-h-review-page-min)] flex-1"
          />
          {/* The paper answer to the same question, beside the file answer
              (2i-F). It is a peer of the dropzone, not a mode: the operator is
              holding either a spreadsheet or a stack of forms. */}
          <CaptureStart workflowId={workflowId} workflowLabel={workflowLabel} />
        </div>
      );
    }

    const session = resource.session;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
        <SourceBand
          session={session}
          busy={busy}
          onInspect={(selection) => issue(session, { type: "inspect-intake", payload: selection }, "inspect")}
        />

        {problem !== null && <ProblemNotice problem={problem} onDismiss={() => setProblem(null)} />}

        <Tabs
          value={tab ?? (session.validation.state === "validated" ? "review" : "mapping")}
          onValueChange={(next) => setTab(intakeTab(next))}
        >
          <TabList label="Intake stage">
            <Tab value="mapping" count={session.bindings.length} className="min-h-[44px]">
              Mapping
            </Tab>
            <Tab
              value="review"
              count={session.validation.state === "validated" ? session.validation.rejected.length : undefined}
              className="min-h-[44px]"
            >
              Review
            </Tab>
            <Tab value="manifest" icon={<CheckCircle2 aria-hidden className={dsIcon.sm} />} className="min-h-[44px]">
              Manifest
            </Tab>
            <Tab value="rerun" icon={<GitCompare aria-hidden className={dsIcon.sm} />} className="min-h-[44px]">
              Rerun diff
            </Tab>
          </TabList>
          <TabPanel value="mapping">
            <MappingGrid
              session={session}
              busy={busy}
              pending={pending}
              onConfirm={(targetFieldId, sourceColumnId) => {
                const headerFingerprint = session.headerFingerprint;
                // Unreachable while a header row is settled, and a refusal
                // rather than a guess if it ever is: the kernel fences the
                // confirmation on this exact fingerprint.
                if (headerFingerprint === null) {
                  setProblem({
                    kind: "transport",
                    message: "this file has no settled layout to confirm a binding against",
                  });
                  return;
                }
                issue(
                  session,
                  { type: "confirm-intake-mapping", payload: { targetFieldId, sourceColumnId, headerFingerprint } },
                  `bind:${targetFieldId}`,
                );
              }}
            />
          </TabPanel>
          <TabPanel value="review">
            <ValidationReview
              session={session}
              busy={busy}
              pending={pending}
              onCorrect={(sourceRow, field, correctedValue) =>
                issue(
                  session,
                  { type: "correct-intake-row", payload: { sourceRow, field, correctedValue } },
                  `fix:${String(sourceRow)}:${field}`,
                )}
              onExclude={(sourceRow, reason) =>
                issue(
                  session,
                  { type: "exclude-intake-row", payload: { sourceRow, reason } },
                  `exclude:${String(sourceRow)}`,
                )}
            />
          </TabPanel>
          <TabPanel value="manifest" className="p-[var(--ds-space-base)]">
            <ManifestStageView session={session} />
            {session.state === "enqueued" && (
              <span className="mt-[var(--ds-space-cozy)] flex">
                <Button size="sm" className="min-h-[44px]" onClick={onEnqueued}>Show the runs</Button>
              </span>
            )}
          </TabPanel>
          <TabPanel value="rerun" className="p-[var(--ds-space-base)]">
            <RerunStageView session={session} />
          </TabPanel>
        </Tabs>
      </div>
    );
  })();

  return (
    <Panel className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        title="Import a spreadsheet"
        subtitle={`${workflowLabel} — one run per row`}
        actions={
          <span className="flex items-center gap-[var(--ds-space-tight)]">
            {sessionId !== undefined && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw aria-hidden className={dsIcon.sm} />}
                onClick={() => onSession(undefined)}
              >
                Another file
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </span>
        }
      />
      <PanelBody className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)] overflow-y-auto p-[var(--ds-space-loose)]">
        {body}
      </PanelBody>
      {resource.state === "loaded" && (
        <OutcomeBand
          session={resource.session}
          busy={busy}
          supportsDryRun={supportsDryRun}
          dryRun={dryRun}
          onDryRun={setDryRun}
          pending={pending}
          onValidate={() => issue(resource.session, { type: "validate-intake" }, "validate")}
          onRun={() => issue(resource.session, { type: "enqueue-intake-manifest", payload: { dryRun } }, "run")}
        />
      )}
    </Panel>
  );
}

function messageOf(caught: unknown): string {
  if (caught instanceof DashboardClientError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
