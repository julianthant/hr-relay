import { IntakeOutcomeSkeleton, IntakeSkeleton } from "../shared/loading/loading.js";
import { useIntakeWiringAdapter } from "../../state/intake-wiring-adapter.js";
import { Checkbox as HeroCheckbox } from "@heroui/react";
/** The spreadsheet intake workspace — ref data-intake-and-edit-data's upload → map → validate →
 * run, and ref dashboard-surfaces's surface contract . */
import {
Check,
CheckCircle2,
FileSpreadsheet,
GitCompare,
Info,
ListChecks,
Play,
Table2,
X,
} from "lucide-react";
import { useCallback,useMemo,useState,type ReactNode } from "react";
import type { z } from "zod";
import type { RowRejectSchema } from "../../../models/intake/manifest.js";
import type {
ColumnBindingSchema,
DetectedColumnSchema,
} from "../../../models/intake/mapping.js";
import type { IntakeTargetSchema } from "../../../models/intake/projection.js";
import type { SuggestionSchema } from "../../../models/intake/suggestions.js";
import { type IntakeSessionWire } from "../../../models/intake/wire.js";
import {
Badge,
Banner,
Button,
Card,
Checkbox,
Chip,
CountBadge,
dsIcon,
dsMotion,
dsText,
EmptyState,
Field,
IconButton,
Input,
KeyValueList,
MetaLine,
PanelBody,
PanelHeader,
Popover,
PopoverContent,
PopoverTrigger,
Refusal,
SectionLabel,
Select,
Tab,
Table,
TabList,
TabPanel,
Tabs,
TakeoverFrame,
TBody,
TD,
TH,
THead,
TR,
useDsEnterTransition,
Well,
} from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { useIntakeClient as useDashboardClient } from "./intake-client.js";
import { type CommandProblem } from "./intake-command-model.js";
import { fmtClock,plural,pluralize,shortHash } from "../shared/status/format.js";
import {
correctionEditorLabel,
correctionText,
exclusionEditorLabel,
headerCandidateOptionLabel,
INTAKE_REVIEW_CONTROL_NAMES,
INTAKE_REVIEW_COPY,
intakeTab,
intakeReadinessBlockers,
layoutFingerprint,
layoutMetaItems,
manifestIdentifierFacts,
manifestRowDetailFacts,
manifestStage,
REJECT_KIND_LABEL,
rejectionReviewEligibility,
rejectionReviewLabel,
rerunIdentifierFacts,
rerunMembershipDetailFacts,
rerunStage,
sourceLabel,
startRunsLabel,
suggestionProposalText,
useIntakeListPage,
type IntakeListPageController,
type IntakeTab,
type ManifestStageRow,
type RejectionReviewEligibility,
type RerunChangedInput,
type RerunMembershipRow,
} from "./intake-model.js";

type DetectedColumn = z.infer<typeof DetectedColumnSchema>;
type ColumnBinding = z.infer<typeof ColumnBindingSchema>;
type IntakeTarget = z.infer<typeof IntakeTargetSchema>;
type Suggestion = z.infer<typeof SuggestionSchema>;
type RowReject = z.infer<typeof RowRejectSchema>;

/** Wraps something that has just MOUNTED so it arrives rather than blinks.
 * It is a WRAPPER rather than props spread onto `Banner`, because `Banner` */
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
  if (problem.kind === "confirmation-required") return <Banner tone="warning" title="Confirmation required" action={action}>{problem.message}</Banner>;
  if (problem.kind === "conflict") {
    return (
      <Arriving>
        <Banner tone="warning" title="This session moved while you were reading it" action={action}>
          <span className="flex flex-col gap-[var(--ds-space-snug)]">
            <span>{problem.message}</span>
            <MetaLine items={[`now at version ${String(problem.currentVersion)}`, "nothing was enqueued"]} />
          </span>
        </Banner>
      </Arriving>
    );
  }
  return (
    <Arriving>
      <Banner tone="danger" title="Command status needs verification" action={action}>
        {problem.message}
      </Banner>
    </Arriving>
  );
}

/* ── source band ──────────────────────────────────────────────────────────── */

