import { z } from "zod";
import configuredSources from "../../../config/dashboard-workflow-sources.json";
import type { AssistantWorkflowRequest, AssistantWorkflowResult } from "../surfaces/shell/assistant-panel-model.js";

/** Where a surface (sessions, activity, inbox, search, assistant) reads from; the design-mock harness composes "mock" surfaces, the product only "served". */
export type SurfaceSource = "mock" | "served";
/** "hidden" workflows run and serve data for their host but have no catalog, queue or assistant entry. */
export type WorkflowSource = "served" | "hidden";
export type WorkflowSourcePolicy = Readonly<Record<string, WorkflowSource>>;

export const WORKFLOW_SOURCES = Object.freeze(z.record(z.string(), z.enum(["served", "hidden"])).parse(configuredSources));

export function workflowSource(id: string, policy: WorkflowSourcePolicy = WORKFLOW_SOURCES): WorkflowSource {
  const source = policy[id];
  if (source === undefined) throw new Error(`WORKFLOW_SOURCE_UNDECLARED: ${id}`);
  return source;
}

export interface WorkflowComposition {
  readonly sources: WorkflowSourcePolicy;
  readonly logs?: SurfaceSource;
  readonly dataSources?: WorkflowSourcePolicy;
  readonly servedDay?: boolean;
  readonly sessions?: SurfaceSource;
  readonly activity?: SurfaceSource;
  readonly inbox: SurfaceSource;
  readonly search: SurfaceSource;
  readonly assistant?: SurfaceSource;
  /** The design-mock harness runs the assistant's sample workflows; the product has none. */
  readonly runAssistantSample?: (request: AssistantWorkflowRequest) => AssistantWorkflowResult;
}

export function workflowComposition(sources: WorkflowSourcePolicy): WorkflowComposition {
  return Object.freeze({ sources, sessions: "served" as const, activity: "served" as const, inbox: "served" as const, search: "served" as const });
}

export const PRODUCT_WORKFLOW_COMPOSITION = workflowComposition(WORKFLOW_SOURCES);
export const productWorkflowComposition = () => PRODUCT_WORKFLOW_COMPOSITION;
