import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { PageStateIdSchema, ScenarioIdSchema } from "../../src/domain/ids.js";
import { UiCatalogSchema, UiVerificationEvidenceManifestSchema } from "../../src/domain/ui/contracts.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../src/domain/trust/preflight-scenarios.js";
import {
  auditUiCatalogProjections,
  buildSafeUiCatalog,
  uiCatalogMarkdownPath,
  uiCatalogProjections,
  uiCatalogSystems,
} from "../../src/backend/systems/ucpath/driver/catalog.js";
import {
  CRM_UI_REGISTRY,
  auditCrmUiEvidenceBindings,
  auditCrmUiRegistry,
} from "../../src/backend/systems/crm/driver/ui-registry.js";
import {
  NEW_KRONOS_UI_REGISTRY,
  auditNewKronosUiEvidenceBindings,
  auditNewKronosUiRegistry,
} from "../../src/backend/systems/new-kronos/driver/ui-registry.js";
import {
  UCPATH_UI_REGISTRY,
  auditUcpathUiEvidenceBindings,
  auditUcpathUiRegistry,
} from "../../src/backend/systems/ucpath/driver/ui-registry.js";
import {
  CandidateProposalIdSchema,
  LegacySelectorPortMapSchema,
} from "./helpers/legacy-selector-port-map-audit.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8"));
}

function evidenceBindingInput(): unknown {
  const portMap = LegacySelectorPortMapSchema.parse(readJson("config/ports/legacy-selector-port-map.json"));
  const portBindings: unknown[] = [];
  for (const entry of portMap.entries) {
    if (entry.disposition === "ported") {
      portBindings.push({
        system: entry.system,
        legacyKey: entry.legacyKey,
        disposition: entry.disposition,
        semanticKind: entry.semanticKind,
        ...("canonicalBindings" in entry
          ? { canonicalBindings: entry.canonicalBindings }
          : { canonicalId: entry.canonicalId }),
        evidence: entry.evidence,
      });
    }
    if (entry.disposition === "driver-internal") {
      portBindings.push({
        system: entry.system,
        legacyKey: entry.legacyKey,
        disposition: entry.disposition,
        semanticKind: entry.semanticKind,
      });
    }
  }
  return {
    evidenceByRef: {
      "evidence/ui/ucpath/person-org.fixture.json": readJson("evidence/ui/ucpath/person-org.fixture.json"),
      "evidence/ui/ucpath/person-org.live.json": readJson("evidence/ui/ucpath/person-org.live.json"),
      "evidence/ui/ucpath/ss-smart-hr.fixture.json": readJson("evidence/ui/ucpath/ss-smart-hr.fixture.json"),
      "evidence/ui/ucpath/ss-smart-hr.live.json": readJson("evidence/ui/ucpath/ss-smart-hr.live.json"),
      "evidence/ui/ucpath/smart-hr-termination.fixture.json":
        readJson("evidence/ui/ucpath/smart-hr-termination.fixture.json"),
      "evidence/ui/ucpath/smart-hr-termination.live.json":
        readJson("evidence/ui/ucpath/smart-hr-termination.live.json"),
    },
    portBindings,
  };
}

function crmEvidenceBindingInput(): unknown {
  const portMap = LegacySelectorPortMapSchema.parse(readJson("config/ports/legacy-selector-port-map.json"));
  return {
    evidenceByRef: {
      "evidence/ui/crm/onboarding.fixture.json": readJson("evidence/ui/crm/onboarding.fixture.json"),
      "evidence/ui/crm/onboarding.live.json": readJson("evidence/ui/crm/onboarding.live.json"),
    },
    portBindings: portMap.entries.flatMap((entry) => {
      if (entry.system !== "crm"
        || entry.disposition !== "ported"
        || entry.semanticKind !== "element"
        || !("canonicalId" in entry)) return [];
      return [{
        system: entry.system,
        legacyKey: entry.legacyKey,
        disposition: entry.disposition,
        semanticKind: entry.semanticKind,
        canonicalId: entry.canonicalId,
        evidence: entry.evidence,
      }];
    }),
  };
}

function newKronosEvidenceBindingInput(): unknown {
  const portMap = LegacySelectorPortMapSchema.parse(readJson("config/ports/legacy-selector-port-map.json"));
  return {
    evidenceByRef: {
      "evidence/ui/new-kronos/timecard.fixture.json": readJson("evidence/ui/new-kronos/timecard.fixture.json"),
      "evidence/ui/new-kronos/timecard.live.json": readJson("evidence/ui/new-kronos/timecard.live.json"),
    },
    portBindings: portMap.entries.flatMap((entry) => {
      if (entry.system !== "new-kronos"
        || entry.disposition !== "ported"
        || entry.semanticKind !== "element"
        || !("canonicalId" in entry)) return [];
      return [{
        system: entry.system,
        legacyKey: entry.legacyKey,
        disposition: entry.disposition,
        semanticKind: entry.semanticKind,
        canonicalId: entry.canonicalId,
        evidence: entry.evidence,
      }];
    }),
  };
}

