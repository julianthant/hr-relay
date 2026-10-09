/** A registered workflow's source path, derived from its role (not id): the one derivation shared by the Explorer, closure walk and compile-integrity audit, pure so it is browser-safe. */
import type { WorkflowModuleRole } from "./module-role.js";

/** The repo-relative folder, with no trailing slash. */
export function workflowSourceFolder(id: string, role: WorkflowModuleRole): string {
  switch (role.kind) {
    case "standalone":
    case "composition":
      return `src/workflows/${id}`;
    case "chunk-harness":
      // §1.2.2 rule 3 — the harness lives INSIDE the step it proves.
      return `src/workflows/${String(role.of)}/steps/${role.step}`;
  }
}

/** One authored definition per workflow — `workflow.ts` (rail) or `step.ts` (harness) — compiled, never authored beside descriptors or registry values. */
export function workflowSourcePath(id: string, role: WorkflowModuleRole): string {
  return `${workflowSourceFolder(id, role)}/${role.kind === "chunk-harness" ? "step.ts" : "workflow.ts"}`;
}

/** Structural scenario path for the same declared workflow role. */
export function workflowScenarioFolder(id: string, role: WorkflowModuleRole): string {
  return `tests/scenario/workflows/${workflowSourceFolder(id, role).slice("src/workflows/".length)}`;
}

export function workflowStructuralScenarioPath(id: string, role: WorkflowModuleRole): string {
  return `${workflowScenarioFolder(id, role)}/structural.scenario.test.ts`;
}
