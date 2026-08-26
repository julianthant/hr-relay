/**
 * The intake workspace's pure half — every sentence the surface composes from
 * the served session, extracted so it is pinned by a unit test rather than by a
 * screenshot.
 *
 * This tree renders no React in the unit lane (D187's lesson, restated by
 * D237/D238), so an operator-facing string left inside a component is only as
 * pinned as the parity corpus that photographs it — and three of the facts
 * below (`corrections`, the manifest block) appear on states the corpus does
 * not hold. They are folds, so they are testable; leaving them inline would
 * have made them unpinnable.
 *
 * Every fact here is one the wire ALREADY carries and the surface used to drop
 * on the floor (03a §Served-and-dropped, ledger 3 §6 rows IN8, IN9, IN53, IN82,
 * IN106, IN121, IN126, IN127, IN131). The legacy rebuild-demo is the incumbent
 * visual truth for where and how each is drawn; each fold names the demo line
 * it is ported from.
 *
 * Provenance: `hr-automation@src/dashboard/components/dev/rebuild-demo/DemoIntake.tsx`.
 */
import { useState } from "react";
import type { z } from "zod";
import { canonicalJsonStringify, type JsonObject, type JsonValue } from "../../domain/canonical-json.js";
import type { ServedHeaderCandidateSchema } from "../../domain/intake/header-discovery.js";
import type { IntakeRowCorrectionSchema } from "../../domain/intake/session.js";
import type { SuggestionSchema } from "../../domain/intake/suggestions.js";
import type { IntakeManifestWire, IntakeSessionWire } from "../../domain/intake/wire.js";
import { fmtClock, shortHash } from "./format.js";

type ServedHeaderCandidate = z.infer<typeof ServedHeaderCandidateSchema>;
type IntakeRowCorrection = z.infer<typeof IntakeRowCorrectionSchema>;
type Suggestion = z.infer<typeof SuggestionSchema>;
export type RerunMembershipRow = IntakeManifestWire["validRows"][number];

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

/** A local rendering bound; D9's shared virtualization primitive remains unbuilt. */
export function intakeListPage<T>(items: readonly T[], pageIndex: number): IntakeListPage<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / INTAKE_LIST_PAGE_SIZE));
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new Error(
      `intake list page ${String(pageIndex + 1)} is outside ${String(pageCount)} ${pageCount === 1 ? "page" : "pages"} for ${String(items.length)} ${items.length === 1 ? "item" : "items"}`,
    );
  }
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

