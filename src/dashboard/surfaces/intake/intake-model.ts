/** The intake workspace's pure half — every sentence the surface composes from the served session */
import { useEffect, useState } from "react";
import type { z } from "zod";
import { canonicalJsonStringify, type JsonObject, type JsonValue } from "../../../rules/validation/canonical-json.js";
import type { ServedHeaderCandidateSchema } from "../../../rules/intake/header-discovery.js";
import type { RowRejectSchema } from "../../../models/intake/manifest.js";
import type { IntakeRowCorrectionSchema } from "../../../models/intake/session.js";
import type { SuggestionSchema } from "../../../models/intake/suggestions.js";
import type { IntakeManifestWire, IntakeSessionWire } from "../../../models/intake/wire.js";
import { fmtClock, shortHash } from "../shared/status/format.js";

type ServedHeaderCandidate = z.infer<typeof ServedHeaderCandidateSchema>;
type IntakeRowCorrection = z.infer<typeof IntakeRowCorrectionSchema>;
type RowReject = z.infer<typeof RowRejectSchema>;
type Suggestion = z.infer<typeof SuggestionSchema>;
export type RerunMembershipRow = IntakeManifestWire["validRows"][number];

/** The dropzone's own three strings, in ONE place because TWO surfaces now draw
 * that zone: the workspace's empty state, and the Run Modal's */
export const INTAKE_ACCEPT = ".csv,.xlsx,.xls";

export const INTAKE_DROPZONE_HINT =
  "A .csv or .xlsx, up to 25 MB. Nothing runs until you map its columns and review what it rejects.";

/** The zone names the workflow the file will be mapped ONTO, never "a workflow". */
export function intakeDropzoneLabel(workflowLabel: string): string {
  return `Drop a spreadsheet of people for ${workflowLabel}`;
}

/** Keep rejection editors and outcomes on one vocabulary; affordance and durable request remain distinct. */
export const INTAKE_REVIEW_COPY = Object.freeze({
  tableLabel: "Rejected rows",
  columns: Object.freeze(["Row", "Kind", "Field / column", "Why", "Resolve"]),
  noRejectionsTitle: "No rejections",
  noRejectionsDescription: "Every source row coerced and parsed cleanly against the bound fields. There is no list to review, so the plan is ready.",
  fixCell: "Fix cell",
  exclude: "Exclude…",
  correctedValue: "Corrected value",
  correctionDescription: "The source file is never rewritten. The correction is recorded in the manifest with the original beside it, and the value is re-coerced and re-parsed before it can become valid.",
  cancel: "Cancel",
  reCoerce: "Re-coerce this cell",
  reason: "Reason",
  exclusionError: "An exclusion without a reason is a row that vanished. Say why.",
  exclusionDescription: "Recorded in the manifest with a timestamp, so the receipt can never imply every source row ran.",
  exclusionPlaceholder: "duplicate export line — already filed last week",
  excludeWithReason: "Exclude with this reason",
  corrections: "Corrections",
  exclusions: "Exclusions",
  reviewDescription: "Rejection history includes corrected and excluded rows.",
  unresolvedBlocker: "rejection history has not been reviewed",
});

/** Stable browser-form names for the two rejection-resolution values. */
export const INTAKE_REVIEW_CONTROL_NAMES = Object.freeze({
  correctedValue: "intake-corrected-value",
  exclusionReason: "intake-exclusion-reason",
});

function reviewedSourceRow(sourceRow: number): string {
  if (!Number.isInteger(sourceRow) || sourceRow < 1) {
    throw new Error(`intake rejection editor requires a positive source row, received ${String(sourceRow)}`);
  }
  return String(sourceRow);
}

/** The correction editor's visible and accessible region name. */
export function correctionEditorLabel(sourceRow: number, targetLabel: string): string {
  const label = targetLabel.trim();
  if (label === "") throw new Error("intake correction editor requires a non-empty target label");
  return `Correct row ${reviewedSourceRow(sourceRow)} · ${label}`;
}

/** The exclusion editor's visible and accessible region name. */
export function exclusionEditorLabel(sourceRow: number): string {
  return `Exclude row ${reviewedSourceRow(sourceRow)}`;
}

export type RejectionReviewEligibility =
  | Readonly<{ kind: "not-required"; rejectedRows: 0 }>
  | Readonly<{
    kind: "required";
    rejectedRows: number;
    reviewKey: string;
    reviewed: boolean;
  }>;

