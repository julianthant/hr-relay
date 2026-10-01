/**
 * The explorer + UI-catalog dependency blocks every BFF harness wires (2i-G).
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
} from "../../src/backend/app/control/workflow-registry.js";
import type { Clock } from "../../src/domain/clock.js";
import type { Fingerprint } from "../../src/domain/ids.js";
import {
  EXPLORER_SOURCE_ROOT,
  readScenarioSources,
  type ExplorerQueryDeps,
} from "../../src/server/dashboard/queries/explorer.js";
import {
  readCommittedUiCatalog,
  type UiCatalogQueryDeps,
} from "../../src/server/dashboard/queries/ui-catalog.js";
import { buildSafeUiCatalog } from "../../src/stores/ucpath/driver/catalog.js";

/** The same anchor production uses, so a harness cannot read a different tree. */
const REPO_ROOT = EXPLORER_SOURCE_ROOT;

export function explorerQueryDeps(
  clock: Clock,
  descriptorSetHash: Fingerprint,
): ExplorerQueryDeps {
  return {
    clock,
    modules: WORKFLOW_MODULES,
    descriptorSetHash,
    pendingImplBindings: readPendingImplBindings(REPO_ROOT),
    uiCatalog: buildSafeUiCatalog(),
    listScenarioSources: () => readScenarioSources(REPO_ROOT),
  };
}

export function uiCatalogQueryDeps(): UiCatalogQueryDeps {
  return { readCatalogJson: () => readCommittedUiCatalog(REPO_ROOT) };
}
