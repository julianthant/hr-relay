/**
 * Where a registered workflow's SOURCE lives, derived from its role (D265,
 * ref workflow-model §1.2.2).
 *
 * The operator's ruling made `src/workflows/` the rail and the timeline: a
 * top-level folder is a rail entry, and a sub-folder is one declared timeline
 * step of the workflow above it — holding, when that step was proved on its
 * own, the harness that proved it. So a descriptor's path is a function of its
 * ROLE and no longer of its id: the harness at
 * `src/workflows/separations/steps/kuali-extraction/` is still
 * `separations-kuali-read`, because ids are run identity and did not move with
 * the folders.
 *
 * This is the ONE derivation, and it is here rather than in a guard helper
 * because three readers need the same answer: the Explorer's source links
 * (`src/backend/runs/queries/explorer.ts`), `descriptor-coverage`'s
 * bundle-closure walk, and `workflow-editor-compile-integrity`'s
 * source-authored arm. Three copies of the same path literal were free to
 * disagree the moment a folder moved, and one of them printed a link an
 * operator would click.
 *
 * Nothing here reads the filesystem: it is a pure string rule over facts the
 * module already declares, which is what keeps it usable from a browser-bound
 * projection.
 */
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

/**
 * D317 — one authored definition per workflow: `workflow.ts` for a rail
 * workflow, `step.ts` for a chunk harness, each holding one `defineWorkflow(...)` call. Descriptors, module requirements and registry
 * values are compiled from it and never authored beside it.
 */
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
