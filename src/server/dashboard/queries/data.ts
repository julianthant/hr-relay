import type { JsonValue } from "../../../domain/canonical-json.js";
import { localDatePart } from "../../../domain/clock.js";
import {
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../domain/dashboard/run-detail.js";
import { runClaim, type RunRecord } from "../../../domain/run/record.js";
import type { RunCheckpointRecord } from "../../../domain/workflow/checkpoint.js";
import type { RunFoldRecord } from "../projectors/run-queue-projection.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView } from "./run-detail-types.js";
import { requireRun } from "./run-read.js";

/* ── the context-data edit projection (2i-C) ─────────────────────────────── */

type EditableScalar = string | number | boolean;

/** Plain-string drafts; `RunDetailSectionResponseSchema.parse` brands them. */
type ContextDataEditing =
  | { state: "editable"; expectedVersion: number }
  | { state: "locked"; reason: string };
/**
 * The three provenance leaves the Data section serves (ref workflow-model §5.6).
 *
 * They are OMITTED, never nulled: the wire's members are optional and an absent
 * one says "this build cannot date this value". A checkpoint that recorded no
 * covering provenance point, an entry with no field identity, and a step that
 * never checkpointed all land here, and all three mean the same thing to the
 * rail — which is why they render identically rather than through three arms
 * the operator would have to tell apart.
 */
type FactProvenanceWire = {
  observedAt?: string;
  source?: "live" | "derived" | "operator";
  correctedAt?: string;
  /** D307 — the omitted step this leaf was asserted for; see the wire's own note. */
  assertedStep?: string;
};

/**
 * D252 — the origin/freshness half of an entry, projected onto the wire's
 * shape. Both are omitted together when the descriptor names no origin for
 * the entry's node: `ContextDataSectionSchema` refuses a bound with no step to
 * attribute it to.
 */
type ContextDataOriginWire = {
  origin?: {
    nodeId: string;
    step: string;
    dir: "read" | "write";
    system?: string;
  };
  freshness?: {
    maxAge: number | "unbounded";
    override: "forbidden" | "audited";
    feeds: readonly Readonly<{ nodeId: string; label: string }>[];
  };
};

type ContextDataEntry = FactProvenanceWire & ContextDataOriginWire & {
  label: string;
  valueRedacted: string;
  edit:
    | {
      state: "editable";
      nodeId: string;
      fieldPath: string;
      value: EditableScalar;
      pendingCorrection:
        | { state: "none" }
        | { state: "pending"; value: EditableScalar; correctedAt: string };
    }
    | { state: "locked"; reason: string };
};

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEditableScalar(value: JsonValue): value is EditableScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

type ScalarLookup =
  | { kind: "scalar"; value: EditableScalar }
  | { kind: "absent" }
  | { kind: "not-scalar" };

/**
 * Walk a stored output to the declared leaf. `absent` is a real outcome (the
 * value routinely lives on one arm of a present/absent union), and a value
 * that is not a single scalar is named as such rather than stringified into a
 * field the operator could "correct" without understanding its shape.
 */
function scalarAtPath(output: JsonValue, fieldPath: string): ScalarLookup {
  let current: JsonValue = output;
  for (const part of fieldPath.split(".")) {
    if (!isJsonRecord(current) || !Object.hasOwn(current, part)) return { kind: "absent" };
    const next = current[part];
    if (next === undefined) return { kind: "absent" };
    current = next;
  }
  return isEditableScalar(current) ? { kind: "scalar", value: current } : { kind: "not-scalar" };
}

function displayScalar(value: EditableScalar): string {
  const text = String(value);
  return text.length === 0 ? "(empty)" : text;
}

/**
 * The run-level half of the edit policy. Same facts, same order, as the
 * kernel's `executeEditCheckpoint` refusal arms — this projection exists so
 * the rail can show the reason BEFORE a save is attempted, never so the
 * client can decide differently from the kernel.
 */
function contextEditingOf(
  authority: RunRecord,
  descriptor: RunDetailDescriptorView | undefined,
): ContextDataEditing {
  if (descriptor === undefined) {
    return {
      state: "locked",
      reason: `workflow ${authority.envelope.workflow} has no registered descriptor in this build`,
    };
  }
  const editData = descriptor.capabilities?.editData;
  if (editData === undefined || typeof editData === "boolean") {
    return { state: "locked", reason: "this workflow declares no correctable fields" };
  }
  if (runClaim(authority) !== undefined) {
    return {
      state: "locked",
      reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
        + "editing reopens when it parks or finishes",
    };
  }
  const { state } = authority.lifecycle;
  if (state !== "queued" && state !== "parked-gate") {
    return {
      state: "locked",
      reason: `run is ${state}; corrections apply only to a non-executing resumable run`,
    };
  }
  return { state: "editable", expectedVersion: authority.version };
}

type PendingCorrectionLookup =
  | { state: "none" }
  | { state: "pending"; value: EditableScalar; correctedAt: string }
  | { state: "not-scalar" };

function pendingCorrectionOf(
  authority: RunRecord,
  source: { nodeId: string; fieldPath: string },
): PendingCorrectionLookup {
  const pending = (authority.envelope.injected ?? []).find(
    (patch) => String(patch.nodeId) === source.nodeId && patch.fieldPath === source.fieldPath,
  );
  if (pending === undefined) return { state: "none" };
  if (!isEditableScalar(pending.value)) return { state: "not-scalar" };
  return { state: "pending", value: pending.value, correctedAt: pending.correctedAt };
}

/**
 * The provenance point that DATES a leaf, off the checkpoint that produced it.
 *
 * Exact path first, then the longest COVERING PREFIX. The prefix arm is not a
 * convenience: `task-provenance.ts` records at leaf granularity but a wrapper
 * value is dated through the prefix that covers it — D82's evidence receipt
 * resolves a transaction commit's output leaves the same way, through the
 * `output`/`proof` wrapper the checkpoint actually recorded. Longest wins so a
 * point recorded for `startsOn.value` beats one recorded for `startsOn`, which
 * is the more specific and therefore the more truthful observation.
 *
 * A path is a prefix only at a SEGMENT boundary: `starts` must never cover
 * `startsOn.value`, or a leaf would inherit a date from an unrelated field
 * whose name it merely begins with.
 */
function provenanceFor(
  stored: RunCheckpointRecord,
  fieldPath: string,
): FactProvenanceWire {
  let best: RunCheckpointRecord["provenance"][number] | undefined;
  for (const point of stored.provenance) {
    const path = String(point.path);
    if (path !== fieldPath && !fieldPath.startsWith(`${path}.`)) continue;
    if (best === undefined || path.length > String(best.path).length) best = point;
  }
  /*
   * D307 — the row's own marker, not an inference from the leaf's source: an
   * assertion is a property of the ROW (the executor stamps it when the step
   * was omitted), and every one of its leaves is operator-sourced by
   * construction. A leaf with no covering provenance point still carries it,
   * because "this row was asserted" is true of the row whether or not one
   * point covers this path.
   */
  const asserted = stored.assertion === undefined
    ? {}
    : { assertedStep: String(stored.assertion.step) };
  if (best === undefined) return asserted;
  return {
    observedAt: best.observedAt,
    source: best.source,
    ...(best.correctedAt === undefined ? {} : { correctedAt: best.correctedAt }),
    ...asserted,
  };
}

/**
 * D252 — where this entry's value came from, and the bound it is held under.
 *
 * Both facts are the DESCRIPTOR's, not the row's: the node that produced the
 * value declares whether its task reads or writes, which system it runs
 * against, and how old the fact may be before a scheduled commit refuses it.
 * A node the current build has no origin for yields neither — the same
 * absence as an entry with no field identity at all.
 */
function originOf(
  descriptor: RunDetailDescriptorView | undefined,
  nodeId: string,
  fieldPath: string,
): ContextDataOriginWire {
  const origin = descriptor?.dataOrigins?.find((entry) =>
    entry.nodeId === nodeId && (entry.role === undefined || entry.role === "task" || entry.role === "commit"));
  if (origin === undefined) return {};
  const bound = origin.freshness?.find((entry) => entry.fieldPath === fieldPath);
  return {
    origin: {
      nodeId: origin.nodeId,
      step: origin.step,
      dir: origin.dir,
      ...(origin.system === undefined ? {} : { system: origin.system }),
    },
    ...(bound === undefined
      ? {}
      : { freshness: { maxAge: bound.maxAge, override: bound.override, feeds: origin.feeds } }),
  };
}

/**
 * One entry for a correctable field: the raw recorded scalar from the
 * caller-resolved latest compatible checkpoint, plus any pending injected
 * correction.
 *
 * The checkpoint is a PARAMETER rather than a lookup, because the caller has
 * already had to resolve it: ref dashboard-surfaces §1.1(c)'s Data section lists what the run
 * touched, so a declared-correctable field with no stored checkpoint is not an
 * entry at all. Before D254 the retired `span.patched` fold could reach this
 * function with no checkpoint behind it, and the `display` argument carried
 * that fold's projected value; with the channel gone both are unreachable
 * shapes, and stating "there is a stored checkpoint" in the type is stronger
 * than re-deriving it here and re-answering a question the caller settled.
 */
function editableEntryOf(
  descriptor: RunDetailDescriptorView | undefined,
  authority: RunRecord,
  stored: RunCheckpointRecord,
  label: string,
  source: { nodeId: string; fieldPath: string },
): ContextDataEntry {
  // D252 — the origin is a DESCRIPTOR fact, so it is served on every arm
  // below: "which step owns this value" is exactly the question a locked row
  // makes more pressing.
  const attribution = originOf(descriptor, source.nodeId, source.fieldPath);
  // Dated once, for EVERY arm below: a locked row is as much a recorded fact
  // as an editable one, and "when was this observed" is the question the lock
  // makes more pressing rather than less.
  const provenance = provenanceFor(stored, source.fieldPath);
  const lookup = scalarAtPath(stored.output.value, source.fieldPath);
  if (lookup.kind === "absent") {
    return {
      label,
      valueRedacted: "not recorded on this outcome",
      edit: {
        state: "locked",
        reason: `the recorded outcome carries no ${source.fieldPath} — there is no stored value to correct`,
      },
      ...provenance,
      ...attribution,
    };
  }
  if (lookup.kind === "not-scalar") {
    return {
      label,
      valueRedacted: "structured value",
      edit: {
        state: "locked",
        reason: "not a single text/number value; structured output is corrected by a new run, not a field edit",
      },
      ...provenance,
      ...attribution,
    };
  }
  const pending = pendingCorrectionOf(authority, source);
  if (pending.state === "not-scalar") {
    return {
      label,
      valueRedacted: displayScalar(lookup.value),
      edit: {
        state: "locked",
        reason: "a pending correction holds a structured value; it applies when the run resumes",
      },
      ...provenance,
      ...attribution,
    };
  }
  return {
    label,
    valueRedacted: displayScalar(lookup.value),
    edit: {
      state: "editable",
      nodeId: source.nodeId,
      fieldPath: source.fieldPath,
      value: lookup.value,
      pendingCorrection: pending,
    },
    ...provenance,
    ...attribution,
  };
}

function buildContextDataPayload(
  deps: RunDetailQueryDeps,
  row: RunFoldRecord,
  authority: RunRecord,
): { runId: string; editing: ContextDataEditing; entries: ContextDataEntry[] } {
  const descriptor = deps.descriptors.resolve(row.queued.workflow);
  const editing = contextEditingOf(authority, descriptor);
  const editData = descriptor?.capabilities?.editData;
  const editFields = typeof editData === "object" ? editData.fields : [];
  const entries: ContextDataEntry[] = [];
  for (const field of editFields) {
    const stored = deps.authority.latestCheckpoint(
      row.queued.workflow,
      authority.envelope.itemId,
      String(field.nodeId),
    );
    // The Data section lists values the run TOUCHED (ref dashboard-surfaces §1.1(c)); a
    // declared-correctable field whose step never recorded is not among them.
    if (stored === undefined) continue;
    entries.push(editableEntryOf(
      descriptor,
      authority,
      stored,
      field.label,
      { nodeId: String(field.nodeId), fieldPath: field.fieldPath },
    ));
  }
  return { runId: authority.envelope.runId, editing, entries };
}

export function buildDataSection(
  deps: RunDetailQueryDeps,
  runId: string,
  section: "context-data" | "context-attempts",
): RunDetailSectionResponse {
  const { row, authority } = requireRun(deps, runId);
  if (section === "context-data") {
    // The descriptor-declared detail patches ARE the display-safe data facts
    // (ref dashboard-surfaces §1.1), joined back to their declaring specs for field identity;
    // the descriptor's editData fields extend them with the raw checkpoint
    // scalars a correction targets (ref data-intake-and-edit-data §6, 2i-C).
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: buildContextDataPayload(deps, row, authority),
    });
  }

  return RunDetailSectionResponseSchema.parse({
    section,
    payload: {
      runId,
      entries: [
        { label: "current-attempt", valueRedacted: String(row.attempt) },
        { label: "requeues", valueRedacted: String(row.requeues) },
        { label: "enqueued-day", valueRedacted: localDatePart(new Date(row.queued.ts)) },
      ],
    },
  });
}

export function createDataQueries(deps: RunDetailQueryDeps) {
  return {
    contextData: (runId: string) => buildDataSection(deps, runId, "context-data"),
    contextAttempts: (runId: string) => buildDataSection(deps, runId, "context-attempts"),
    canonical: deps.canonical,
    source: deps,
  };
}
