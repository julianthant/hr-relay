import { LogIdentityRefusedError } from "../commands/refusals.js";
import { readTimelineRecords, timelineNoteLocation } from "../../storage/events/timeline-reader.js";
import { RedactedFieldSchema } from "../../../rules/redaction/redaction.js";
import { z } from "zod";
import {
  LogPageCursorSchema,
  ObservedLogRowWireSchema,
  LogRowWireSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../models/dashboard/run-detail.js";
import {
  RunOperationStructureWireSchema,
  type RunOperationStructureWire,
} from "../../../models/dashboard/operation-structure.js";
import type { RunRecord } from "../../../models/run/record.js";
import { requireWorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import type { TimelineLine } from "../../storage/events/timeline-reader.js";
import {
  NoteWireSchema as NoteAtRestSchema,
  projectNoteForOperator,
  type SpanEventWire,
} from "../../../models/events/types.js";
import type { RunFoldRecord } from "../projections/run-queue-projection.js";
import { deterministicUuid, nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { DeclaredActionIdentitySchema } from "../../../models/workflow/operation-action-identity.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView } from "./run-detail-types.js";

const LOGS_PAGE_SIZE = 200;

const LEVEL_MAP = { error: "error", warn: "warning", waiting: "warning", step: "info", success: "info", debug: "info" } as const;

/** One parseable line that the selected run owns, before the query assigns page sequence. */
type RunAtRestNote = Readonly<{
  runId: string;
  attempt: number;
  traceId: string;
  spanPath: string;
  ts: string;
  level: "error" | "warn" | "waiting" | "step" | "success" | "debug";
  message: string;
  fields?: z.infer<typeof NoteAtRestSchema>["fields"];
  action?: z.infer<typeof NoteAtRestSchema>["action"];
  confirmedAction?: z.infer<typeof NoteAtRestSchema>["confirmedAction"];
}>;

type RunLogProducer = Readonly<{ nodeId: string; step: string; taskId: string; system?: string }>;

export type RunLogScanEntry =
  | Readonly<{ kind: "note"; line: TimelineLine; note: RunAtRestNote }>
  | Readonly<{ kind: "observed"; line: TimelineLine; event: Extract<SpanEventWire, { t: "data.observed" }>; producer: RunLogProducer }>
  | Readonly<{ kind: "transaction-fenced"; line: TimelineLine; event: Extract<SpanEventWire, { t: "transaction.fenced" }>; producer: RunLogProducer }>;

/** @deprecated Kept for callers of the combined notes + fence snapshot cache. */
export type RunNoteScanEntry = RunLogScanEntry;

// Page a run against one immutable combined-log snapshot so advancing cursors cannot mix reads.
interface RunLogSnapshot {
  readonly id: string;
  readonly entries: readonly RunLogScanEntry[];
}

export interface RunNoteScanCache {
  start(runId: string, scan: () => readonly RunLogScanEntry[]): RunLogSnapshot;
  resume(runId: string, snapshotId: string): RunLogSnapshot;
}

export function createRunNoteScanCache(): RunNoteScanCache {
  const snapshots = new Map<string, Readonly<{ runId: string; snapshot: RunLogSnapshot }>>();
  const hold = (runId: string, entries: readonly RunLogScanEntry[]): RunLogSnapshot => {
    const id = sha256Hex(
      `hrauto:run-log-snapshot:v1\0${runId}\0${entries.map((entry) => `${logIdOf(entry)}\0${entry.line.text}`).join("\n")}`,
    );
    const snapshot = Object.freeze({ id, entries: Object.freeze([...entries]) });
    snapshots.delete(id);
    snapshots.set(id, Object.freeze({ runId, snapshot }));
    const oldest = snapshots.size > 128 ? snapshots.keys().next().value : undefined;
    if (oldest !== undefined) snapshots.delete(oldest);
    return snapshot;
  };
  return Object.freeze({
    start(runId: string, scan: () => readonly RunLogScanEntry[]): RunLogSnapshot {
      return hold(runId, scan());
    },
    resume(runId: string, snapshotId: string): RunLogSnapshot {
      const held = snapshots.get(snapshotId);
      if (held === undefined) {
        throw new Error(`log snapshot ${snapshotId} for run ${runId} is unavailable or expired; restart from the first page`);
      }
      if (held.runId !== runId) {
        throw new Error(`log snapshot ${snapshotId} belongs to run ${held.runId}, not requested run ${runId}`);
      }
      return held.snapshot;
    },
  });
}

const defaultLogSnapshots = new WeakMap<RunDetailQueryDeps, RunNoteScanCache>();

function logSnapshotsFor(deps: RunDetailQueryDeps, provided?: RunNoteScanCache): RunNoteScanCache {
  if (provided !== undefined) return provided;
  const held = defaultLogSnapshots.get(deps);
  if (held !== undefined) return held;
  const created = createRunNoteScanCache();
  defaultLogSnapshots.set(deps, created);
  return created;
}


function parseNoteLine(line: TimelineLine): z.infer<typeof NoteAtRestSchema> {
  try {
    return NoteAtRestSchema.parse(JSON.parse(line.text));
  } catch (cause) {
    throw new Error(
      `notes line ${line.file.path}:${String(line.lineNumber)} is not a readable note `
      + `(${cause instanceof Error ? cause.message : String(cause)}); the logs reader refuses to read around a line `
      + "the corpus holds, because a skipped line reports real history as absent",
      { cause },
    );
  }
}

function assertScopedSpanWorkflow(
  event: Extract<SpanEventWire, { runId: string }>,
  line: TimelineLine,
): void {
  if (event.workflow !== line.file.workflow) {
    throw new Error(
      `spans line ${line.file.path}:${String(line.lineNumber)} is filed in workflow ${line.file.workflow} but names `
      + `workflow ${event.workflow}; refusing a span whose durable partition and identity disagree`,
    );
  }
}

function assertRunLogIdentity(
  source: "note" | "span",
  identity: Readonly<{ runId: string; workflow: string; traceId: string; attempt: number }>,
  line: TimelineLine,
  runId: string,
  _row: RunFoldRecord | undefined,
  authority: RunRecord,
): void {
  const location = `${source}s line ${line.file.path}:${String(line.lineNumber)}`;
  if (identity.runId !== runId) {
    throw new Error(`${location} was indexed for run ${runId} but names run ${identity.runId}`);
  }
  if (identity.workflow !== authority.envelope.workflow) {
    throw new Error(
      `${location} for run ${runId} names workflow ${identity.workflow}, but authority names ${authority.envelope.workflow}`,
    );
  }
  if (identity.traceId !== authority.envelope.traceId) {
    throw new Error(
      `${location} for run ${runId} names ${source} trace ${identity.traceId}, but authority trace is ${authority.envelope.traceId}`,
    );
  }
  // Attempts are item-scoped and requeues advance them. The canonical row
  // bounds history; a missing/stale fold cannot reduce the admitted range.
  const firstAttempt = 1;
  const lastAttempt = authority.envelope.attempt;
  if (identity.attempt < firstAttempt || identity.attempt > lastAttempt) {
    throw new Error(
      `${location} for run ${runId} names attempt ${String(identity.attempt)}, outside the run's legal attempts `
      + `${String(firstAttempt)}..${String(lastAttempt)}`,
    );
  }
}

function producerOf(
  descriptor: RunDetailDescriptorView | undefined,
  event: Extract<SpanEventWire, { t: "data.observed" | "transaction.fenced" }>,
  line: TimelineLine,
): RunLogProducer {
  if (descriptor === undefined) {
    throw new Error(
      `spans line ${line.file.path}:${String(line.lineNumber)} cannot resolve system for ${event.t} node ${event.t === "data.observed" ? event.nodeId : event.node} `
      + `task ${event.taskId}: workflow ${event.workflow} has no descriptor view`,
    );
  }
  const nodeId = event.t === "data.observed" ? event.nodeId : event.node;
  const matches = (descriptor.dataOrigins ?? []).filter((origin) =>
    origin.nodeId === nodeId && origin.taskId === event.taskId);
  if (matches.length !== 1) {
    throw new Error(
      `spans line ${line.file.path}:${String(line.lineNumber)} cannot resolve one system for ${event.t} node ${nodeId} `
      + `task ${event.taskId}: descriptor has ${String(matches.length)} matching data origins`,
    );
  }
  const origin = matches[0];
  if (origin === undefined) {
    throw new Error(
      `spans line ${line.file.path}:${String(line.lineNumber)} cannot resolve producer for ${event.t} node ${nodeId} `
      + `task ${event.taskId}: its matching descriptor data origin disappeared`,
    );
  }
  return {
    nodeId: origin.nodeId,
    step: origin.step,
    taskId: origin.taskId,
    ...(origin.system === undefined ? {} : { system: origin.system }),
  };
}

function logLinesForRun(
  deps: RunDetailQueryDeps,
  row: RunFoldRecord | undefined,
  authority: RunRecord,
  runId: string,
): readonly RunLogScanEntry[] {
  const scan = (): readonly RunLogScanEntry[] => {
    const matches: RunLogScanEntry[] = [];

    for (const record of readTimelineRecords(deps.timeline, 0, runId).records) {
      if (record.payload.kind !== "note") continue;
      const line = timelineNoteLocation(record);
      const note = parseNoteLine(line);
      if (note.workflow !== line.file.workflow) {
        throw new Error(
          `notes line ${line.file.path}:${String(line.lineNumber)} is filed in workflow ${line.file.workflow} but names `
          + `workflow ${note.workflow}; refusing a note whose durable partition and identity disagree`,
        );
      }
      if ("runId" in note && note.runId === runId) {
        assertRunLogIdentity("note", note, line, runId, row, authority);
        const projected = projectNoteForOperator(note);
        if (!("runId" in projected)) {
          throw new Error(`notes line ${line.file.path}:${String(line.lineNumber)} changed identity during projection`);
        }
        matches.push({
          kind: "note",
          line,
          note: {
            runId: projected.runId,
            attempt: projected.attempt,
            traceId: projected.traceId,
            spanPath: projected.spanPath,
            ts: projected.ts,
            level: projected.level,
            message: projected.message,
            fields: projected.fields,
            action: projected.action,
            confirmedAction: projected.confirmedAction,
          },
        });
      }
    }
    const descriptor = deps.descriptors.resolve(authority.envelope.workflow);
    for (const { line, event } of deps.projection.runLogSnapshot(runId).entries) {
      if (event.t !== "transaction.fenced") continue;
      assertScopedSpanWorkflow(event, line);
      assertRunLogIdentity("span", event, line, runId, row, authority);
      matches.push({ kind: "transaction-fenced", line, event, producer: producerOf(descriptor, event, line) });
    }
    return matches.sort((left, right) => left.line.lineNumber - right.line.lineNumber);
  };
  return scan();
}

/** The durable observations are Run data. Logs reads only action notes and fence beats. */
export function runDataObservationsForRun(
  deps: RunDetailQueryDeps,
  authority: RunRecord,
  runId: string,
): readonly z.infer<typeof ObservedLogRowWireSchema>[] {
  const row = deps.projection.runFold(runId);
  const descriptor = deps.descriptors.resolve(authority.envelope.workflow);
  const observed: RunLogScanEntry[] = [];
  for (const { line, event } of deps.projection.runLogSnapshot(runId).entries) {
    if (event.t !== "data.observed") continue;
    assertScopedSpanWorkflow(event, line);
    assertRunLogIdentity("span", event, line, runId, row, authority);
    const points = event.points.map((point) => ({ ...point,
      values: point.values.map((value) => RedactedFieldSchema.parse(value)),
    }));
    observed.push({ kind: "observed", line, event: { ...event, points }, producer: producerOf(descriptor, event, line) });
  }
  // The projection already holds SQLite ingestion order. Stable sort keeps that
  // order for equal observation clocks, including across different day files.
  observed.sort((left, right) => logInstantOf(left).localeCompare(logInstantOf(right)));
  return observed.map((entry, sequence) => ObservedLogRowWireSchema.parse(logRowOf(entry, sequence)));
}

function logInstantOf(entry: RunLogScanEntry): string {
  if (entry.kind === "note") return entry.note.ts;
  return entry.kind === "observed" ? entry.event.observedAt : entry.event.ts;
}

function logIdOf(entry: RunLogScanEntry): string {
  return deterministicUuid(`log:${entry.line.file.path}:${String(entry.line.lineNumber)}`);
}

function logRowOf(
  entry: RunLogScanEntry,
  sequence: number,
): unknown {
  const logId = logIdOf(entry);
  const identity = entry.kind === "note" ? entry.note : entry.event;
  const native = { eventId: entry.line.file.path.replace(/^timeline:/u, ""), order: entry.line.lineNumber,
    runId: identity.runId, attempt: identity.attempt, traceId: identity.traceId, spanPath: identity.spanPath,
    ...(entry.kind === "note" ? (entry.note.action?.operation === undefined && entry.note.confirmedAction === undefined && entry.note.action?.kind !== "screenshot" ? {} : { nodeId: entry.note.action?.operation?.nodeId ?? entry.note.confirmedAction?.action.nodeId ?? nodeIdOfTaskSpanPath(entry.note.spanPath) }) : { nodeId: entry.producer.nodeId }) };
  if (entry.kind === "note") {
    let screenshot;
    if (entry.note.action?.kind === "screenshot" && entry.note.action.targetId.endsWith(".task-capture")) {
      const association = z.templateLiteral([z.uuid(), ":", z.uuid()]).safeParse(entry.note.action.value);
      if (!association.success || entry.note.action.physicalSessionId === undefined || native.nodeId === undefined) {
        throw new LogIdentityRefusedError("RUN_LOG_SCREENSHOT_IDENTITY_MISMATCH");
      }
      const [bundleId, artifactId] = association.data.split(":");
      screenshot = { bundleId, artifactId, sessionId: entry.note.action.physicalSessionId };
    }
    return {
      kind: "note",
      native,
      logId,
      sequence,
      note: {
        native,
        noteId: logId,
        runId: entry.note.runId,
        sequence,
        at: entry.note.ts,
        level: LEVEL_MAP[entry.note.level],
        message: entry.note.message,
        ...(screenshot === undefined ? {} : { screenshot }),
        ...(entry.note.fields === undefined ? {} : { fields: entry.note.fields }),
      },
    };
  }
  if (entry.kind === "observed") {
    return {
      kind: "observed",
      native,
      logId,
      sequence,
      at: entry.event.observedAt,
      attempt: entry.event.attempt,
      traceId: entry.event.traceId,
      spanPath: entry.event.spanPath,
      producer: entry.producer,
      points: entry.event.points,
    };
  }
  return {
    kind: "transaction-fenced",
    native,
    logId,
    sequence,
    at: entry.event.ts,
    attempt: entry.event.attempt,
    traceId: entry.event.traceId,
    spanPath: entry.event.spanPath,
    producer: entry.producer,
  };
}

function projectActionOccurrence(
  definition: NonNullable<RunRecord["envelope"]["operationDisplaySnapshot"]>,
  occurrence: NonNullable<RunAtRestNote["action"]>["operation"] extends infer Value
    ? Exclude<Value, undefined>
    : never,
) {
  const { value, ...identity } = occurrence;
  const invocation = definition.invocations.find((candidate) => candidate.id === occurrence.invocationId);
  const slot = invocation?.operation.values.find((candidate) => candidate.id === value?.slot);
  return {
    ...identity,
    ...(value === undefined ? {} : {
      value: {
        slot: value.slot,
        fieldPath: value.fieldPath,
        producer: value.producer,
        ...(value.consumed.state === "withheld"
          ? { state: "withheld" as const, reason: value.consumed.reason }
          : value.consumed.state === "redacted"
          ? { state: "redacted" as const, binding: value.consumed.binding }
          : slot?.presentation === "local-operator"
            ? { state: "observed" as const, classification: "local-operator" as const, value: value.consumed.value }
            : {
            state: "withheld" as const,
            reason: "raw action value has no approved Logs presentation classification",
          }),
      },
    }),
  };
}

// Only the run envelope supplies frozen definition authority for declared-action notes.
export function operationStructureForRun(
  authority: RunRecord,
  runId: string,
  entries: readonly RunLogScanEntry[],
): RunOperationStructureWire {
  const stored = authority.envelope.operationDisplaySnapshot;
  if (stored === undefined) {
    if (authority.envelope.operationDisplayCapability === "complete") {
      throw new Error(`complete run ${authority.envelope.workflow} is missing its frozen operation display snapshot`);
    }
    return RunOperationStructureWireSchema.parse({
      state: "legacy",
      reason: "this historical run has no frozen complete operation structure",
    });
  }
  const definition = requireWorkflowOperationDisplaySnapshot(stored, {
    workflowId: authority.envelope.workflow,
    definitionFingerprint: authority.envelope.contractFingerprint,
  });
  const observations = entries.flatMap((entry) => {
    if (entry.kind !== "note" || entry.note.action?.operation === undefined) return [];
    return [{
      logId: logIdOf(entry),
      at: entry.note.ts,
      action: entry.note.action.kind,
      targetId: entry.note.action.targetId,
      occurrence: projectActionOccurrence(definition, entry.note.action.operation),
    }];
  });
  return RunOperationStructureWireSchema.parse({
    state: "observed",
    runId,
    definition,
    observations,
  });
}

export function buildRunLogsSection(
  deps: RunDetailQueryDeps,
  runId: string,
  row: RunFoldRecord | undefined,
  authority: RunRecord,
  cursorInput?: string,

  noteScanCache?: RunNoteScanCache,
): RunDetailSectionResponse {
  const section = "logs";
  const snapshots = logSnapshotsFor(deps, noteScanCache);
  let offset = 0;
  let snapshot: RunLogSnapshot;
  if (cursorInput === undefined) {
    snapshot = snapshots.start(runId, () => logLinesForRun(deps, row, authority, runId));
  } else {
    const cursor = LogPageCursorSchema.parse(cursorInput);
    const [, snapshotId, offsetText] = cursor.split(":");
    if (snapshotId === undefined || offsetText === undefined) throw new Error(`log cursor ${cursor} is incomplete`);
    offset = Number(offsetText);
    snapshot = snapshots.resume(runId, snapshotId);
  }
  const all = snapshot.entries;
  const page = all.slice(offset, offset + LOGS_PAGE_SIZE);
  const actionIdentity = (action: NonNullable<RunAtRestNote["action"]>["operation"] | NonNullable<RunAtRestNote["confirmedAction"]>["action"]) => {
    if (action === undefined) throw new LogIdentityRefusedError("RUN_LOG_ACTION_IDENTITY_MISSING");
    const { value: _value, ...identity } = action;
    return canonicalJsonStringify(DeclaredActionIdentitySchema.parse(identity));
  };
  const bindings = page.flatMap((entry) => {
    if (entry.kind !== "note" || entry.note.confirmedAction === undefined) return [];
    const event = entry.note.confirmedAction;
    const identity = actionIdentity(event.action);
    const matches = all.filter((candidate) => candidate.kind === "note" && candidate.note.action?.operation !== undefined
      && actionIdentity(candidate.note.action.operation) === identity);
    if (matches.length !== 1) throw new LogIdentityRefusedError("RUN_LOG_ACTION_TARGET_IDENTITY_MISMATCH");
    const target = matches[0];
    if (target === undefined) throw new LogIdentityRefusedError("RUN_LOG_ACTION_TARGET_IDENTITY_MISMATCH");
    if (target.kind !== "note" || target.note.runId !== entry.note.runId || target.note.attempt !== entry.note.attempt
      || target.note.traceId !== entry.note.traceId) throw new LogIdentityRefusedError("RUN_LOG_ACTION_TARGET_OWNER_MISMATCH");
    return [{ eventId: event.eventId, logId: logIdOf(target), native: {
      eventId: entry.line.file.path.replace(/^timeline:/u, ""), order: entry.line.lineNumber,
      runId: entry.note.runId, attempt: entry.note.attempt, traceId: entry.note.traceId,
      spanPath: entry.note.spanPath, nodeId: event.action.nodeId,
    } }];
  });
  const rows = page.map((entry, index) => LogRowWireSchema.parse(logRowOf(
    entry,
    offset + index,
  )));
  return RunDetailSectionResponseSchema.parse({
    section,
    payload: {
      runId,
      operationStructure: operationStructureForRun(authority, runId, page),
      rows,
      confirmedActionBindings: bindings,
      notes: rows.flatMap((row) => row.kind === "note" ? [row.note] : []),
      confirmedActions: page.flatMap((entry) => entry.kind === "note" && entry.note.confirmedAction !== undefined
        ? [entry.note.confirmedAction] : []),
      nextCursor: offset + LOGS_PAGE_SIZE < all.length
        ? { state: "present", value: `lc:${snapshot.id}:${String(offset + LOGS_PAGE_SIZE)}` }
        : { state: "absent", reason: "end-of-page" },
    },
  });
}
