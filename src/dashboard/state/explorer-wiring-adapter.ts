import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { WorkflowExplorerWire } from "../../models/dashboard/explorer.js";
import type { ExplorerReviewSpec } from "../../models/dashboard/explorer-review-spec.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { ExplorerQueries } from "../client/queries/explorer-queries.js";
import { useDashboardCommandBinding } from "./client-context.js";
import { useSettingsRead } from "./settings-read-model.js";

export type ExplorerWiringState =
  | Readonly<{ state: "idle" | "loading" }>
  | Readonly<{ state: "ready"; spec: ExplorerReviewSpec }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | Readonly<{ state: "refused"; failure: ErrorCatalogFailure; evidence: unknown; previous?: ExplorerReviewSpec }>;

const unavailableExplorerClient = {};

/** The served review spec of one workflow, at the version the bootstrap catalog registers. `retry` reads it again. */
export function useExplorerWiring(client: Pick<ExplorerQueries, "workflowExplorer"> | undefined, workflowId: string | undefined, version?: number): Readonly<{ state: ExplorerWiringState; retry: () => void; workflows: WorkflowExplorerWire["workflows"] | undefined }> {
  const descriptorHash = useDashboardCommandBinding()?.authority.epoch.bootstrap.descriptorHash;
  const resource = useSettingsRead<WorkflowExplorerWire>(client ?? unavailableExplorerClient, "explorer");
  const result = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const readScope = useRef<AbortController | undefined>(undefined);
  const read = useCallback((refresh: boolean) => {
    const signal = readScope.current?.signal;
    if (client === undefined || signal === undefined) return;
    void resource.read(requestSignal => client.workflowExplorer(requestSignal, { descriptorHash, refresh }), "DASHBOARD_READ_FAILED", undefined, signal).catch(() => resource.snapshot());
  }, [client, descriptorHash, resource]);
  const retry = useCallback(() => read(true), [read]);
  const selected = workflowId !== undefined;
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    readScope.current = controller;
    if (resource.snapshot().state !== "loaded") read(false);
    return () => { readScope.current = undefined; controller.abort(); };
  }, [read, resource, selected]);
  const held = result.value?.workflows.find(candidate => candidate.id === workflowId);
  const mismatched = held !== undefined && version !== undefined && held.version !== version;
  useEffect(() => {
    if (mismatched) retry();
  }, [mismatched, retry, version, workflowId]);
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
