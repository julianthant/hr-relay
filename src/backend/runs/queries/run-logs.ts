import { containsDryRunSample } from "../../../models/workflow/dry-run.js";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../../workflow-kit/workflow.js";
import { readRunPreviewResult } from "../../../models/run/result.js";
import { buildUiTaskLinks } from "../../systems/ui-task-links.js";
import { LogDisplayRefusedError, LogIdentityRefusedError } from "../commands/refusals.js";
import { readTimelineRecords, timelineNoteLocation } from "../../storage/events/timeline-reader.js";
import { RedactedFieldSchema } from "../../../rules/redaction/redaction.js";
import { z } from "zod";
import {
  DryRunPreviewWireSchema,
  LogPageCursorSchema,
  ObservedLogRowWireSchema,
  LogRowWireSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../models/dashboard/run-detail.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { TimelineLine } from "../../storage/events/timeline-reader.js";
import {
  NoteWireSchema as NoteAtRestSchema,
  projectNoteForOperator,
  type SpanEventWire,
} from "../../../models/events/types.js";
import type { RunFoldRecord } from "../projections/run-queue-projection.js";
import { deterministicUuid, nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { resolveObservationOrigin } from "../../../models/events/data-observation-origin.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView, RunDetailDataOriginView } from "./run-detail-types.js";

const LOGS_PAGE_SIZE = 200;
const UI_LABELS = new Map(buildUiTaskLinks().map(entry => [entry.id, entry]));

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

type RunLogProducer = Readonly<{ nodeId: string; step: string; taskId: string; system?: string; operatorFields?: RunDetailDataOriginView["operatorFields"] }>;

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
    ...(origin.operatorFields === undefined ? {} : { operatorFields: origin.operatorFields }),
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
      if (event.t === "data.observed") {
        assertScopedSpanWorkflow(event, line);
        assertRunLogIdentity("span", event, line, runId, row, authority);
        const producer = producerOf(descriptor, event, line);
        const entry = { kind: "observed" as const, line, event, producer };
        if (operatorFieldsOf(entry).length > 0) matches.push(entry);
        continue;
      }
      assertScopedSpanWorkflow(event, line);
      assertRunLogIdentity("span", event, line, runId, row, authority);
      matches.push({ kind: "transaction-fenced", line, event, producer: producerOf(descriptor, event, line) });
    }
    return matches.sort((left, right) => left.line.lineNumber - right.line.lineNumber);
  };
  return scan();
}

/** Run data retains every classified observation; Logs selects declared operator fields. */
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

function operatorFieldsOf(entry: Extract<RunLogScanEntry, { kind: "observed" }>) {
  const atPath = (value: unknown, path: readonly string[], order: readonly number[] = [], address: readonly (string | number)[] = []): readonly Readonly<{ observed: unknown; order: readonly number[]; address: readonly (string | number)[] }>[] => {
    if (Array.isArray(value)) return value.flatMap((member, index) => atPath(member, path, [...order, index], [...address, index]));
    if (path.length === 0) return [{ observed: value, order, address }];
    const [head, ...tail] = path;
    return head !== undefined && value !== null && typeof value === "object" && Object.hasOwn(value, head)
      ? atPath(Reflect.get(value, head), tail, order, [...address, head]) : [];
  };
  return entry.event.points.flatMap(point => point.values.flatMap(value =>
    (entry.producer.operatorFields ?? []).filter(field => field.kind === "output" &&
      (field.fieldPath === value.key || field.fieldPath.startsWith(`${value.key}.`))).flatMap(field => {
      const retained = value.state === "allowed" ? value.value : undefined;
      const values = value.state === "allowed" ? atPath(retained, field.fieldPath === value.key ? [] : field.fieldPath.slice(value.key.length + 1).split("."))
        : value.state === "redacted" && field.fieldPath === value.key ? [{ observed: "Redacted", order: [], address: [] }] : [];
      return values.flatMap(({ observed, order, address }) => {
        if (typeof observed !== "string" && typeof observed !== "number" && typeof observed !== "boolean") return [];
        const mapped = value.state === "allowed" && field.display !== undefined ? field.display.cases.find(entry => entry.value === observed) : undefined;
        if (value.state === "allowed" && field.display !== undefined && mapped === undefined) throw new LogDisplayRefusedError();
        const text = mapped?.text ?? String(observed);
        const pointAddress = [...(value.key === point.field ? [] : value.key.slice(point.field.length + 1).split(".")), ...address];
        const origin = resolveObservationOrigin(entry.event, point, pointAddress);
        return text.trim().length === 0 ? [] : [{ order, field: { direction: point.direction, label: field.label, value: text,
          ...(field.declaration === undefined ? {} : { causal: { declaration: field.declaration, origin } }),
          point: { direction: point.direction, field: field.fieldPath, values: [value.state === "allowed"
            ? { ...value, key: field.fieldPath, value: observed, rawValue: undefined }
            : { ...value, key: field.fieldPath, rawValue: undefined }] } } }];
      });
    }).sort((left, right) => {
      for (let index = 0; index < Math.max(left.order.length, right.order.length); index++) {
        const difference = (left.order[index] ?? -1) - (right.order[index] ?? -1);
        if (difference !== 0) return difference;
      }
      return 0;
    }).map(({ field }) => field)));

}

