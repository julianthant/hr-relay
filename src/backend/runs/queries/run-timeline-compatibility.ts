import type { TimelineEventRecord } from "../../../models/events/timeline.js";
import type { NoteWire } from "../../../models/events/types.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { DeclaredActionOccurrence } from "../../../rules/workflow/task-provenance.js";
import type { RunFoldRecord } from "../projections/run-queue-projection.js";
import { LogIdentityRefusedError } from "../commands/refusals.js";
import { nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import { readTimelineRecords } from "../../storage/events/timeline-reader.js";
import type { RunDetailDescriptorView, RunDetailQueryDeps } from "./run-detail-types.js";

export type RunTimelineEvidenceSource = Pick<RunDetailQueryDeps, "timeline"> & {
  authority: Pick<RunDetailQueryDeps["authority"], "listCheckpoints" | "listGateResults">;
};
type RecordedAction = NonNullable<NonNullable<NoteWire["action"]>["operation"]> | DeclaredActionOccurrence;

export function assertRunTimelineCompatible(
  run: RunRecord,
  timeline: RunDetailDescriptorView["timeline"],
  source: RunTimelineEvidenceSource,
  row?: RunFoldRecord,
  records?: readonly TimelineEventRecord[],
): void {
  if (timeline === undefined) return;
  const categories = new Map<string, string | null>();
  for (const category of timeline) {
    if (category.key === undefined) throw new LogIdentityRefusedError("timeline category identity is missing");
    for (const node of category.nodes) categories.set(node.id, categories.has(node.id) ? null : category.key);
  }
  const node = (id: string | undefined) => {
    if (id === undefined || categories.get(id) === undefined || categories.get(id) === null) {
      throw new LogIdentityRefusedError("timeline node has no unique declared category");
    }
  };
  const identity = (value: Readonly<{ runId: string; nodeId: string }> | undefined) => {
    if (value?.runId === run.envelope.runId) node(value.nodeId);
  };
  const action = (value: RecordedAction | undefined) => {
    if (value === undefined) return;
    identity(value);
    const producer = value.value?.producer;
    if (producer?.kind === "task-output") {
      node(producer.entryId);
      identity(producer.source);
    } else if (producer?.kind === "transformation") {
      for (const input of producer.inputs ?? []) {
        if (input.source.kind === "task-output" || input.source.kind === "child-output") node(input.source.entryId);
        for (const child of input.childResults ?? []) node(child.source.entryId);
        for (const upstream of input.identities) identity(upstream);
      }
    } else if (producer?.kind === "child-output") {
      node(producer.entryId);
      identity(producer.source);
      for (const input of producer.inputs ?? []) {
        if (input.identity?.runId === run.envelope.runId || input.identities?.some(value => value.runId === run.envelope.runId)) node(input.source.entryId);
        identity(input.identity);
        for (const upstream of input.identities ?? []) identity(upstream);
      }
    }
  };
  for (const span of row?.taskSpans ?? []) node(nodeIdOfTaskSpanPath(span.spanPath));
  for (const gate of [...row?.openGates ?? [], ...row?.resolvedGates ?? []]) node(gate.gate);
  for (const checkpoint of source.authority.listCheckpoints(run.envelope.workflow, run.envelope.itemId)) {
    if (checkpoint.runId === run.envelope.runId) node(checkpoint.nodeId);
  }
  for (const gate of source.authority.listGateResults(run.envelope.runId)) {
    node(gate.nodeId);
    node(gate.gateId);
  }
  if (run.lifecycle.state === "parked-gate") {
    node(run.lifecycle.gateId);
    node(run.lifecycle.resumeAt);
  }
  if (run.lifecycle.state === "running" && run.lifecycle.currentNodeId !== undefined) node(run.lifecycle.currentNodeId);
  for (const record of records ?? readTimelineRecords(source.timeline, 0, run.envelope.runId).records) {
    const payload = record.payload;
    if (payload.kind === "span") {
      const event = payload.event;
      if ("runId" in event && event.runId !== run.envelope.runId) continue;
      if ((event.t === "span.started" || event.t === "span.ended") && event.kind === "task") node(nodeIdOfTaskSpanPath(event.spanPath));
      else if (event.t === "gate.opened" || event.t === "gate.resolved") node(event.gate);
      else if (event.t === "data.observed") node(event.nodeId);
      else if (event.t === "transaction.fenced" || event.t === "transaction.previewed") node(event.node);
    } else if (payload.kind === "checkpoint-recorded" || payload.kind === "checkpoint-replayed" || payload.kind === "operation-confirmed") {
      node(payload.checkpoint.nodeId);
    } else if (payload.kind === "write-parked") node(payload.nodeId);
    else if (payload.kind === "note") {
      const note = payload.note;
      if (!("runId" in note) || note.runId !== run.envelope.runId) continue;
      if (note.action !== undefined) {
        node(note.action.operation?.nodeId ?? nodeIdOfTaskSpanPath(note.spanPath));
        action(note.action.operation);
      }
      if (note.confirmedAction !== undefined) {
        action(note.confirmedAction.action);
        if (note.confirmedAction.kind === "fact") {
          action(note.confirmedAction.proof.verifier);
          if (note.confirmedAction.durableProof !== undefined) node(note.confirmedAction.durableProof.checkpointNodeId);
        }
      }
    }
  }
}
