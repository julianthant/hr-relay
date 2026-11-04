import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewPage } from "../../models/dashboard/run-detail.js";
import type { DashboardClient } from "../client/index.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { LogSelection } from "../surfaces/run-detail/logs/log-selection-model.js";

type ReviewState = Readonly<{ state: "loading" | "loaded" | "failed"; page?: ReviewPage; error?: string }>;

export async function readRunReview(client: Pick<DashboardClient, "runDetail" | "runSection">, selection: LogSelection, signal: AbortSignal): Promise<ReviewPage> {
  const { row } = selection;
  const detail = await client.runDetail(row.runId, signal);
  if (detail.runId !== row.runId || detail.header.workflowId !== row.workflowId || detail.header.traceId !== row.traceId
    || detail.header.attempt !== row.attempt || detail.rowRevision !== row.rowRevision || !detail.availableSections.includes("review")) {
    throw new Error("RUN_REVIEW_IDENTITY_MISMATCH");
  }
  signal.throwIfAborted();
  const section = await client.runSection(row.runId, "review", undefined, signal);
  if (section.section !== "review" || section.payload.runId !== row.runId) throw new Error("RUN_REVIEW_IDENTITY_MISMATCH");
  return section.payload;
}

export function useRunReview(client: DashboardClient, selection: LogSelection, binding: DashboardCommandBinding | undefined) {
  const { row } = selection;
  const request = useMemo(() => ({ client, selection: { row, workflowLabel: selection.workflowLabel }, runId: row.runId, revision: row.rowRevision, epoch: binding?.authority.epoch,
    actor: binding?.scope.actorId, day: binding?.authority.day, dayRequest: binding?.authority.dayState.request,
    dayState: binding?.authority.dayState.day.state }),
  [client, row, selection.workflowLabel, binding?.authority.epoch, binding?.scope.actorId, binding?.authority.day,
    binding?.authority.dayState.request, binding?.authority.dayState.day.state]);
  const current = useRef(request);
  current.current = request;
  const [settled, setSettled] = useState<{ request: typeof request; value: ReviewState }>({ request, value: { state: "loading" } });
  const sameOwner = settled.request.client === client && settled.request.runId === row.runId
    && settled.request.epoch === request.epoch && settled.request.actor === request.actor && settled.request.day === request.day;
  const value: ReviewState = settled.request === request ? settled.value : { state: "loading", ...(sameOwner && settled.value.page ? { page: settled.value.page } : {}) };
  useEffect(() => {
    if (request.dayState !== undefined && request.dayState !== "loaded") return;
    const controller = new AbortController();
    void readRunReview(client, request.selection, controller.signal).then(page => {
      if (current.current === request && !controller.signal.aborted) setSettled({ request, value: { state: "loaded", page } });
    }, () => {
      if (current.current !== request || controller.signal.aborted) return;
      const error = formatErrorCatalogFailure(createErrorCatalogFailure("OCR_REVIEW_REFUSED", {})).text;
      setSettled(previous => ({ request, value: { state: "failed", error,
        ...(previous.request.client === client && previous.request.runId === row.runId && previous.request.epoch === request.epoch
          && previous.request.actor === request.actor && previous.request.day === request.day && previous.value.page ? { page: previous.value.page } : {}) } }));
    });
    return () => controller.abort();
  }, [client, request, row.runId]);
  return value;
}