function operatorActionOf(note: RunAtRestNote) {
  const action = note.action;
  if (action === undefined) return undefined;
  const registered = UI_LABELS.get(action.targetId);
  const occurrence = action.operation;
  const kind = action.kind === "screenshot" ? "screenshot" as const
    : ["typed", "selected", "set", "cleared"].includes(action.kind) ? "fill" as const
      : ["read", "checked", "verified"].includes(action.kind) ? "read" as const
        : ["clicked", "pressed", "opened"].includes(action.kind) ? "click" as const : "action" as const;
  return { kind, label: kind === "screenshot" ? "Screenshot" : registered?.label ?? "Action label unavailable",
    ...(kind === "screenshot" ? {} : { registryLabel: true as const }),
    ...(action.physicalSessionId === undefined ? {} : { sessionId: action.physicalSessionId }),
    ...(registered === undefined ? {} : { system: registered.system }),
    ...(occurrence?.state === undefined ? {} : { state: occurrence.state }),
    ...(occurrence?.reason === undefined ? {} : { reason: occurrence.reason }),
  };
}

function logRowOf(
  entry: RunLogScanEntry,
  sequence: number,
  authority?: RunRecord,
  operatorOnly = false,
  unreadLabels: readonly string[] = [],
): unknown {
  const logId = logIdOf(entry);
  const identity = entry.kind === "note" ? entry.note : entry.event;
  const nodeId = entry.kind !== "note" ? entry.producer.nodeId
    : entry.note.action?.operation?.nodeId ?? entry.note.confirmedAction?.action.nodeId
      ?? (entry.note.action === undefined ? undefined : nodeIdOfTaskSpanPath(entry.note.spanPath));
  const native = { eventId: entry.line.file.path.replace(/^timeline:/u, ""), order: entry.line.lineNumber,
    runId: identity.runId, attempt: identity.attempt, traceId: identity.traceId, spanPath: identity.spanPath,
    ...(nodeId === undefined ? {} : { nodeId }) };
  if (entry.kind === "note") {
    const operatorAction = operatorActionOf(entry.note);
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
        message: operatorAction === undefined ? entry.note.message : operatorAction.kind === "screenshot"
          ? "Screenshot" : `${{ fill: "Fill", click: "Click", read: "Read", action: "Action" }[operatorAction.kind]}: ${operatorAction.label}`,
        ...(operatorAction === undefined ? {} : { operatorAction }),
        ...(screenshot === undefined ? {} : { screenshot }),
        ...(entry.note.fields === undefined ? {} : { fields: entry.note.fields }),
      },
    };
  }
  const { operatorFields: _operatorFields, ...producer } = entry.producer;
  if (entry.kind === "observed") {
    const fields = operatorOnly ? operatorFieldsOf(entry).map(field => authority?.envelope.dryRun && containsDryRunSample(field.value)
      ? { ...field, label: `dry-run sample: ${field.label}` } : field) : undefined;
    return {
      kind: "observed",
      native,
      logId,
      sequence,
      at: entry.event.observedAt,
      attempt: entry.event.attempt,
      traceId: entry.event.traceId,
      spanPath: entry.event.spanPath,
      producer,
      points: fields?.map(field => field.point) ?? entry.event.points,
      ...(fields === undefined ? {} : { displayFields: [...fields.map(({ point: _point, ...field }) => field),
        ...unreadLabels.map(label => ({ direction: "read" as const, label, unread: true as const }))] }),
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
    producer,
  };
}

