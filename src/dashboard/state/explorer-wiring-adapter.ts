import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { WorkflowExplorerWire } from "../../models/dashboard/explorer.js";
import type { ExplorerReviewSpec } from "../../models/dashboard/explorer-review-spec.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { ExplorerQueries } from "../client/queries/explorer-queries.js";
import { useSettingsRead } from "./settings-read-model.js";

export type ExplorerWiringState =
  | Readonly<{ state: "idle" | "loading" }>
  | Readonly<{ state: "ready"; spec: ExplorerReviewSpec }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | Readonly<{ state: "refused"; failure: ErrorCatalogFailure; evidence: unknown; previous?: ExplorerReviewSpec }>;

const unavailableExplorerClient = {};

/** The served review spec of one workflow, at the version the bootstrap catalog registers. `retry` reads it again. */
export function useExplorerWiring(client: Pick<ExplorerQueries, "workflowExplorer"> | undefined, workflowId: string | undefined, version?: number): Readonly<{ state: ExplorerWiringState; retry: () => void; workflows: WorkflowExplorerWire["workflows"] | undefined }> {
  const resource = useSettingsRead<WorkflowExplorerWire>(client ?? unavailableExplorerClient, "explorer");
  const result = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const retry = useCallback(() => {
    if (client === undefined) return;
    void resource.read(() => client.workflowExplorer(), "DASHBOARD_READ_FAILED").catch(() => resource.snapshot());
  }, [client, resource]);
  const held = result.value?.workflows.find(candidate => candidate.id === workflowId);
  // The one wire serves every workflow; it is read on mount, on a client change and when the held version is not the catalog's.
  const mismatched = held !== undefined && version !== undefined && held.version !== version;
  const selected = workflowId !== undefined;
  const readBy = useRef<unknown>(undefined);
  useEffect(() => {
    if (!selected || (readBy.current === retry && !mismatched)) return;
    readBy.current = retry;
    retry();
  }, [retry, selected, mismatched]);
  const projected = useMemo((): ExplorerWiringState => {
    const workflow = result.value?.workflows.find(candidate => candidate.id === workflowId);
    if (result.value === undefined) return { state: "loading" };
    if (!workflow) return { state: "unavailable", reason: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text };
    if (version !== undefined && workflow.version !== version) return result.state === "loading" ? { state: "loading" } : { state: "refused", failure: createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }), evidence: "explorer-catalog-version-mismatch" };
    return { state: "ready", spec: workflow.reviewSpec };
  }, [result.value, result.state, workflowId, version]);
  const state = ((): ExplorerWiringState => {
    if (workflowId === undefined) return { state: "idle" };
    if (client === undefined) return { state: "unavailable", reason: "Registered workflow data is unavailable because the dashboard client is not connected." };
    if (result.state === "failed" && result.value === undefined) return { state: "refused", failure: createErrorCatalogFailure("DASHBOARD_READ_FAILED", {}), evidence: result.error };
    return result.state === "failed" && projected.state === "ready"
      ? { state: "refused", failure: createErrorCatalogFailure("DASHBOARD_READ_FAILED", {}), evidence: result.error, previous: projected.spec } : projected;
  })();
  return { state, retry, workflows: result.value?.workflows };
}
