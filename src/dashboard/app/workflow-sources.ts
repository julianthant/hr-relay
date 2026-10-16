import { z } from "zod";
import configuredSources from "../../../config/dashboard-workflow-sources.json";

export type WorkflowSource = "mock" | "served";
export type WorkflowSourcePolicy = Readonly<Record<string, WorkflowSource>>;

export const WORKFLOW_SOURCES = Object.freeze(z.record(z.string(), z.enum(["mock", "served"])).parse(configuredSources));

export function workflowSource(id: string, policy: WorkflowSourcePolicy = WORKFLOW_SOURCES): WorkflowSource {
  const source = policy[id];
  if (source === undefined) throw new Error(`WORKFLOW_SOURCE_UNDECLARED: ${id}`);
  return source;
}

export interface WorkflowComposition {
  readonly sources: WorkflowSourcePolicy;
  readonly explorerSources?: WorkflowSourcePolicy;
  readonly logsSources?: WorkflowSourcePolicy;
  readonly dataSources?: WorkflowSourcePolicy;
  readonly catalogIncludesMocks?: boolean;
  readonly servedDay?: boolean;
  readonly sessions?: WorkflowSource;
  readonly activity?: WorkflowSource;
  readonly inbox: WorkflowSource;
  readonly search: WorkflowSource;
  readonly spreadsheets?: WorkflowSource;
  readonly sourceForRoute: (id: string, requestedPreview: boolean) => WorkflowSource;
}

export function workflowComposition(sources: WorkflowSourcePolicy): WorkflowComposition {
  return Object.freeze({ sources, sessions: "served" as const, activity: "served" as const, inbox: "served" as const, search: "served" as const, spreadsheets: "served" as const, sourceForRoute: (id: string) => workflowSource(id, sources) });
}

export const PRODUCT_WORKFLOW_COMPOSITION = workflowComposition(WORKFLOW_SOURCES);
export const productWorkflowComposition = () => PRODUCT_WORKFLOW_COMPOSITION;