function dryRunPreviewForLogs(deps: RunDetailQueryDeps, authority: RunRecord) {
  if (!authority.envelope.dryRun) return undefined;
  if (deps.canonical === undefined) return DryRunPreviewWireSchema.parse({ state: "unavailable", reason: "preview-authority-unavailable" });
  const result = deps.canonical.database.authority.runResults.get(authority.envelope.runId);
  const preview = result === undefined ? undefined : readRunPreviewResult(result);
  const descriptor = deps.canonical.descriptors.resolve(authority.envelope.workflow);
  if (result === undefined || preview === undefined) {
    const support = descriptor?.contractFingerprint === authority.envelope.contractFingerprint ? workflowDryRunSupport(descriptor) : undefined;
    if (authority.envelope.parent !== undefined && support?.state === "unsupported" && support.reason === "no-transaction-node") return undefined;
    return DryRunPreviewWireSchema.parse(authority.lifecycle.state !== "terminal" ? { state: "pending" }
      : { state: "unavailable", reason: authority.lifecycle.outcome === "done" ? "preview-result-unreadable" : "preview-not-completed" });
  }
  return DryRunPreviewWireSchema.parse({ state: "available", coverage: preview.coverage.state, stages: preview.steps.map((step, index) => {
    const node = descriptor?.contractFingerprint === result.contractFingerprint ? descriptorRuntimeNodes(descriptor).find(node => node.id === step.nodeId) : undefined;
    const label = node?.kind === "task" ? node.label ?? node.uses.title : node?.kind === "transaction" ? node.label ?? node.prepare.uses.title : String(step.nodeId);
    const state = step.state === "not-run" ? "skipped" : step.state === "unavailable" || step.state === "transaction-preview" && step.preview.outcome.state !== "would-prepare" ? "unavailable" : "exercised";
    const samples = step.state === "transaction-preview" ? step.samples : [];
    const detail = step.state === "delegation-preview" ? "Previewed child changes without saving."
      : step.state === "publication-preview" ? "Prepared and checked without saving." : step.state === "not-run" ? step.reason : step.state === "unavailable" ? "Requires an unsubmitted result; this stage was not exercised."
        : step.state === "transaction-preview" ? step.preview.outcome.state === "would-prepare" ? "Filled, verified and captured without submitting."
        : "Existing completion observed; the form was not staged." : "Completed from recorded workflow evidence.";
    return { id: step.nodeId, label, state,
      ...(step.state === "transaction-preview" && step.preview.outcome.state === "would-prepare" ? { submitNotClicked: true } : {}),
      detail: detail + (preview.coverage.state === "partial" && index === preview.steps.length - 1
        ? preview.coverage.reason === "historical-first-transaction-only" ? " Historical partial preview; later stages were not recorded."
          : " Delegated work was dispatched without waiting for its preview." : ""),
      ...(samples.length === 0 ? {} : { sample: { label: "dry-run sample", value: samples.map(sample => `${sample.field}: ${canonicalJsonStringify(sample.value)}`).join("; ") } }),
    };
  }) });
}

/** When the run failed on a read, the node's declared output fields it never observed in that attempt, carried on its last observed row. A read that observed nothing has no row to carry them. */
function unreadReadFields(deps: RunDetailQueryDeps, authority: RunRecord, entries: readonly RunLogScanEntry[]) {
  const { lifecycle } = authority;
  if (lifecycle.state !== "terminal" || lifecycle.outcome !== "failed" || lifecycle.failureId === undefined) return undefined;
  const failure = deps.trust?.getFailure(lifecycle.failureId);
  if (failure?.nodeId === undefined || failure.taskId === undefined) return undefined;
  const origin = deps.descriptors.resolve(authority.envelope.workflow)?.dataOrigins
    ?.find(entry => entry.nodeId === failure.nodeId && entry.taskId === failure.taskId);
  if (origin?.dir !== "read") return undefined;
  const observed = entries.filter((entry): entry is Extract<RunLogScanEntry, { kind: "observed" }> => entry.kind === "observed"
    && entry.producer.nodeId === failure.nodeId && entry.producer.taskId === failure.taskId && entry.event.attempt === failure.attempt);
  const last = observed.at(-1);
  if (last === undefined) return undefined;
  const keys = observed.flatMap(entry => entry.event.points.flatMap(point => point.values.map(({ key }) => key)));
  const outputs = (last.producer.operatorFields ?? []).filter(field => field.kind === "output");
  const seen = new Set(outputs.filter(field => keys.some(key => field.fieldPath === key || field.fieldPath.startsWith(`${key}.`)))
    .map(({ label }) => label));
  const labels = [...new Set(outputs.map(({ label }) => label))].filter(label => !seen.has(label));
  return labels.length === 0 ? undefined : { logId: logIdOf(last), labels };
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
  const unread = unreadReadFields(deps, authority, all);
  const rows = page.map((entry, index) => LogRowWireSchema.parse(logRowOf(
    entry,
    offset + index,
    authority,
    true,
    unread?.logId === logIdOf(entry) ? unread.labels : [],
  )));
  return RunDetailSectionResponseSchema.parse({
    section,
    payload: {
      runId,
      ...(authority.envelope.dryRun ? { dryRunPreview: dryRunPreviewForLogs(deps, authority) } : {}),
      rows,
      notes: rows.flatMap((row) => row.kind === "note" ? [row.note] : []),
      nextCursor: offset + LOGS_PAGE_SIZE < all.length
        ? { state: "present", value: `lc:${snapshot.id}:${String(offset + LOGS_PAGE_SIZE)}` }
        : { state: "absent", reason: "end-of-page" },
    },
  });
}
