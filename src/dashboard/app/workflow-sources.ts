import { z } from "zod";
import configuredSources from "../../../config/dashboard-workflow-sources.json";
import type { MockRun } from "../surfaces/workflows/mocks/workflow-mock-model.js";

export type SurfaceSource = "mock" | "served";
/** "hidden" workflows run and serve data for their host but have no catalog, queue or assistant entry. */
export type WorkflowSource = SurfaceSource | "hidden";
export type WorkflowSourcePolicy = Readonly<Record<string, WorkflowSource>>;

export const WORKFLOW_SOURCES = Object.freeze(z.record(z.string(), z.enum(["mock", "served", "hidden"])).parse(configuredSources));

export function surfaceSource(id: string, policy: WorkflowSourcePolicy = WORKFLOW_SOURCES): SurfaceSource {
  return workflowSource(id, policy) === "mock" ? "mock" : "served";
}

export function workflowSource(id: string, policy: WorkflowSourcePolicy = WORKFLOW_SOURCES): WorkflowSource {
  const source = policy[id];
  if (source === undefined) throw new Error(`WORKFLOW_SOURCE_UNDECLARED: ${id}`);
  return source;
}

/** A mock run stays when its workflow is a mock; a hidden workflow's run stays only as a host's child. */
export function keepsMockRun(composition: WorkflowComposition, run: MockRun): boolean {
  const source = composition.sourceForRoute(run.workflowId, true);
  return source === "mock" || source === "hidden" && run.parentId !== undefined;
}

export interface WorkflowComposition {
  readonly sources: WorkflowSourcePolicy;
  readonly initialMockRuns: () => readonly MockRun[];
  readonly explorerSources?: WorkflowSourcePolicy;
  readonly logsSources?: WorkflowSourcePolicy;
  readonly dataSources?: WorkflowSourcePolicy;
  readonly catalogIncludesMocks?: boolean;
  readonly servedDay?: boolean;
  readonly sessions?: SurfaceSource;
  readonly activity?: SurfaceSource;
  readonly inbox: SurfaceSource;
  readonly search: SurfaceSource;
  readonly assistant?: SurfaceSource;
  readonly sourceForRoute: (id: string, requestedPreview: boolean) => WorkflowSource;
}

export function workflowComposition(sources: WorkflowSourcePolicy): WorkflowComposition {
  return Object.freeze({ sources, initialMockRuns: () => [], sessions: "served" as const, activity: "served" as const, inbox: "served" as const, search: "served" as const, sourceForRoute: (id: string) => workflowSource(id, sources) });
}

export const PRODUCT_WORKFLOW_COMPOSITION = workflowComposition(WORKFLOW_SOURCES);
export const productWorkflowComposition = () => PRODUCT_WORKFLOW_COMPOSITION;
