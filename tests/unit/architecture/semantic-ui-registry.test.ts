import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { PageStateIdSchema, ScenarioIdSchema } from "../../../src/domain/ids.js";
import { UiCatalogSchema, UiVerificationEvidenceManifestSchema } from "../../../src/domain/ui/contracts.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/domain/trust/preflight-scenarios.js";
import {
  buildSafeUiCatalog,
  renderSystemUiCatalogMarkdown,
} from "../../../src/stores/ucpath/driver/catalog.js";
import {
  UCPATH_UI_REGISTRY,
  auditUcpathUiRegistry,
} from "../../../src/stores/ucpath/driver/ui-registry.js";
import { LegacySelectorPortMapSchema } from "./helpers/legacy-selector-port-map-audit.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8"));
}

describe("semantic UI registry architecture", () => {
  it("keeps the registry closed, dependency-complete, collision-free, and scenario-backed", () => {
    assert.deepEqual(auditUcpathUiRegistry(), []);
    assert.equal(UCPATH_UI_REGISTRY.screens.length > 0, true);
    assert.equal(UCPATH_UI_REGISTRY.elements.length > 0, true);
    assert.equal(UCPATH_UI_REGISTRY.states.length > 0, true);
    assert.equal(UCPATH_UI_REGISTRY.observations.length > 0, true);
  });

  it("keeps generated safe catalogs byte-fresh", () => {
    const catalog = buildSafeUiCatalog();
    assert.deepEqual(UiCatalogSchema.parse(readJson("generated/ui-catalog.json")), catalog);
    assert.equal(
      readFileSync(resolve(REPO_ROOT, "src/stores/ucpath/UI-CATALOG.md"), "utf8"),
      renderSystemUiCatalogMarkdown(catalog, "ucpath"),
    );
  });

  it("requires every published element to be explicitly ported with dual evidence", () => {
    const catalog = UiCatalogSchema.parse(readJson("generated/ui-catalog.json"));
    const portMap = LegacySelectorPortMapSchema.parse(readJson("config/ports/legacy-selector-port-map.json"));
    const catalogElementIds = catalog.entries.flatMap((entry) => entry.kind === "element" ? [entry.id] : []);
    const portedElementIds = portMap.entries.flatMap((entry) =>
      entry.disposition === "ported" && entry.semanticKind === "element" ? [entry.canonicalId] : []
    );
    const candidateProposalIds = new Set(portMap.entries.flatMap((entry) =>
      entry.disposition === "candidate" ? [entry.candidateId] : []
    ));
    assert.deepEqual([...catalogElementIds].sort(), [...portedElementIds].sort());
    assert.equal(catalogElementIds.some((id) => candidateProposalIds.has(id)), false);
    for (const entry of portMap.entries) {
      if (entry.disposition !== "ported") continue;
      UiVerificationEvidenceManifestSchema.parse(readJson(entry.evidence.fixtureEvidenceRef));
      UiVerificationEvidenceManifestSchema.parse(readJson(entry.evidence.liveReadOnlyEvidenceRef));
    }
  });

  it("catches duplicate ids, search collisions, unresolved dependencies, and cross-system entries", () => {
    const duplicate = structuredClone(UCPATH_UI_REGISTRY);
    duplicate.elements[1] = { ...duplicate.elements[1], id: duplicate.elements[0].id };
    assert.match(auditUcpathUiRegistry(duplicate).join("\n"), /globally unique/);

    const searchCollision = structuredClone(UCPATH_UI_REGISTRY);
    searchCollision.elements[1] = {
      ...searchCollision.elements[1],
      searchTerms: searchCollision.elements[0].searchTerms,
    };
    assert.match(auditUcpathUiRegistry(searchCollision).join("\n"), /search terms/);

    const unresolved = structuredClone(UCPATH_UI_REGISTRY);
    unresolved.elements[0] = {
      ...unresolved.elements[0],
      requiredStates: [PageStateIdSchema.parse("ucpath.person-org.unknown-ready")],
    };
    assert.match(auditUcpathUiRegistry(unresolved).join("\n"), /unknown state/);

    const crossSystem = structuredClone(UCPATH_UI_REGISTRY);
    crossSystem.elements[0] = { ...crossSystem.elements[0], system: "crm" };
    assert.match(auditUcpathUiRegistry(crossSystem).join("\n"), /crosses a system boundary/);
  });

  it("catches global scenario collisions and vacuous verification scenarios", () => {
    const collision = structuredClone(UCPATH_UI_REGISTRY);
    collision.scenarios[0] = {
      ...collision.scenarios[0],
      id: PREFLIGHT_SCENARIO_MANIFESTS[0].id,
    };
    assert.match(auditUcpathUiRegistry(collision).join("\n"), /globally unique/);

    const vacuous = structuredClone(UCPATH_UI_REGISTRY);
    vacuous.scenarios.push({
      ...vacuous.scenarios[0],
      id: ScenarioIdSchema.parse("ui/ucpath-person-org-vacuous"),
      title: "Vacuous fixture",
    });
    assert.match(auditUcpathUiRegistry(vacuous).join("\n"), /vacuous/);
  });
});