/** Bind acknowledgement to the exact rejection set; new authority must revoke stale Run permission. */
export function rejectionReviewEligibility(
  session: IntakeSessionWire,
  reviewedKey: string | undefined,
): RejectionReviewEligibility {
  if (session.validation.state !== "validated") return { kind: "not-required", rejectedRows: 0 };

  const rejectedRows = new Set(session.validation.rejected.map((reject) => reject.sourceRow)).size;
  if (rejectedRows === 0) return { kind: "not-required", rejectedRows: 0 };

  const reviewKey = [
    session.intakeSessionId,
    String(session.expectedVersion),
    session.validation.validatedAt,
    ...session.validation.rejected
      .map((reject) => `${String(reject.sourceRow)}:${reject.rejectId}`)
      .sort((left, right) => left.localeCompare(right)),
  ].join("|");
  return {
    kind: "required",
    rejectedRows,
    reviewKey,
    reviewed: reviewedKey === reviewKey,
  };
}

/** The demo's acknowledgement label, pluralised from the actual row set. */
export function rejectionReviewLabel(rejectedRows: number): string {
  if (!Number.isInteger(rejectedRows) || rejectedRows < 1) {
    throw new Error(`rejection review label requires a positive row count, received ${String(rejectedRows)}`);
  }
  return `I have read all ${String(rejectedRows)} rejected row${rejectedRows === 1 ? "" : "s"}`;
}

/** The final verb names runs, not source rows; row is merely the intake unit. */
export function startRunsLabel(validRows: number): string {
  if (!Number.isInteger(validRows) || validRows < 0) {
    throw new Error(`start-runs label requires a non-negative row count, received ${String(validRows)}`);
  }
  return `Start ${String(validRows)} ${validRows === 1 ? "run" : "runs"}`;
}

export type IntakeStageFact = { key: string; value: string };

export type ManifestStageRow = Readonly<{
  sourceRow: number;
  disposition: "valid" | "rejected" | "excluded";
  tone: "success" | "danger" | "neutral";
  itemId: string | undefined;
  inputHash: string | undefined;
  parsedInput: string;
}>;

export type RerunChangedInput = Readonly<{
  itemId: string;
  beforeInputHash: string;
  afterInputHash: string;
}>;

export const INTAKE_LIST_PAGE_SIZE = 10;

export type IntakeListPage<T> = Readonly<{
  items: readonly T[];
  pageIndex: number;
  pageCount: number;
  firstItem: number;
  lastItem: number;
  totalItems: number;
}>;

export type IntakeListPageController<T> = IntakeListPage<T> & Readonly<{
  goToPage: (pageIndex: number) => void;
}>;

export type IntakeListSelection = Readonly<{
  owner: string;
  totalItems: number;
  pageIndex: number;
}>;

function intakeListPageCount(totalItems: number): number {
  if (!Number.isInteger(totalItems) || totalItems < 0) {
    throw new Error(`intake list item count ${String(totalItems)} is not a non-negative integer`);
  }
  return Math.max(1, Math.ceil(totalItems / INTAKE_LIST_PAGE_SIZE));
}

function assertIntakeListPageIndex(totalItems: number, pageIndex: number): number {
  const pageCount = intakeListPageCount(totalItems);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new Error(
      `intake list page ${String(pageIndex + 1)} is outside ${String(pageCount)} ${pageCount === 1 ? "page" : "pages"} for ${String(totalItems)} ${totalItems === 1 ? "item" : "items"}`,
    );
  }
  return pageCount;
}

/** Bound local rendering while shared virtualization is unavailable. */
export function intakeListPage<T>(items: readonly T[], pageIndex: number): IntakeListPage<T> {
  const pageCount = assertIntakeListPageIndex(items.length, pageIndex);
  const start = pageIndex * INTAKE_LIST_PAGE_SIZE;
  const pageItems = items.slice(start, start + INTAKE_LIST_PAGE_SIZE);
  return {
    items: pageItems,
    pageIndex,
    pageCount,
    firstItem: items.length === 0 ? 0 : start + 1,
    lastItem: start + pageItems.length,
    totalItems: items.length,
  };
}

