/**
 * The explorer's registered graph and semantic task links are shared by BFF harnesses (2i-G).
 *
 * They are built from the REAL composition root on purpose. Both surfaces are
 * projections of registration state with no authority read in them, so a
 * harness serving a fabricated registry would prove a graph the product does
 * not have — and the whole point of ref operator-trust §5.2 is that the explorer shows the
 * exact descriptor. One helper, so a harness cannot drift into its own answer.
 */
import {
  WORKFLOW_MODULES,
  readPendingImplBindings,
} from "../../../src/backend/app/registries/workflow-registry.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import type { Fingerprint } from "../../../src/rules/identity/ids.js";
import {
  EXPLORER_SOURCE_ROOT,
  type ExplorerQueryDeps,
} from "../../../src/backend/runs/queries/explorer.js";
import { buildUiTaskLinks } from "../../../src/backend/systems/ui-task-links.js";
import { workflowProjections } from "../../../src/workflow-kit/workflow.js";
import { workflowStructuralScenarioPath } from "../../../src/workflow-kit/validation/source-layout.js";

/** The same anchor production uses, so a harness cannot read a different tree. */
const REPO_ROOT = EXPLORER_SOURCE_ROOT;

/** Test-only scenario text for registered definitions; no executable corpus is implied. */
export function registeredScenarioFixtureSources(): readonly Readonly<{ path: string; text: string }>[] {
  const claimed = new Set<string>();
  return WORKFLOW_MODULES.map((module) => ({
    path: workflowStructuralScenarioPath(String(module.descriptor.id), module.role),
    text: workflowProjections(module.descriptor).scenarios
      .map(String)
      .filter((scenarioId) => {
        if (claimed.has(scenarioId)) return false;
        claimed.add(scenarioId);
        return true;
      })
      .map((scenarioId) => `it("${scenarioId} — registered fixture", () => {});`)
      .join("\n"),
  }));
}

export function explorerQueryDeps(
  clock: Clock,
  descriptorSetHash: Fingerprint,
): ExplorerQueryDeps {
  return {
    clock,
    modules: WORKFLOW_MODULES,
    descriptorSetHash,
    pendingImplBindings: readPendingImplBindings(REPO_ROOT),
    uiTaskLinks: buildUiTaskLinks(),
    listScenarioSources: registeredScenarioFixtureSources,
  };
}
