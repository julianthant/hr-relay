/**
 * The generated UI catalog surface's query (ref operator-trust §1.3, D177).
 *
 * It serves the **committed** `generated/ui-catalog.json` — the same bytes the
 * `semantic-ui-registry` guard pins, the same file `npm run selector:search`
 * reads, and the same projection `src/stores/<system>/UI-CATALOG.md` renders.
 * That is the whole point of the surface: an operator reading a selector's
 * semantics must be reading the artifact under review, not a fourth rendering
 * of the registries that could drift from it.
 *
 * ## It reads; it never regenerates
 *
 * `npm run ui:catalog` is the ONE writer, and a surface that regenerated on
 * read would silently heal a stale checkout mid-session — exactly the defect
 * the 2026-08-03 lesson records from `ui-catalog-cli.test.ts`. So this query
 * opens the file read-only and then asserts, through the drivers' own
 * `assertSafeUiCatalogFresh`, that what is on disk still equals what the
 * registries compose. A stale artifact throws with the generator's own
 * remediation rather than being served: a catalog that disagrees with the
 * drivers describes selectors the system does not actually use, and an
 * operator or an AI acting on it would be acting on fiction.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UiCatalogWireSchema, type UiCatalogWire } from "../../../../domain/dashboard/explorer.js";
import { UiCatalogSchema, type UiCatalog } from "../../../../domain/ui/contracts.js";
import {
  UI_CATALOG_JSON_PATH,
  assertSafeUiCatalogFresh,
} from "../../../../stores/ucpath/driver/catalog.js";

export interface UiCatalogQueryDeps {
  /**
   * Reads the tracked artifact's text. Injected so the freshness refusal is
   * testable through the same entry point production uses — a guard arm that
   * could only be reached by corrupting the checkout would not be run.
   */
  readonly readCatalogJson: () => string;
}

/** The default reader: the committed artifact at its one tracked path. */
export function readCommittedUiCatalog(repoRoot: string): string {
  return readFileSync(join(repoRoot, UI_CATALOG_JSON_PATH), "utf8");
}

/**
 * Parse the committed artifact, then prove it still describes the drivers.
 *
 * Both halves matter and neither substitutes for the other: the parse proves
 * the bytes are a catalog, and `assertSafeUiCatalogFresh` proves the catalog is
 * THIS build's. It throws by name on either failure.
 */
export function loadCommittedUiCatalog(deps: UiCatalogQueryDeps): UiCatalog {
  const parsed: unknown = JSON.parse(deps.readCatalogJson());
  const catalog = UiCatalogSchema.parse(parsed);
  assertSafeUiCatalogFresh(catalog);
  return catalog;
}

export function buildUiCatalogWire(deps: UiCatalogQueryDeps): UiCatalogWire {
  const catalog = loadCommittedUiCatalog(deps);
  return UiCatalogWireSchema.parse({
    wireVersion: 1,
    sourcePath: UI_CATALOG_JSON_PATH,
    schemaVersion: catalog.schemaVersion,
    entries: catalog.entries,
  });
}