/** Reconcile a persisted page with the exact list owner and size now served. */
export function intakeListPageForSelection<T>(
  items: readonly T[],
  owner: string,
  selection: IntakeListSelection,
): IntakeListPage<T> {
  assertIntakeListPageIndex(selection.totalItems, selection.pageIndex);
  const pageCount = intakeListPageCount(items.length);
  const pageIndex = selection.owner === owner
    ? selection.totalItems === items.length
      ? selection.pageIndex
      : Math.min(selection.pageIndex, pageCount - 1)
    : 0;
  return intakeListPage(items, pageIndex);
}

/** Local component state for one intake evidence list identity. */
export function useIntakeListPage<T>(owner: string, items: readonly T[]): IntakeListPageController<T> {
  const [selection, setSelection] = useState<IntakeListSelection>({ owner, totalItems: items.length, pageIndex: 0 });
  const page = intakeListPageForSelection(items, owner, selection);
  useEffect(() => {
    if (
      selection.owner !== owner
      || selection.totalItems !== items.length
      || selection.pageIndex !== page.pageIndex
    ) {
      setSelection({ owner, totalItems: items.length, pageIndex: page.pageIndex });
    }
  }, [items.length, owner, page.pageIndex, selection.owner, selection.pageIndex, selection.totalItems]);
  return {
    ...page,
    goToPage: (nextPageIndex) => {
      intakeListPage(items, nextPageIndex);
      setSelection({ owner, totalItems: items.length, pageIndex: nextPageIndex });
    },
  };
}

export type ManifestStage =
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "reserved"; manifestId: string }>
  | Readonly<{
    kind: "terminal";
    manifestId: string;
    facts: IntakeStageFact[];
    rows: ManifestStageRow[];
  }>;

export type RerunStage =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "same-plan"; manifestId: string; createdAt: string }>
  | Readonly<{
    kind: "changed";
    manifestId: string;
    createdAt: string;
    axes: readonly Readonly<{ label: string; was: string; now: string }>[];
    unchanged: number | undefined;
    mapping: "changed" | "identical";
    contract: "changed" | "identical";
    added: readonly RerunMembershipRow[];
    removed: readonly RerunMembershipRow[];
    changedInputs: readonly RerunChangedInput[];
  }>;

/** Why a column was proposed — ref data-intake-and-edit-data's scorer, said out loud. */
const SUGGESTION_WHY_LABEL: Record<Suggestion["why"][number], string> = {
  "alias-exact": "known header",
  "label-exact": "matches the field label",
  "token-overlap": "words in common",
  "samples-parse": "its values parse",
};

/** Absent source names describe older records, not unnamed uploaded files. */
export function sourceLabel(session: IntakeSessionWire): string {
  return session.sourceName ?? "(this session predates file names)";
}

/** Header confidence is a rank, never a probability; keep row identity beside it. */
export function headerCandidateOptionLabel(candidate: ServedHeaderCandidate): string {
  const preview = candidate.cells.filter((cell) => cell.length > 0).slice(0, 6).join(" · ");
  return `row ${String(candidate.rowIndex + 1)} · confidence ${candidate.confidence.toFixed(2)} — ${preview}`;
}

/** Keep proposal rank beside its reasoning so it cannot read as a column fact. */
export function suggestionProposalText(proposal: Suggestion): string {
  const why = proposal.why.map((entry) => SUGGESTION_WHY_LABEL[entry]).join(", ");
  return `${why} (${proposal.score.toFixed(2)})`;
}

/** Show the settled layout fingerprint at decisions; display row indices in the source’s one-based numbering. */
export function layoutMetaItems(session: IntakeSessionWire): string[] {
  const fingerprint = layoutFingerprint(session);
  if (session.headerRowIndex === null || fingerprint === undefined) return [];
  return [
    `header row ${String(session.headerRowIndex + 1)}`,
    `fingerprint ${shortHash(fingerprint)}`,
  ];
}

/** Expose the full fencing fingerprint; an eye-scan prefix cannot verify exact authority. */
export function layoutFingerprint(session: IntakeSessionWire): string | undefined {
  if (session.headerRowIndex === null || session.headerFingerprint === null) return undefined;
  return session.headerFingerprint;
}

/** Only the replacement value is served; never invent the original cell or rewrite the file. */
export function correctionText(correction: IntakeRowCorrection, fieldLabel: string): string {
  return `${fieldLabel} → “${correction.correctedValue}”`;
}

/** Manifest creation uses its own instant; never substitute the upload time when rerun evidence is absent. */
export function manifestFacts(session: IntakeSessionWire): IntakeStageFact[] {
  const stage = manifestStage(session);
  return stage.kind === "terminal" ? stage.facts : [];
}