/** Sheet or header changes erase layout-bound decisions; confirm the exact affected counts first. */
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
      {/* A region’s accessible name does not replace its visible heading. */}
      <SectionLabel>Source file</SectionLabel>
      <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        <FileSpreadsheet aria-hidden className={cn(dsIcon.lg, "text-[color:var(--ds-fg-muted)]")} />
        <span className="flex min-w-0 flex-col">
          <span className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>
            {sourceLabel(session)}
          </span>
          {}
          <MetaLine
            items={[
              `sha ${shortHash(session.artifact.sha256)}`,
              `${plural(session.rowCount, "row")} read`,
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
              disabled={busy || session.state === "enqueued" || session.state === "discarded"}
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
            disabled={busy || session.state === "enqueued" || session.state === "discarded"}
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
  // Use # to mark duplicate-header ordinals; parentheses alone would read as a column count.
  return column.occurrence === 1 ? header : `${header} (#${String(column.occurrence)})`;
}

/** Map every declared target field; source-driven rows could hide required workflow fields. */
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

  const locked = busy || session.state === "enqueued" || session.state === "discarded";

  return (
    <div className="overflow-x-auto">
      {}
      <Table label={`Column mapping for ${sourceLabel(session)}`}>
        <THead>
          <TR>
            <TH>Target field</TH>
            <TH>Bound column</TH>
            <TH>Suggestion</TH>
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

/** Show source samples with bindings so correct headers cannot conceal wrong cell contents. */
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

        aria-label={`Source column for ${target.label}`}
        value={bound?.sourceColumnId ?? ""}
        disabled={locked}
        onChange={(event) => {
          const next = event.currentTarget.value;
          // The empty option means unbound; do not imply an unsupported unbind action.
          if (next.length === 0) return;
          onPick(next);
        }}
      >
        <option value="">— unbound —</option>
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

/** Ambiguous suggestions carry no visual preference; the operator must choose the binding. */
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

/** Resolve each source row once through correction or reasoned exclusion; there is no ignore arm. */
function ValidationReview({
  session,
  busy,
  pending,
  reviewed,
  onReviewed,
  onCorrect,
  onExclude,
}: {
  session: IntakeSessionWire;
  busy: boolean;
  pending: string | null;
  reviewed: boolean;
  onReviewed: (next: boolean) => void;
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
  const rejects = [...validation.rejected].sort((left, right) => left.sourceRow - right.sourceRow);
  const locked = busy || session.state === "enqueued" || session.state === "discarded";
  // Label correction targets with operator field names, not transport paths.
  const labelOf = (targetFieldId: string): string =>
    session.targets.find((target) => target.targetFieldId === targetFieldId)?.label ?? targetFieldId;
  // Name the checkbox from the visible label; label-for alone does not name Radix’s button.
  const reviewLabel = rejects.length === 0 ? "" : rejectionReviewLabel(new Set(rejects.map((reject) => reject.sourceRow)).size);

  return (
    <div className="flex flex-col gap-[var(--ds-space-loose)]">
      <MetaLine
        items={[
          `validated ${fmtClock(validation.validatedAt)}`,
          `values read as of ${fmtClock(validation.readAt)}`,
        ]}
      />

      {rejects.length === 0 && validation.excluded.length === 0 && session.corrections.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 aria-hidden className={dsIcon.lg} />}
          title={INTAKE_REVIEW_COPY.noRejectionsTitle}
          description={INTAKE_REVIEW_COPY.noRejectionsDescription}
        />
      ) : (
        <>
          {rejects.length > 0 && (
            <>
              <RejectedRowsTable
                rejects={rejects}
                locked={locked}
                pending={pending}
                labelOf={labelOf}
                onCorrect={onCorrect}
                onExclude={onExclude}
              />
              <Checkbox
                checked={reviewed}
                disabled={locked}
                className="min-h-11 items-center [&>label]:min-h-11 [&>label]:justify-center"
                onCheckedChange={(next) => onReviewed(next === true)}
                label={reviewLabel}
                description={INTAKE_REVIEW_COPY.reviewDescription}
              />
            </>
          )}

          {/* Keep recorded corrections visible after they remove rows from the rejection list. */}
          {session.corrections.length > 0 && (
            <Well aria-label="Corrected cells" className="flex flex-col gap-[var(--ds-space-tight)]">
              <SectionLabel>{INTAKE_REVIEW_COPY.corrections}</SectionLabel>
              {session.corrections.map((correction) => (
                <span
                  key={`${String(correction.sourceRow)}:${correction.field}`}
                  className={cn(dsText.body, "flex flex-wrap items-baseline gap-[var(--ds-space-snug)] text-[color:var(--ds-fg-secondary)]")}
                >
                  {`row ${String(correction.sourceRow)} · ${correctionText(correction, labelOf(correction.field))}`}
                </span>
              ))}
            </Well>
          )}

          {validation.excluded.length > 0 && (
            <Well aria-label="Excluded rows" className="flex flex-col gap-[var(--ds-space-tight)]">
              <SectionLabel>{INTAKE_REVIEW_COPY.exclusions}</SectionLabel>
              {session.exclusions.map((exclusion) => (
                <span key={exclusion.sourceRow} className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                  {`row ${String(exclusion.sourceRow)} — ${exclusion.reason}`}
                </span>
              ))}
            </Well>
          )}
        </>
      )}
    </div>
  );
}

/** Name the redaction transform; rendered masked values are not the original cell contents. */
function rejectRawText(reject: RowReject): string | undefined {
  if (reject.kind !== "cell-coercion" && reject.kind !== "field-schema") return undefined;
  const raw = reject.raw;
  if (raw.state === "redacted") return `withheld (${raw.classification})`;
  if (raw.state === "transformed") return `${String(raw.value)} (${raw.transform})`;
  // Objects have no honest one-line cell display; do not substitute object-string coercion.
  return typeof raw.value === "object" && raw.value !== null
    ? "(a structured value)"
    : String(raw.value);
}

function RejectedRowsTable({
  rejects,
  locked,
  pending,
  labelOf,
  onCorrect,
  onExclude,
}: {
  rejects: readonly RowReject[];
  locked: boolean;
  pending: string | null;
  labelOf: (targetFieldId: string) => string;
  onCorrect: (sourceRow: number, field: string, correctedValue: string) => void;
  onExclude: (sourceRow: number, reason: string) => void;
}) {
  const [correction, setCorrection] = useState<Readonly<{
    sourceRow: number;
    field: string;
    value: string;
  }> | null>(null);
  const [exclusion, setExclusion] = useState<Readonly<{ sourceRow: number; reason: string }> | null>(null);

  return (
    <div className="flex flex-col gap-[var(--ds-space-cozy)]">
      <div className="overflow-x-auto">
        <Table label={INTAKE_REVIEW_COPY.tableLabel} className="min-w-[52rem]">
          <THead>
            <TR>
              <TH align="right">{INTAKE_REVIEW_COPY.columns[0]}</TH>
              <TH>{INTAKE_REVIEW_COPY.columns[1]}</TH>
              <TH>{INTAKE_REVIEW_COPY.columns[2]}</TH>
              <TH>{INTAKE_REVIEW_COPY.columns[3]}</TH>
              <TH align="right">{INTAKE_REVIEW_COPY.columns[4]}</TH>
            </TR>
          </THead>
          <TBody>
            {rejects.map((reject) => {
              const correctable = reject.kind === "cell-coercion" || reject.kind === "field-schema";
              const raw = rejectRawText(reject);
              return (
                <TR key={reject.rejectId}>
                  <TD numeric align="right">{String(reject.sourceRow)}</TD>
                  <TD>
                    <Badge tone={reject.kind === "duplicate-identity" || reject.kind === "cross-field" ? "warning" : "danger"}>
                      {REJECT_KIND_LABEL[reject.kind]}
                    </Badge>
                  </TD>
                  <TD>
                    <span className="flex flex-col">
                      <span className={cn(dsText.body, "text-[color:var(--ds-fg)]")}>{"field" in reject ? reject.field : "—"}</span>
                      {"column" in reject && <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>“{reject.column.header}”</span>}
                      {raw !== undefined && <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-faint)]")}>{`raw: ${raw || "(empty)"}`}</span>}
                    </span>
                  </TD>
                  <TD className="max-w-[420px]">
                    <span className="block">{reject.reason}</span>
                    <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-faint)]")}>{`code ${reject.code}`}</span>
                  </TD>
                  <TD align="right">
                    <span className="flex justify-end gap-[var(--ds-space-tight)]">
                      {correctable && "field" in reject && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']"
                          disabled={locked}
                          onClick={() => {
                            setExclusion(null);
                            setCorrection({ sourceRow: reject.sourceRow, field: reject.field, value: "" });
                          }}
                        >
                          {INTAKE_REVIEW_COPY.fixCell}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']"
                        disabled={locked}
                        onClick={() => {
                          setCorrection(null);
                          setExclusion({ sourceRow: reject.sourceRow, reason: "" });
                        }}
                      >
                        {INTAKE_REVIEW_COPY.exclude}
                      </Button>
                    </span>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      {correction !== null && (
        <Card
          key={`${String(correction.sourceRow)}:${correction.field}`}
          role="region"
          aria-labelledby="intake-correction-editor-heading"
          className="flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]"
        >
          <span
            id="intake-correction-editor-heading"
            className={cn(dsText.ui, "font-semibold", "text-[color:var(--ds-fg)]")}
          >
            {correctionEditorLabel(correction.sourceRow, labelOf(correction.field))}
          </span>
          <Field label={INTAKE_REVIEW_COPY.correctedValue} description={INTAKE_REVIEW_COPY.correctionDescription}>
            <Input
              autoFocus
              autoComplete="off"
              name={INTAKE_REVIEW_CONTROL_NAMES.correctedValue}
              value={correction.value}
              disabled={locked}
              onChange={(event) => setCorrection({ ...correction, value: event.currentTarget.value })}
            />
          </Field>
          <span className="flex justify-end gap-[var(--ds-space-base)]">
            <Button variant="secondary" icon={<X aria-hidden className={dsIcon.md} />} disabled={locked} onClick={() => setCorrection(null)}>
              {INTAKE_REVIEW_COPY.cancel}
            </Button>
            <Button
              variant="primary"
              icon={<Check aria-hidden className={dsIcon.md} />}
              disabled={locked || correction.value.trim() === ""}
              loading={pending === `fix:${String(correction.sourceRow)}:${correction.field}`}
              onClick={() => onCorrect(correction.sourceRow, correction.field, correction.value)}
            >
              {INTAKE_REVIEW_COPY.reCoerce}
            </Button>
          </span>
        </Card>
      )}

      {exclusion !== null && (
        <Card
          key={String(exclusion.sourceRow)}
          role="region"
          aria-labelledby="intake-exclusion-editor-heading"
          className="flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]"
        >
          <span
            id="intake-exclusion-editor-heading"
            className={cn(dsText.ui, "font-semibold", "text-[color:var(--ds-fg)]")}
          >
            {exclusionEditorLabel(exclusion.sourceRow)}
          </span>
          <Field
            label={INTAKE_REVIEW_COPY.reason}
            required
            error={exclusion.reason.trim() === "" ? INTAKE_REVIEW_COPY.exclusionError : null}
            description={INTAKE_REVIEW_COPY.exclusionDescription}
          >
            <Input
              autoFocus
              autoComplete="off"
              name={INTAKE_REVIEW_CONTROL_NAMES.exclusionReason}
              value={exclusion.reason}
              disabled={locked}
              placeholder={INTAKE_REVIEW_COPY.exclusionPlaceholder}
              onChange={(event) => setExclusion({ ...exclusion, reason: event.currentTarget.value })}
            />
          </Field>
          <span className="flex justify-end gap-[var(--ds-space-base)]">
            <Button variant="secondary" icon={<X aria-hidden className={dsIcon.md} />} disabled={locked} onClick={() => setExclusion(null)}>
              {INTAKE_REVIEW_COPY.cancel}
            </Button>
            <Button
              variant="primary"
              icon={<Check aria-hidden className={dsIcon.md} />}
              disabled={locked || exclusion.reason.trim() === ""}
              loading={pending === `exclude:${String(exclusion.sourceRow)}`}
              onClick={() => onExclude(exclusion.sourceRow, exclusion.reason.trim())}
            >
              {INTAKE_REVIEW_COPY.excludeWithReason}
            </Button>
          </span>
        </Card>
      )}
    </div>
  );
}

/* ── manifest + rerun stages ─────────────────────────────────────────────── */

function EvidencePager<T>({
  label,
  page,
}: {
  label: string;
  page: IntakeListPageController<T>;
}) {
  if (page.pageCount === 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-[var(--ds-space-tight)]">
      <span aria-live="polite" className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
        {`Showing ${String(page.firstItem)}–${String(page.lastItem)} of ${String(page.totalItems)}`}
      </span>
      <div role="group" aria-label={`${label} pages`} className="flex gap-[var(--ds-space-tight)]">
        <Button
          size="sm"
          variant="secondary"
          className="min-h-[44px]"
          disabled={page.pageIndex === 0}
          onClick={() => page.goToPage(page.pageIndex - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="min-h-[44px]"
          disabled={page.pageIndex === page.pageCount - 1}
          onClick={() => page.goToPage(page.pageIndex + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function ManifestRows({ manifestId, rows }: { manifestId: string; rows: readonly ManifestStageRow[] }) {
  const page = useIntakeListPage(`manifest:${manifestId}:source-rows`, rows);
  return (
    <div className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
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
            {page.items.map((row) => (
              <TR key={row.sourceRow}>
                <TD numeric align="right">{String(row.sourceRow)}</TD>
                <TD><Badge tone={row.tone}>{row.disposition}</Badge></TD>
                <TD numeric>{row.itemId ?? "—"}</TD>
                <TD numeric>{row.inputHash === undefined ? "—" : row.inputHash.slice(0, 10)}</TD>
                <TD className="max-w-[var(--ds-w-member-detail)]">
                  <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
                    <span className="min-w-0 flex-1 truncate">{row.parsedInput}</span>
                    <IdentifierPopover
                      label={`Show full evidence for source row ${String(row.sourceRow)}`}
                      title={`Source row ${String(row.sourceRow)} evidence`}
                      facts={manifestRowDetailFacts(row)}
                    />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <EvidencePager label="Source row dispositions" page={page} />
    </div>
  );
}

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
        <div className="flex min-w-0 items-start gap-[var(--ds-space-snug)]">
          <KeyValueList items={[{ key: "reserved plan id", value: stage.manifestId }]} className="min-w-0 flex-1" />
          <IdentifierPopover
            label="Show full reserved manifest identifier"
            title="Reserved manifest identifier"
            facts={manifestIdentifierFacts(session)}
          />
        </div>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-[var(--ds-space-cozy)]">
      <Banner tone="success" title={`${String(stage.rows.filter((row) => row.disposition === "valid").length)} of ${String(stage.rows.length)} source rows will run`}>
        Every source row below has exactly one disposition. The counts are derived from those dispositions, never summed from the
        rejection history — a row that was rejected and then corrected is counted once, as valid.
      </Banner>
      <div className="flex min-w-0 items-start gap-[var(--ds-space-snug)]">
        <KeyValueList items={stage.facts} className="min-w-0 flex-1" />
        <IdentifierPopover
          label="Show full manifest identifiers"
          title="Manifest identifiers"
          facts={manifestIdentifierFacts(session)}
        />
      </div>
      <ManifestRows manifestId={stage.manifestId} rows={stage.rows} />
    </section>
  );
}

function RerunMembership({
  label,
  owner,
  rows,
}: {
  label: string;
  owner: string;
  rows: readonly RerunMembershipRow[];
}) {
  const page = useIntakeListPage(owner, rows);
  return (
    <Well className="flex flex-col gap-[var(--ds-space-tight)]">
      <SectionLabel>{label}</SectionLabel>
      {rows.length === 0 ? (
        <span className={cn(dsText.body, "text-[color:var(--ds-fg-faint)]")}>nothing</span>
      ) : page.items.map((row) => (
        <div key={row.itemId} className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
          <span className={cn(dsText.body, dsText.nums, "min-w-0 flex-1 break-all text-[color:var(--ds-fg-secondary)]")}>
            {row.itemId} · input {shortHash(row.inputHash)}…
          </span>
          <IdentifierPopover
            label={`Show full membership evidence for item ${row.itemId}`}
            title="Rerun membership evidence"
            facts={rerunMembershipDetailFacts(row)}
          />
        </div>
      ))}
      <EvidencePager label={label} page={page} />
    </Well>
  );
}

function ChangedInputRows({
  manifestId,
  rows,
}: {
  manifestId: string;
  rows: readonly RerunChangedInput[];
}) {
  const page = useIntakeListPage(`rerun:${manifestId}:changed-inputs`, rows);
  return (
    <div className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
      <div className="max-w-full overflow-x-auto">
        <Table label="Changed input hashes" className="min-w-[44rem]">
          <THead>
            <TR><TH>Item</TH><TH>Previous input hash</TH><TH>Current input hash</TH></TR>
          </THead>
          <TBody>
            {page.items.map((change) => (
              <TR key={change.itemId}>
                <TD numeric>{change.itemId}</TD>
                <TD numeric>{change.beforeInputHash}</TD>
                <TD numeric>{change.afterInputHash}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <EvidencePager label="Changed input hashes" page={page} />
    </div>
  );
}

function PriorImportComparison({ session, busy, onSelect }: { session: IntakeSessionWire; busy: boolean; onSelect: (id: string) => void }) {
  const [draft, setDraft] = useState("");
  if (session.state === "enqueued" || session.state === "discarded") return null;
  return <div className="flex items-end gap-[var(--ds-space-base)]">
    <Field label="Earlier import manifest" className="min-w-0 flex-1"><Input value={draft} disabled={busy} onChange={event => setDraft(event.currentTarget.value)} /></Field>
    <Button variant="secondary" disabled={busy || draft.trim() === ""} onClick={() => onSelect(draft.trim())}>Compare import</Button>
  </div>;
}

function RerunStageView({ session }: { session: IntakeSessionWire }) {
  const stage = rerunStage(session);
  if (stage.kind === "none") {
    return (
      <EmptyState
        title="No earlier import selected"
        description="Enter an earlier manifest identity to compare this plan. The files may differ; the workflow must match."
      />
    );
  }
  if (stage.kind === "same-plan") {
    return (
      <section className="flex flex-col gap-[var(--ds-space-cozy)]">
        <Banner tone="warning" title="This file has already been enqueued, with this exact plan">
          Running it again would file the same rows a second time. Nothing has changed since.
        </Banner>
        <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
          <MetaLine items={[`manifest ${shortHash(stage.manifestId)}…`, `made ${fmtClock(stage.createdAt)}`]} />
          <IdentifierPopover
            label="Show full prior manifest identifier"
            title="Prior manifest identifier"
            facts={rerunIdentifierFacts(stage)}
          />
        </div>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-[var(--ds-space-cozy)]">
      <Banner tone="info" title={`Compared with ${shortHash(stage.manifestId)}…, made ${fmtClock(stage.createdAt)}`}>
        This plan differs from the selected earlier import. The changed file, mapping, schema and membership facts are below.
      </Banner>
      <div className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
        <MetaLine items={[`prior manifest ${shortHash(stage.manifestId)}…`, `${String(stage.axes.length)} changed axes`]} />
        <IdentifierPopover
          label="Show full prior manifest and changed-axis hashes"
          title="Prior manifest and changed axes"
          facts={rerunIdentifierFacts(stage)}
        />
      </div>
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
      <div className="grid grid-cols-2 gap-[var(--ds-space-cozy)]">
        <RerunMembership
          label={`In this plan, not in ${shortHash(stage.manifestId)}…`}
          owner={`rerun:${stage.manifestId}:added`}
          rows={stage.added}
        />
        <RerunMembership
          label={`In ${shortHash(stage.manifestId)}…, not here`}
          owner={`rerun:${stage.manifestId}:removed`}
          rows={stage.removed}
        />
      </div>
      {stage.changedInputs.length > 0 && <ChangedInputRows manifestId={stage.manifestId} rows={stage.changedInputs} />}
    </section>
  );
}

/** Full identifiers belong in accessible disclosure and must wrap rather than be clipped again. */
function IdentifierPopover({
  label,
  title,
  facts,
}: {
  label: string;
  title: string;
  facts: readonly { key: string; value: string }[];
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          className="size-[44px] shrink-0"
          label={label}
          icon={<Info aria-hidden className={dsIcon.sm} />}
        />
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

/** Client blockers are explanatory; the kernel alone decides manifest readiness. */
function OutcomeBand({
  session,
  busy,
  pending,
  rejectionReview,
  supportsDryRun,
  dryRun,
  onDryRun,
  onValidate,
  onRun,
  confirmed,
  onConfirm,
}: {
  session: IntakeSessionWire;
  busy: boolean;
  pending: string | null;
  rejectionReview: RejectionReviewEligibility;
  supportsDryRun: boolean;
  dryRun: boolean;
  onDryRun: (next: boolean) => void;
  onValidate: () => void;
  onRun: () => void;
  confirmed: boolean;
  onConfirm: (next: boolean) => void;
}) {
  const validation = session.validation;
  const noHeader = session.headerRowIndex === null;
  const nothingBound = session.bindings.length === 0 && session.constants.length === 0;
  const validationBlockers = [
    noHeader ? "no header row is settled" : undefined,
    nothingBound ? "no column is bound" : undefined,
  ].filter((entry): entry is string => entry !== undefined);

  const blockers = [...intakeReadinessBlockers(session), ...(rejectionReview.kind === "required" && !rejectionReview.reviewed ? [INTAKE_REVIEW_COPY.unresolvedBlocker] : [])];
  const validated = validation.state === "validated";
  const rejectedRows = rejectionReview.rejectedRows;
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
                `${String(validation.unresolvedRows.length)} unresolved`,
                `${String(rejectedRows)} in rejection history`,
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
        {blockers.length > 0 && (
          <span className={cn(dsText.meta, "text-[color:var(--ds-status-waiting-fg)]")}>
            {`Run is blocked: ${blockers.join("; ")}.`}
          </span>
        )}
        {/* Keep layout provenance beside decisions so operators can verify their fencing basis. */}
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
        <HeroCheckbox isSelected={dryRun} isDisabled={busy} onChange={onDryRun} className="flex cursor-pointer items-center gap-[var(--ds-space-tight)]">
          <HeroCheckbox.Control><HeroCheckbox.Indicator /></HeroCheckbox.Control>
          <HeroCheckbox.Content className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>Dry run</HeroCheckbox.Content>
        </HeroCheckbox>
      )}

      <Button
        variant="secondary"
        loading={pending === "validate"}
        disabled={busy || validationBlockers.length > 0 || session.state === "enqueued" || session.state === "discarded"}
        onClick={onValidate}
      >
        {validated ? "Re-validate" : "Validate"}
      </Button>
      {session.reviewBinding !== undefined && session.state === "validated" && (
        <Checkbox checked={confirmed} disabled={busy || blockers.length > 0}
          label={session.rerun === undefined ? "I confirm this reviewed plan" : `I confirm comparison with ${shortHash(session.rerun.intakeManifestId)}`}
          onCheckedChange={next => onConfirm(next === true)} />
      )}
      <Button
        variant="primary"
        icon={<Play aria-hidden className={dsIcon.md} />}
        loading={pending === "run"}
        disabled={busy || !validated || !confirmed || session.reviewBinding === undefined || blockers.length > 0 || session.state === "enqueued" || session.state === "discarded"}
        onClick={onRun}
      >
        {validated ? startRunsLabel(validation.validRows) : "Start runs"}
      </Button>
    </div>
  );
}

/* ── the workspace ────────────────────────────────────────────────────────── */

export function IntakeWorkspace(props: Parameters<typeof IntakeSessionWorkspace>[0]) {
  return <IntakeSessionWorkspace key={props.sessionId} {...props} />;
}

function IntakeSessionWorkspace({
  workflowLabel,
  supportsDryRun,
  sessionId,
  onClose,
  onEnqueued,
}: {
  /** Name the target workflow above mapping; unlabeled bindings would be guesses. */
  workflowLabel: string;
  actorId: string;
  /** the descriptor's own dry-run boundary; the kernel refuses a claim it lacks */
  supportsDryRun: boolean;
  /** Routing here requires a real session created by the upload dialog. */
  sessionId: string;
  onClose: () => void;
  /** the fan-out landed — the queue now holds runs the operator should see */
  onEnqueued: () => void;
}) {
  const client = useDashboardClient();
  /** Acknowledgement belongs to the served rejection set. */
  const [reviewedRejectionKey, setReviewedRejectionKey] = useState<string | undefined>(undefined);
  const applied = useCallback((command: { type: string }) => {
    if (command.type === "validate-intake") setTab("review");
    if (command.type === "enqueue-intake-manifest") setTab("manifest");
  }, []);
  const { resource, issue, pending, problem, setProblem, recovery, busy } = useIntakeWiringAdapter(client, sessionId, applied);
  const [confirmedReview, setConfirmedReview] = useState<string | undefined>(undefined);
  /** Validated sessions open on rejection review until the operator selects another tab. */
  const [tab, setTab] = useState<IntakeTab | undefined>(undefined);
  const [dryRun, setDryRun] = useState(false);
  const rejectionReview = resource.state === "loaded"
    ? rejectionReviewEligibility(resource.session, reviewedRejectionKey)
    : undefined;

  const body = ((): ReactNode => {
    if (resource.state === "loading") {
      return <IntakeSkeleton />;
    }
    if (resource.state === "failed") {
      return (
        <Banner tone="danger" title="This intake session could not be read">
          {resource.message}
        </Banner>
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
        {recovery !== null && <Button variant="secondary" disabled={pending !== null} onClick={recovery.retry}>Recover exact command</Button>}

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
                // Header confirmation must use the exact layout fingerprint; stale basis refuses instead of guessing.
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
              reviewed={rejectionReview?.kind === "required" && rejectionReview.reviewed}
              onReviewed={(next) => {
                if (!next) {
                  setReviewedRejectionKey(undefined);
                  return;
                }
                const review = rejectionReviewEligibility(session, undefined);
                if (review.kind !== "required") {
                  throw new Error(`intake session ${session.intakeSessionId} requested a rejection acknowledgement with no rejected rows`);
                }
                setReviewedRejectionKey(review.reviewKey);
              }}
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
              <div className="mt-[var(--ds-space-cozy)] flex">
                <Button size="sm" className="min-h-[44px]" onClick={onEnqueued}>Show the runs</Button>
              </div>
            )}
          </TabPanel>
          <TabPanel value="rerun" className="p-[var(--ds-space-base)]">
            <PriorImportComparison session={session} busy={busy} onSelect={comparisonManifestId => issue(session, { type: "inspect-intake", payload: { comparisonManifestId } }, "comparison")} />
              <RerunStageView session={session} />
          </TabPanel>
        </Tabs>
      </div>
    );
  })();

  return (

    <TakeoverFrame label="Spreadsheet intake">
      {/* Closing the workspace preserves its durable session; it cancels no uploaded file. */}
      <PanelHeader
        title="Spreadsheet intake"
        headingLevel={2}
        meta={`mapping onto ${workflowLabel}`}
        subtitle="A sheet becomes N runs only after a header row, an operator-built column mapping, and a per-cell accept-or-reject on every row."
        actions={
          <span className="flex items-center gap-[var(--ds-space-tight)]">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </span>
        }
      />
      <PanelBody className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)] overflow-y-auto p-[var(--ds-space-loose)]">
        {body}
      </PanelBody>
      {resource.state === "loading" && <IntakeOutcomeSkeleton />}
      {resource.state === "loaded" && (
        <OutcomeBand
          session={resource.session}
          busy={busy}
          supportsDryRun={supportsDryRun}
          dryRun={dryRun}
          onDryRun={setDryRun}
          confirmed={resource.session.reviewBinding !== undefined && confirmedReview === `${resource.session.reviewBinding}:${String(dryRun)}`}
          onConfirm={next => setConfirmedReview(next && resource.session.reviewBinding !== undefined ? `${resource.session.reviewBinding}:${String(dryRun)}` : undefined)}
          pending={pending}
          rejectionReview={rejectionReviewEligibility(resource.session, reviewedRejectionKey)}
          onValidate={() => issue(resource.session, { type: "validate-intake" }, "validate")}
          onRun={() => issue(resource.session, { type: "enqueue-intake-manifest", payload: { dryRun, ...(resource.session.reviewBinding === undefined ? {} : { reviewBinding: resource.session.reviewBinding }) } }, "run")}
        />
      )}
    </TakeoverFrame>
  );
}
