import { ObservedOperationStructureWireSchema } from "../../../models/dashboard/operation-structure.js";
/** Which tabs a run detail advertises, and which one opens. */
import { useCallback, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import {
  LogPageCursorSchema,
  type LogRowWire,
  type NotePageSchema,
} from "../../../models/dashboard/run-detail.js";

export type NotePage = z.infer<typeof NotePageSchema>;

/** A small, presentation-only value fact: the wire remains the evidence authority. */
export interface LogPill {
  readonly direction: "read" | "write";
  readonly label: string;
  readonly value: string;
}

/** A contiguous run of rows a sticky producer heading can truthfully name. */
export interface LogRowGroup {
  /** Notes have no producer and therefore no invented heading. */
  readonly label: string | undefined;
  readonly rows: readonly LogRowWire[];
}

/** Live pages must carry `rows`. The notes-only compatibility
 * shape belongs to frozen archive readers */
function requireLiveLogRows(page: NotePage, requestedCursor: string): readonly LogRowWire[] {
  if (page.rows === undefined) {
    throw new Error(
      `live log page for run ${String(page.runId)} at cursor ${requestedCursor} is missing rows`,
    );
  }
  return page.rows;
}

export function logRowsOf(page: NotePage | undefined, requestedCursor: string): readonly LogRowWire[] {
  if (page === undefined) return [];
  return requireLiveLogRows(page, requestedCursor).toSorted((left, right) => left.sequence - right.sequence);
}

function renderedRedactedValue(value: Extract<LogRowWire, { kind: "observed" }> ["points"][number]["values"][number]): string {
  if (value.rawValue !== undefined) return typeof value.rawValue === "string" ? value.rawValue : JSON.stringify(value.rawValue);
  if (value.state === "redacted") return "redacted";
  if (typeof value.value === "string") return value.value;
  if (typeof value.value === "number") return String(value.value);
  return JSON.stringify(value.value);
}

/** One displayed pill per redacted value fact, retaining its point direction. */
export function logPillsOf(row: LogRowWire): readonly LogPill[] {
  if (row.kind !== "observed") return [];
  return row.points.flatMap((point) => point.values.map((value) => ({
    direction: point.direction,
    label: `${point.field} · ${value.key}`,
    value: renderedRedactedValue(value),
  })));
}


export interface LogLedgerFact {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly items: readonly string[] | undefined;
}

/** A field's facts. `nested` is false only when the field IS its single key. */
export interface LogLedgerField {
  readonly field: string;
  readonly nested: boolean;
  readonly facts: readonly LogLedgerFact[];
}

/** One direction's fields, in served order. A row carries one section per direction it has. */
export interface LogLedgerSection {
  readonly direction: "read" | "write";
  readonly fields: readonly LogLedgerField[];
}

function renderedListItem(item: unknown): string {
  return typeof item === "string" ? item : JSON.stringify(item);
}

/** Preserve observed order; only contiguous rows sharing direction may fold into one section. */
export function logLedgerOf(row: LogRowWire): readonly LogLedgerSection[] {
  if (row.kind !== "observed") return [];
  const sections: { direction: "read" | "write"; fields: LogLedgerField[] }[] = [];
  for (const point of row.points) {
    const facts = point.values.map((value): LogLedgerFact => {
      const prefix = `${point.field}.`;
      const key = value.key.startsWith(prefix) ? value.key.slice(prefix.length) : value.key;
      const itemValue = value.rawValue !== undefined ? value.rawValue : (value.state === "allowed" ? value.value : undefined);
      const items = Array.isArray(itemValue)
        ? itemValue.map(renderedListItem)
        : undefined;
      return { key, label: `${point.field} · ${value.key}`, value: renderedRedactedValue(value), items };
    });
    const nested = !(facts.length === 1 && facts[0]?.key === point.field);
    const field: LogLedgerField = { field: point.field, nested, facts };
    const last = sections.at(-1);
    if (last !== undefined && last.direction === point.direction) {
      last.fields.push(field);
    } else {
      sections.push({ direction: point.direction, fields: [field] });
    }
  }
  return sections;
}

/** The exact search contract: note prose, or an observed pill's label/value. */
export function rowMatchesLogQuery(row: LogRowWire, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return false;
  if (row.kind === "note") return [row.note.message, ...(row.note.fields ?? []).map((field) => `${field.key} ${String(field.value)}`)]
    .some((value) => value.toLocaleLowerCase().includes(normalized));
  return logPillsOf(row).some((pill) => `${pill.label} ${pill.value}`.toLocaleLowerCase().includes(normalized));
}

function groupLabelOf(row: LogRowWire): string | undefined {
  if (row.kind === "note") return undefined;
  return `${row.producer.step} · ${row.producer.taskId}`;
}

/** Group contiguous producer rows only; merging later repeats would reorder intervening evidence. */
export function groupLogRows(rows: readonly LogRowWire[]): readonly LogRowGroup[] {
  const groups: { label: string | undefined; rows: LogRowWire[] }[] = [];
  for (const row of rows) {
    const label = groupLabelOf(row);
    const last = groups.at(-1);
    if (last !== undefined && last.label === label) {
      last.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }
  return groups;
}

interface LogCursorIdentity {
  readonly digest: string;
  readonly offset: number;
}

function logCursorIdentity(cursor: string, runId: NotePage["runId"]): LogCursorIdentity {
  const parsed = LogPageCursorSchema.safeParse(cursor);
  if (!parsed.success) {
    throw new Error(`log continuation for run ${String(runId)} has invalid live cursor ${cursor}`);
  }
  const [, digest, offsetText] = parsed.data.split(":");
  if (digest === undefined || offsetText === undefined) {
    throw new Error(`log continuation for run ${String(runId)} has incomplete live cursor ${cursor}`);
  }
  return { digest, offset: Number(offsetText) };
}

/** Append evidence unchanged; duplicate sequences indicate a cursor defect, never permission to drop rows. */
export function appendLogPage(page: NotePage, requestedCursor: string, next: NotePage): NotePage {
  if (page.nextCursor.state !== "present" || page.nextCursor.value !== requestedCursor) {
    const ownedCursor = page.nextCursor.state === "present" ? page.nextCursor.value : page.nextCursor.reason;
    throw new Error(
      `cannot append cursor ${requestedCursor}: current run ${String(page.runId)} owns ${ownedCursor}`,
    );
  }
  if (page.runId !== next.runId) throw new Error(`cannot append logs for ${String(next.runId)} to ${String(page.runId)}`);
  const requested = logCursorIdentity(requestedCursor, page.runId);
  if (next.nextCursor.state === "present") {
    const returned = logCursorIdentity(next.nextCursor.value, page.runId);
    if (returned.digest !== requested.digest) {
      throw new Error(
        `log continuation for run ${String(page.runId)} at cursor ${requestedCursor} returned snapshot digest `
        + `${returned.digest}; expected ${requested.digest}`,
      );
    }
  }
  const existing = logRowsOf(page, `current-before-${requestedCursor}`);
  const appended = requireLiveLogRows(next, requestedCursor);
  const seen = new Set(existing.map((row) => row.sequence));
  let previousSequence = requested.offset - 1;
  const currentLastRow = existing.at(-1);
  if (currentLastRow !== undefined && currentLastRow.sequence > previousSequence) {
    previousSequence = currentLastRow.sequence;
  }
  for (const row of appended) {
    if (seen.has(row.sequence)) throw new Error(`duplicate log sequence ${String(row.sequence)} in append page`);
    if (previousSequence !== undefined && row.sequence <= previousSequence) {
      throw new Error(
        `log continuation for run ${String(page.runId)} at cursor ${requestedCursor} must strictly increase `
        + `after sequence ${String(previousSequence)}; received ${String(row.sequence)}`,
      );
    }
    seen.add(row.sequence);
    previousSequence = row.sequence;
  }
  const rows = [...existing, ...appended];
  const notes = rows.flatMap((row) => row.kind === "note" ? [row.note] : []);
  const left = page.operationStructure;
  const right = next.operationStructure;
  if (left?.state !== right?.state || (left?.state === "observed" && right?.state === "observed" && left.definition.contentDigest !== right.definition.contentDigest)) throw new Error("log-operation-frozen-definition-mismatch");
  const operationStructure = left?.state === "observed" && right?.state === "observed"
    ? ObservedOperationStructureWireSchema.parse({ ...left, observations: [...left.observations, ...right.observations] }) : left;
  const confirmedActions = page.confirmedActions === undefined || next.confirmedActions === undefined
    ? undefined : [...page.confirmedActions, ...next.confirmedActions];
  if (confirmedActions !== undefined && new Set(confirmedActions.map(action => action.eventId)).size !== confirmedActions.length) {
    throw new Error("log-confirmed-action-duplicate");
  }
  const confirmedActionBindings = page.confirmedActionBindings === undefined || next.confirmedActionBindings === undefined
    ? undefined : [...page.confirmedActionBindings, ...next.confirmedActionBindings];
  if (confirmedActionBindings !== undefined && new Set(confirmedActionBindings.map(binding => binding.eventId)).size !== confirmedActionBindings.length) {
    throw new Error("log-confirmed-action-binding-duplicate");
  }
  return { runId: page.runId, rows, notes, ...(confirmedActionBindings === undefined ? {} : { confirmedActionBindings }), ...(confirmedActions === undefined ? {} : { confirmedActions }), nextCursor: next.nextCursor, ...(operationStructure === undefined ? {} : { operationStructure }) };
}

export interface LogPagesState {
  readonly page: NotePage | undefined;
  readonly loading: boolean;
  readonly error: Error | undefined;
  readonly loadMore: () => void;
}

interface LogPageRequest {
  readonly ownerKey: string;
  readonly runId: string;
  readonly cursor: string;
}

interface LogPageSnapshot {
  readonly ownerKey: string;
  readonly page: NotePage | undefined;
  readonly request: LogPageRequest | undefined;
  readonly error: Error | undefined;
}

/** Retain displayed evidence while the next cursor page is loading or refused. */
export function useLogPages(
  initial: NotePage | undefined,
  load: (cursor: string) => Promise<NotePage>,
): LogPagesState {
  const initialKey = useMemo(() => {
    if (initial === undefined) return "absent";
    return [
      String(initial.runId),
      initial.nextCursor.state === "present" ? initial.nextCursor.value : initial.nextCursor.reason,
      ...logRowsOf(initial, "initial").map((row) => `${row.logId}:${String(row.sequence)}`),
    ].join("|");
  }, [initial]);
  const liveOwnerKey = useRef(initialKey);
  liveOwnerKey.current = initialKey;
  const [snapshot, setSnapshot] = useState<LogPageSnapshot>({
    ownerKey: initialKey,
    page: initial,
    request: undefined,
    error: undefined,
  });
  const current = useMemo<LogPageSnapshot>(() => (
    snapshot.ownerKey === initialKey
      ? snapshot
      : { ownerKey: initialKey, page: initial, request: undefined, error: undefined }
  ), [initial, initialKey, snapshot]);

  const loadMore = useCallback(() => {
    if (current.page?.nextCursor.state !== "present" || current.request !== undefined) return;
    const request: LogPageRequest = {
      ownerKey: initialKey,
      runId: String(current.page.runId),
      cursor: current.page.nextCursor.value,
    };
    setSnapshot({ ...current, request, error: undefined });
    const cursor = request.cursor;
    void load(cursor).then(
      (next) => {
        setSnapshot((settled) => {
          if (
            liveOwnerKey.current !== request.ownerKey
            || settled.ownerKey !== request.ownerKey
            || settled.request !== request
          ) return settled;
          if (settled.page === undefined) {
            return {
              ...settled,
              request: undefined,
              error: new Error(
                `log continuation for run ${request.runId} at cursor ${request.cursor} lost its current page`,
              ),
            };
          }
          try {
            return {
              ...settled,
              page: appendLogPage(settled.page, request.cursor, next),
              request: undefined,
              error: undefined,
            };
          } catch (caught) {
            return {
              ...settled,
              request: undefined,
              error: caught instanceof Error ? caught : new Error(String(caught)),
            };
          }
        });
      },
      (reason: unknown) => {
        setSnapshot((settled) => {
          if (
            liveOwnerKey.current !== request.ownerKey
            || settled.ownerKey !== request.ownerKey
            || settled.request !== request
          ) return settled;
          return {
            ...settled,
            request: undefined,
            error: reason instanceof Error ? reason : new Error("could not load more log lines"),
          };
        });
      },
    );
  }, [current, initialKey, load]);

  return {
    page: current.page,
    loading: current.request !== undefined,
    error: current.error,
    loadMore,
  };
}

/** The tab set this slice can draw. Review and People are advertised, not assumed. */