/** Expose complete manifest IDs and digests through accessible disclosure, not dense-list truncation. */
export function manifestIdentifierFacts(session: IntakeSessionWire): IntakeStageFact[] {
  const stage = manifestStage(session);
  if (stage.kind === "reserved") return [{ key: "reserved manifest id", value: stage.manifestId }];
  if (stage.kind === "unavailable") return [];
  const manifest = terminalManifest(session);
  return [
    { key: "plan id", value: stage.manifestId },
    { key: "source sha256", value: session.artifact.sha256 },
    { key: "artifact id", value: session.artifact.id },
    { key: "mapping fingerprint", value: manifest.mappingFingerprint },
    { key: "mapping snapshot", value: manifest.mappingSnapshotHash },
    { key: "intake projection", value: manifest.intakeProjectionFingerprint },
    { key: "workflow contract", value: manifest.workflowContractFingerprint },
    { key: "canonical input schema", value: manifest.canonicalInputSchemaHash },
  ];
}

/** Full row evidence for the touch- and keyboard-reachable detail disclosure. */
export function manifestRowDetailFacts(row: ManifestStageRow): IntakeStageFact[] {
  const facts: IntakeStageFact[] = [];
  if (row.itemId !== undefined) facts.push({ key: "item id", value: row.itemId });
  if (row.inputHash !== undefined) facts.push({ key: "input hash", value: row.inputHash });
  facts.push({ key: "parsed input", value: row.parsedInput });
  return facts;
}

/** The terminal receipt and its preflight reservation are intentionally different states. */
export function manifestStage(session: IntakeSessionWire): ManifestStage {
  if (session.state !== "enqueued") {
    return session.reservedManifestId === undefined
      ? { kind: "unavailable" }
      : { kind: "reserved", manifestId: session.reservedManifestId };
  }

  const manifest = terminalManifest(session);
  const validBySourceRow = new Map(manifest.validRows.map((row) => [row.sourceRow, row]));
  return {
    kind: "terminal",
    manifestId: manifest.manifestId,
    facts: [
      { key: "plan id", value: manifest.manifestId },
      { key: "source", value: `${sourceLabel(session)} · sha ${session.artifact.sha256.slice(0, 12)}` },
      { key: "artifact", value: session.artifact.id },
      { key: "mapping fingerprint", value: manifest.mappingFingerprint },
      { key: "mapping snapshot", value: manifest.mappingSnapshotHash },
      { key: "intake projection", value: manifest.intakeProjectionFingerprint },
      { key: "workflow contract", value: manifest.workflowContractFingerprint },
      { key: "canonical input schema", value: manifest.canonicalInputSchemaHash },
      { key: "created", value: fmtClock(manifest.createdAt) },
      { key: "totals", value: manifestTotalsText(manifest.totals) },
    ],
    rows: manifest.sourceRowDispositions.map((disposition) => {
      const valid = validBySourceRow.get(disposition.sourceRow);
      return {
        sourceRow: disposition.sourceRow,
        disposition: disposition.disposition,
        tone: disposition.disposition === "valid" ? "success" : disposition.disposition === "rejected" ? "danger" : "neutral",
        itemId: disposition.itemId,
        inputHash: valid?.inputHash,
        parsedInput: valid === undefined
          ? disposition.currentRejectIds.length === 0 ? "—" : `rejects: ${disposition.currentRejectIds.join(", ")}`
          : parsedInputText(valid.parsedInput),
      };
    }),
  };
}

/** An absent rerun is meaningful: this source has never been imported before. */
export function rerunStage(session: IntakeSessionWire): RerunStage {
  if (session.rerun === undefined) return { kind: "none" };
  const { rerun } = session;
  if (rerun.diff.kind === "same-plan") {
    return { kind: "same-plan", manifestId: rerun.intakeManifestId, createdAt: rerun.createdAt };
  }
  return {
    kind: "changed",
    manifestId: rerun.intakeManifestId,
    createdAt: rerun.createdAt,
    axes: rerun.diff.changes.map((change) => ({ label: RERUN_AXIS_LABEL[change.what], was: change.was, now: change.now })),
    unchanged: session.validation.state === "validated"
      ? session.validation.validRows - rerun.diff.added.length - rerun.diff.changedInputs.length
      : undefined,
    mapping: rerun.diff.changes.some((change) => change.what === "mapping") ? "changed" : "identical",
    contract: rerun.diff.changes.some((change) => change.what === "workflow-contract") ? "changed" : "identical",
    added: rerun.diff.added,
    removed: rerun.diff.removed,
    changedInputs: rerun.diff.changedInputs,
  };
}