describe("semantic UI registry architecture", () => {
  it("keeps the registry closed, dependency-complete, collision-free, and scenario-backed", () => {
    assert.deepEqual(auditUcpathUiRegistry(), []);
    assert.deepEqual(auditCrmUiRegistry(), []);
    assert.deepEqual(auditNewKronosUiRegistry(), []);
    assert.equal(UCPATH_UI_REGISTRY.screens.length > 0, true);
    assert.equal(UCPATH_UI_REGISTRY.elements.length > 0, true);
    assert.equal(UCPATH_UI_REGISTRY.states.length > 0, true);
    assert.equal(UCPATH_UI_REGISTRY.observations.length > 0, true);
    assert.equal(CRM_UI_REGISTRY.elements.length, 5);
    assert.equal(CRM_UI_REGISTRY.states.length, 4);
    assert.equal(CRM_UI_REGISTRY.observations.length, 1);
    assert.equal(NEW_KRONOS_UI_REGISTRY.screens.length, 2);
    assert.equal(NEW_KRONOS_UI_REGISTRY.elements.length, 16);
    assert.equal(NEW_KRONOS_UI_REGISTRY.states.length, 4);
    assert.equal(NEW_KRONOS_UI_REGISTRY.observations.length, 1);
    const ids = [
      ...UCPATH_UI_REGISTRY.screens,
      ...UCPATH_UI_REGISTRY.elements,
      ...UCPATH_UI_REGISTRY.states,
      ...UCPATH_UI_REGISTRY.observations,
      ...CRM_UI_REGISTRY.screens,
      ...CRM_UI_REGISTRY.elements,
      ...CRM_UI_REGISTRY.states,
      ...CRM_UI_REGISTRY.observations,
      ...NEW_KRONOS_UI_REGISTRY.screens,
      ...NEW_KRONOS_UI_REGISTRY.elements,
      ...NEW_KRONOS_UI_REGISTRY.states,
      ...NEW_KRONOS_UI_REGISTRY.observations,
    ].map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("derives the guarded projection set from the stores that publish, not from a list", () => {
    const catalog = buildSafeUiCatalog();
    // The set of stores that ship a semantic registry is the ONLY authority for
    // which markdown projections must exist. `src/backend/systems/kuali/UI-CATALOG.md`
    // was generated but guarded nowhere precisely because that set was retyped
    // by hand in three places; both directions are asserted so neither a
    // registry the catalog forgot nor an orphan markdown can hide.
    const storesRoot = resolve(REPO_ROOT, "src/backend/systems");
    const registryStores = readdirSync(storesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()
        && existsSync(resolve(storesRoot, entry.name, "driver/ui-registry.ts")))
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual([...uiCatalogSystems(catalog)], registryStores);
    assert.ok(registryStores.includes("kuali"), "the kuali registry must be inside the derived set");

    const markdownStores = readdirSync(storesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()
        && existsSync(resolve(storesRoot, entry.name, "UI-CATALOG.md")))
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(markdownStores, registryStores, "an orphan UI-CATALOG.md has no registry behind it");
    assert.deepEqual(
      uiCatalogProjections(catalog).map(({ path }) => path),
      ["generated/ui-catalog.json", ...registryStores.map((store) => `src/backend/systems/${store}/UI-CATALOG.md`)],
    );
  });

  it("keeps every generated safe projection byte-fresh", () => {
    const catalog = buildSafeUiCatalog();
    const read = (path: string): string | undefined => {
      const full = resolve(REPO_ROOT, path);
      return existsSync(full) ? readFileSync(full, "utf8") : undefined;
    };
    assert.deepEqual(auditUiCatalogProjections(catalog, read), []);
    assert.deepEqual(UiCatalogSchema.parse(readJson("generated/ui-catalog.json")), catalog);

    // Negative controls, one per projection. Before this guard existed the kuali
    // arm was the one that silently passed, so it is asserted by name — but the
    // loop proves EVERY derived projection is load-bearing, including the next
    // store's, which no one will remember to add a case for.
    for (const { path } of uiCatalogProjections(catalog)) {
      const stale = auditUiCatalogProjections(catalog, (candidate) =>
        candidate === path ? "# stale projection\n" : read(candidate));
      assert.deepEqual(stale, [`${path} is stale — run \`npm run ui:catalog\` and commit the result`]);

      const missing = auditUiCatalogProjections(catalog, (candidate) =>
        candidate === path ? undefined : read(candidate));
      assert.deepEqual(missing, [`${path} is missing — run \`npm run ui:catalog\` and commit the result`]);
    }
    assert.match(
      auditUiCatalogProjections(catalog, (path) =>
        path === uiCatalogMarkdownPath("kuali") ? "# stale projection\n" : read(path)).join("\n"),
      /src\/backend\/systems\/kuali\/UI-CATALOG\.md is stale/,
    );
  });

  it("requires every published element to be explicitly ported with dual evidence", () => {
    const catalog = UiCatalogSchema.parse(readJson("generated/ui-catalog.json"));
    const portMap = LegacySelectorPortMapSchema.parse(readJson("config/ports/legacy-selector-port-map.json"));
    const catalogElementIds = catalog.entries.flatMap((entry) => entry.kind === "element" ? [entry.id] : []);
    const portedElementIds = portMap.entries.flatMap((entry) => {
      if (entry.disposition !== "ported" || entry.semanticKind !== "element") return [];
      return "canonicalBindings" in entry
        ? entry.canonicalBindings.map(({ canonicalId }) => canonicalId)
        : [entry.canonicalId];
    });
    const candidateProposalIds = new Set(portMap.entries.flatMap((entry) =>
      entry.disposition === "candidate" ? [entry.candidateId] : []
    ));
    assert.deepEqual([...catalogElementIds].sort(), [...portedElementIds].sort());
    assert.equal(catalog.entries.some(({ id }) => candidateProposalIds.has(id)), false);
    assert.equal(catalog.entries.every(({ id }) => !CandidateProposalIdSchema.safeParse(id).success), true);
    for (const entry of portMap.entries) {
      if (entry.disposition !== "ported") continue;
      UiVerificationEvidenceManifestSchema.parse(readJson(entry.evidence.fixtureEvidenceRef));
      UiVerificationEvidenceManifestSchema.parse(readJson(entry.evidence.liveReadOnlyEvidenceRef));
    }
  });

  it("binds every published fact to exact evidence and exact port-map provenance", () => {
    assert.deepEqual(auditUcpathUiEvidenceBindings(evidenceBindingInput()), []);
    assert.deepEqual(auditCrmUiEvidenceBindings(crmEvidenceBindingInput()), []);
    assert.deepEqual(auditNewKronosUiEvidenceBindings(newKronosEvidenceBindingInput()), []);

    const wrongScreen = structuredClone(evidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { screen: string }[] }>;
    };
    const screenAssertion = wrongScreen.evidenceByRef["evidence/ui/ucpath/person-org.fixture.json"]?.assertions[0];
    if (!screenAssertion) throw new Error("fixture evidence assertion missing");
    screenAssertion.screen = "ucpath.person-org.detail";
    assert.match(auditUcpathUiEvidenceBindings(wrongScreen).join("\n"), /assertion screen drifted/);

    const wrongScenario = structuredClone(evidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { scenarioId: string }[] }>;
    };
    const fixtureAssertion = wrongScenario.evidenceByRef["evidence/ui/ucpath/person-org.fixture.json"]?.assertions[0];
    if (!fixtureAssertion) throw new Error("fixture evidence assertion missing");
    fixtureAssertion.scenarioId = "ui/ucpath-person-org-displayed-eid";
    assert.match(auditUcpathUiEvidenceBindings(wrongScenario).join("\n"), /assertion scenario drifted/);

    const wrongPortRow = structuredClone(evidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { portMapRows: { system: string; legacyKey: string }[] }[] }>;
    };
    const portAssertion = wrongPortRow.evidenceByRef["evidence/ui/ucpath/person-org.fixture.json"]?.assertions[0];
    if (!portAssertion) throw new Error("fixture evidence assertion missing");
    portAssertion.portMapRows = [{ system: "ucpath", legacyKey: "personOrgSummary.personIdValue()" }];
    assert.match(auditUcpathUiEvidenceBindings(wrongPortRow).join("\n"), /assertion port-map rows drifted/);

    const wrongContext = structuredClone(evidenceBindingInput()) as {
      portBindings: {
        legacyKey: string;
        canonicalBindings?: { context: string; canonicalId: string }[];
      }[];
    };
    const viewAllBinding = wrongContext.portBindings.find(({ legacyKey }) =>
      legacyKey === "personOrgSummary.viewAllLink()"
    );
    if (viewAllBinding?.canonicalBindings === undefined) throw new Error("View All context binding missing");
    const firstBinding = viewAllBinding.canonicalBindings[0];
    const secondBinding = viewAllBinding.canonicalBindings[1];
    if (firstBinding === undefined || secondBinding === undefined) throw new Error("View All contexts missing");
    viewAllBinding.canonicalBindings[0] = {
      ...firstBinding,
      context: secondBinding.context,
    };
    viewAllBinding.canonicalBindings[1] = {
      ...secondBinding,
      context: firstBinding.context,
    };
    assert.match(auditUcpathUiEvidenceBindings(wrongContext).join("\n"), /contextual port binding drifted/);
  });

  it("rejects CRM evidence whose displayed-EID fact is rebound to a search-row port", () => {
    const wrongPortRow = structuredClone(crmEvidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { semanticId: string; portMapRows: { system: string; legacyKey: string }[] }[] }>;
    };
    const assertion = wrongPortRow.evidenceByRef["evidence/ui/crm/onboarding.fixture.json"]
      ?.assertions.find(({ semanticId }) => semanticId === "crm.onboarding.displayed-eid");
    if (assertion === undefined) throw new Error("CRM displayed-EID fixture assertion missing");
    assertion.portMapRows = [{ system: "crm", legacyKey: "search.resultRows()" }];
    assert.match(auditCrmUiEvidenceBindings(wrongPortRow).join("\n"), /assertion port-map rows drifted/);
  });

  it("rejects New Kronos evidence whose timecard fact is rebound to the search screen or a search port", () => {
    // Both halves of a New Kronos assertion are load-bearing, and each is
    // asserted through the SAME entry point the green arm uses: the screen names
    // which surface was actually observed, and the port-map rows name which
    // legacy key the observation discharges. The timecard's subject observation
    // is the one that matters most — it is the wrong-person control — so it is
    // the fact both negative controls mutate.
    const wrongScreen = structuredClone(newKronosEvidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { semanticId: string; screen: string }[] }>;
    };
    const screenAssertion = wrongScreen.evidenceByRef["evidence/ui/new-kronos/timecard.live.json"]
      ?.assertions.find(({ semanticId }) => semanticId === "new-kronos.timecard.displayed-eid");
    if (screenAssertion === undefined) throw new Error("New Kronos displayed-EID live assertion missing");
    screenAssertion.screen = "new-kronos.employee-search";
    assert.match(auditNewKronosUiEvidenceBindings(wrongScreen).join("\n"), /assertion screen drifted/);

    const wrongPortRow = structuredClone(newKronosEvidenceBindingInput()) as {
      evidenceByRef: Record<string, {
        assertions: { semanticId: string; portMapRows: { system: string; legacyKey: string }[] }[];
      }>;
    };
    const portAssertion = wrongPortRow.evidenceByRef["evidence/ui/new-kronos/timecard.fixture.json"]
      ?.assertions.find(({ semanticId }) => semanticId === "new-kronos.timecard.displayed-eid");
    if (portAssertion === undefined) throw new Error("New Kronos displayed-EID fixture assertion missing");
    portAssertion.portMapRows = [{ system: "new-kronos", legacyKey: "search.firstResultSlat()" }];
    assert.match(auditNewKronosUiEvidenceBindings(wrongPortRow).join("\n"), /assertion port-map rows drifted/);

    // And a ported row whose canonical id is dropped must refuse rather than
    // leave the element silently unbound.
    const missingBinding = structuredClone(newKronosEvidenceBindingInput()) as {
      portBindings: { legacyKey: string }[];
    };
    missingBinding.portBindings = missingBinding.portBindings.filter(({ legacyKey }) =>
      legacyKey !== "timecard.loadedEmployeeId()"
    );
    assert.match(
      auditNewKronosUiEvidenceBindings(missingBinding).join("\n"),
      /does not resolve to its exact New Kronos ported row/,
    );
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

    const crossScreenState = structuredClone(UCPATH_UI_REGISTRY);
    crossScreenState.elements[0] = {
      ...crossScreenState.elements[0],
      requiredStates: [crossScreenState.states[3].id],
    };
    assert.match(auditUcpathUiRegistry(crossScreenState).join("\n"), /required state crosses screens/);

    const supersedesCycle = structuredClone(UCPATH_UI_REGISTRY);
    supersedesCycle.elements[0] = {
      ...supersedesCycle.elements[0],
      supersedes: [supersedesCycle.elements[1].id],
    };
    supersedesCycle.elements[1] = {
      ...supersedesCycle.elements[1],
      supersedes: [supersedesCycle.elements[0].id],
    };
    assert.match(auditUcpathUiRegistry(supersedesCycle).join("\n"), /supersedes cycle/);
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