/** Local component state for one immutable intake evidence list. */
export function useIntakeListPage<T>(owner: string, items: readonly T[]): IntakeListPageController<T> {
  const [selection, setSelection] = useState<Readonly<{ owner: string; pageIndex: number }>>({ owner, pageIndex: 0 });
  const pageIndex = selection.owner === owner ? selection.pageIndex : 0;
  const page = intakeListPage(items, pageIndex);
  return {
    ...page,
    goToPage: (nextPageIndex) => {
      intakeListPage(items, nextPageIndex);
      setSelection({ owner, pageIndex: nextPageIndex });
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

/** Why a column was proposed — ref data-intake-and-edit-data §2.5's scorer, said out loud. */
const SUGGESTION_WHY_LABEL: Record<Suggestion["why"][number], string> = {
  "alias-exact": "known header",
  "label-exact": "matches the field label",
  "token-overlap": "words in common",
  "samples-parse": "its values parse",
};

/**
 * The name this file was uploaded under — one fallback, spelled once.
 *
 * A pre-D171 session has no `sourceName`, and a blank there would read as a
 * file with no name rather than as a record that predates the field.
 */
export function sourceLabel(session: IntakeSessionWire): string {
  return session.sourceName ?? "(this session predates file names)";
}

/**
 * A header candidate as one line of a `<select>` — `row 4 · confidence 0.96 —
 * Employee ID · Legal Name · …` (IN53, `DemoIntake.tsx:488-493`).
 *
 * The demo draws the rank as its own muted span inside a selectable `Card`;
 * D173 reshaped the candidate list into one `Select`, and an `<option>` carries
 * text and nothing else — so the fact travels as a ` · ` segment in the label,
 * in the demo's own order (row, then confidence, then the row's cells) and at
 * the demo's own two decimal places. It is a RANK, never a probability, which
 * is why it is never rendered as a percentage.
 */
export function headerCandidateOptionLabel(candidate: ServedHeaderCandidate): string {
  const preview = candidate.cells.filter((cell) => cell.length > 0).slice(0, 6).join(" · ");
  return `row ${String(candidate.rowIndex + 1)} · confidence ${candidate.confidence.toFixed(2)} — ${preview}`;
}

/**
 * A proposal's reasoning and its rank — `known header, matches the field label
 * (0.94)` (IN82, `DemoIntake.tsx:636-638`).
 *
 * The demo prints the score parenthesised immediately after the reason, in the
 * same muted span, because the two are one thought: *this* is why, and *this*
 * is how strongly. Splitting them across two lines would let the rank read as a
 * fact about the column rather than about the proposal.
 */
export function suggestionProposalText(proposal: Suggestion): string {
  const why = proposal.why.map((entry) => SUGGESTION_WHY_LABEL[entry]).join(", ");
  return `${why} (${proposal.score.toFixed(2)})`;
}

/**
 * The layout the whole surface is read relative to — `header row 4 ·
 * fingerprint 503172dd` (IN8/IN9, `DemoIntake.tsx:355-358`).
 *
 * Every binding, correction and exclusion on this screen names a row and a
 * column UNDER THIS LAYOUT, and the kernel fences each confirmation on this
 * exact fingerprint — so the operator working at the bottom of a long grid can
 * read which layout they are deciding against without scrolling back to the
 * source band. That is the demo's reason for putting it in the dialog footer,
 * and the sticky outcome band is this workspace's footer.
 *
 * Empty until a header row is settled: before that there is no layout, and a
 * fingerprint of nothing is a value nobody could act on. The header row is
 * printed 1-BASED, matching the row numbers the source band's own picker and
 * every rejection use; `headerRowIndex` is 0-based on the wire.
 */
export function layoutMetaItems(session: IntakeSessionWire): string[] {
  const fingerprint = layoutFingerprint(session);
  if (session.headerRowIndex === null || fingerprint === undefined) return [];
  return [
    `header row ${String(session.headerRowIndex + 1)}`,
    `fingerprint ${shortHash(fingerprint)}`,
  ];
}

/**
 * The whole layout fingerprint behind the footer's short eye-scan value.
 *
 * The short prefix keeps the sticky outcome band dense, but this is a fencing
 * value rather than decorative metadata: the operator must be able to inspect
 * the exact value the kernel will compare. It stays absent until there is a
 * settled layout for the same reason as `layoutMetaItems`.
 */
export function layoutFingerprint(session: IntakeSessionWire): string | undefined {
  if (session.headerRowIndex === null || session.headerFingerprint === null) return undefined;
  return session.headerFingerprint;
}

/**
 * A recorded correction, as its own line — `Employee ID (EID) → “12345”`
 * (IN121, `DemoIntake.tsx:918-921`).
 *
 * The demo writes `“<original>” → “<corrected>”`. `IntakeRowCorrectionSchema`
 * carries no `original`, so the left of the arrow is UNSERVED and the field's
 * own label stands there instead — inventing the prior value, or leaving an
 * empty quoted pair, would both be claims about a cell nothing on this wire
 * describes. The arrow survives because the direction is served: this value
 * REPLACED what the file holds, and the file is never rewritten.
 */
export function correctionText(correction: IntakeRowCorrection, fieldLabel: string): string {
  return `${fieldLabel} → “${correction.correctedValue}”`;
}

/**
 * What the enqueued manifest is made of (IN126/IN127/IN131,
 * `DemoIntake.tsx:961-971`).
 *
 * The demo's Manifest STAGE is a `KeyValueList` of eight rows; four of them are
 * not on `IntakeSessionWire` at all and stay booked as unserved. These are the
 * ones the wire already carries, drawn in the demo's shape, in the demo's
 * order, where the enqueued banner used to print one bare `manifest <uuid>`.
 *
 * `created` reads `rerun.createdAt` — the MANIFEST's instant. `session.createdAt`
 * is when the file was uploaded, which the source band already prints as
 * `uploaded …`; labelling it `created` on a manifest block would be the right
 * kind of fact read from the wrong instance of it (D256's shape). When an
 * enqueued session carries no rerun view, the row is simply absent rather than
 * filled from the nearest plausible instant.
 */
export function manifestFacts(session: IntakeSessionWire): IntakeStageFact[] {
  const stage = manifestStage(session);
  return stage.kind === "terminal" ? stage.facts : [];
}

/**
 * The full opaque identifiers behind the manifest block's compact rows.
 *
 * `KeyValueList` deliberately truncates its dense value column, so these exact
 * values travel separately to the one accessible disclosure beside that list.
 * The digest is the full SHA-256, never the source row's eye-scan prefix.
 */
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