/** Exact identifiers behind the rerun stage's compact prior-plan and axis values. */
export function rerunIdentifierFacts(stage: Exclude<RerunStage, Readonly<{ kind: "none" }>>): IntakeStageFact[] {
  const facts: IntakeStageFact[] = [{ key: "prior manifest id", value: stage.manifestId }];
  if (stage.kind === "changed") {
    for (const axis of stage.axes) {
      facts.push(
        { key: `${axis.label} — previous`, value: axis.was },
        { key: `${axis.label} — current`, value: axis.now },
      );
    }
  }
  return facts;
}

/** Full membership evidence behind one compact added/removed row. */
export function rerunMembershipDetailFacts(row: RerunMembershipRow): IntakeStageFact[] {
  return [
    { key: "item id", value: row.itemId },
    { key: "input hash", value: row.inputHash },
  ];
}

export type IntakeTab = "mapping" | "review" | "manifest" | "rerun";

/** The tab primitive is stringly; this boundary refuses a value the workspace never declared. */
export function intakeTab(value: string): IntakeTab {
  if (value === "mapping" || value === "review" || value === "manifest" || value === "rerun") return value;
  throw new Error(`intake workspace received an undeclared tab value: ${value}`);
}

/** Operator labels cover every rejection arm; diagnostic codes remain visible. */
export const REJECT_KIND_LABEL: Record<RowReject["kind"], string> = {
  "unmapped-required": "unmapped field",
  "cell-coercion": "cell could not be read",
  "field-schema": "value out of shape",
  "workflow-schema": "row rejected by the workflow",
  "duplicate-identity": "duplicate person",
  "cross-field": "fields disagree",
};

const RERUN_AXIS_LABEL: Record<"source-artifact" | "mapping" | "intake-projection" | "workflow-contract" | "canonical-input-schema", string> = {
  "source-artifact": "the file",
  mapping: "the mapping",
  "intake-projection": "the workflow's mappable fields",
  "workflow-contract": "the workflow contract",
  "canonical-input-schema": "the input schema",
};

function terminalManifest(session: IntakeSessionWire): NonNullable<IntakeSessionWire["manifest"]> {
  if (session.manifest === undefined) {
    throw new Error(`enqueued intake session ${session.intakeSessionId} carries no terminal manifest`);
  }
  if (session.intakeManifestId === undefined) {
    throw new Error(`enqueued intake session ${session.intakeSessionId} carries no committed manifest id`);
  }
  if (session.manifest.manifestId !== session.intakeManifestId) {
    throw new Error(`enqueued intake session ${session.intakeSessionId} disagrees with its terminal manifest id`);
  }
  return session.manifest;
}

function manifestTotalsText(totals: NonNullable<IntakeSessionWire["manifest"]>["totals"]): string {
  return `${String(totals.sourceRows)} rows · ${String(totals.valid)} valid · ${String(totals.rejected)} rejected · ${String(totals.excluded)} excluded · ${String(totals.corrected)} corrected`;
}

function parsedInputText(input: JsonValue): string {
  if (isJsonObject(input)) {
    return Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${jsonValueText(value)}`)
      .join(" · ");
  }
  return canonicalJsonStringify(input);
}

function jsonValueText(value: JsonValue): string {
  return typeof value === "string" ? value : canonicalJsonStringify(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reasons to withhold enqueue, derived only from current served review facts. */
export function intakeReadinessBlockers(session: IntakeSessionWire): string[] {
  const assigned = new Set([...session.bindings.map(row => row.targetFieldId), ...session.constants.map(row => row.targetFieldId)]);
  const missing = session.targets.filter(target => target.required && !assigned.has(target.targetFieldId));
  const blockers = missing.map(target => `${target.label} is not bound`);
  if (session.headerRowIndex === null) blockers.push("no header row is settled");
  if (session.validation.state === "none") blockers.push("mapping has not been validated");
  else {
    if (session.validation.unresolvedRows.length > 0) blockers.push(`${String(session.validation.unresolvedRows.length)} unresolved source rows`);
    if (session.validation.validRows === 0) blockers.push("no valid rows");
  }
  return blockers;
}
