import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { PageStateIdSchema, ScenarioIdSchema, TaskIdSchema } from "../../../src/rules/identity/ids.js";
import { UiVerificationEvidenceManifestSchema } from "../../../src/models/ui/contracts.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/models/trust/preflight-scenarios.js";
import {
  CRM_UI_REGISTRY,
  auditCrmUiEvidenceBindings,
  auditCrmUiRegistry,
} from "../../../src/backend/systems/crm/driver/ui-registry.js";
import { KUALI_UI_REGISTRY } from "../../../src/backend/systems/kuali/driver/ui-registry.js";
import { buildUiTaskLinks } from "../../../src/backend/systems/ui-task-links.js";
import {
  NEW_KRONOS_UI_REGISTRY,
  auditNewKronosUiEvidenceBindings,
  auditNewKronosUiRegistry,
} from "../../../src/backend/systems/new-kronos/driver/ui-registry.js";
import {
  UCPATH_UI_REGISTRY,
  auditUcpathUiEvidenceBindings,
  auditUcpathUiRegistry,
} from "../../../src/backend/systems/ucpath/driver/ui-registry.js";
import bindings from "./fixtures/selector-evidence-bindings.json" with { type: "json" };

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8"));
}

function evidenceBindingInput(): unknown {
  const portMap = bindings;
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
      "tests/support/fixtures/ui/ucpath/person-org.fixture.json": readJson("tests/support/fixtures/ui/ucpath/person-org.fixture.json"),
      "tests/support/fixtures/ui/ucpath/person-org.live.json": readJson("tests/support/fixtures/ui/ucpath/person-org.live.json"),
      "tests/support/fixtures/ui/ucpath/ss-smart-hr.fixture.json": readJson("tests/support/fixtures/ui/ucpath/ss-smart-hr.fixture.json"),
      "tests/support/fixtures/ui/ucpath/ss-smart-hr.live.json": readJson("tests/support/fixtures/ui/ucpath/ss-smart-hr.live.json"),
      "tests/support/fixtures/ui/ucpath/smart-hr-termination.fixture.json":
        readJson("tests/support/fixtures/ui/ucpath/smart-hr-termination.fixture.json"),
      "tests/support/fixtures/ui/ucpath/smart-hr-termination.live.json":
        readJson("tests/support/fixtures/ui/ucpath/smart-hr-termination.live.json"),
    },
    portBindings,
  };
}

function crmEvidenceBindingInput(): unknown {
  const portMap = bindings;
  return {
    evidenceByRef: {
      "tests/support/fixtures/ui/crm/onboarding.fixture.json": readJson("tests/support/fixtures/ui/crm/onboarding.fixture.json"),
      "tests/support/fixtures/ui/crm/onboarding.live.json": readJson("tests/support/fixtures/ui/crm/onboarding.live.json"),
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
  const portMap = bindings;
  return {
    evidenceByRef: {
      "tests/support/fixtures/ui/new-kronos/timecard.fixture.json": readJson("tests/support/fixtures/ui/new-kronos/timecard.fixture.json"),
      "tests/support/fixtures/ui/new-kronos/timecard.live.json": readJson("tests/support/fixtures/ui/new-kronos/timecard.live.json"),
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

  it("keeps semantic task links bound to every published registry and exact task uses", () => {
    const registries = [UCPATH_UI_REGISTRY, CRM_UI_REGISTRY, KUALI_UI_REGISTRY, NEW_KRONOS_UI_REGISTRY];
    const published = registries.flatMap((registry) => [
      ...registry.screens.map((entry) => ({ kind: "screen", ...entry })),
      ...registry.elements.map((entry) => ({ kind: "element", ...entry })),
      ...registry.states.map((entry) => ({ kind: "page-state", ...entry })),
      ...registry.observations.map((entry) => ({ kind: "observation", ...entry })),
    ]);
    const links = buildUiTaskLinks();
    assert.deepEqual(links.map(({ id }) => id).sort(), published.map(({ id }) => id).sort());
    assert.equal(new Set(links.map(({ id }) => id)).size, links.length);
    for (const entry of published) {
      const link = links.find(({ id }) => id === entry.id);
      assert.ok(link !== undefined, `missing semantic task link for ${entry.id}`);
      assert.equal(link.kind, entry.kind, `${entry.id}: semantic kind drifted`);
      assert.equal(link.system, entry.system, `${entry.id}: system drifted`);
      assert.equal(link.label, entry.label, `${entry.id}: label drifted`);
      assert.deepEqual(link.verification, { verifiedAt: entry.verification.verifiedAt }, `${entry.id}: verification drifted`);
    }
    assert.deepEqual(
      links.find(({ id }) => id === "ucpath.smart-hr.save-and-submit-button")?.taskUses,
      ["ucpath/create-termination"],
      "the real commit control belongs only to its commit task",
    );
    assert.ok(
      links.find(({ id }) => id === "kuali.action-list")?.taskUses.includes(TaskIdSchema.parse("kuali/search-separation-action")),
      "the Kuali action list remains attributed to the search task",
    );
  });

  it("requires every published element to be explicitly ported with dual evidence", () => {
    const portMap = bindings;
    const publishedElementIds = buildUiTaskLinks().flatMap((entry) => entry.kind === "element" ? [entry.id] : []);
    const portedElementIds = portMap.entries.flatMap((entry) => {
      if (entry.disposition !== "ported" || entry.semanticKind !== "element") return [];
      return entry.canonicalBindings !== undefined
        ? entry.canonicalBindings.map(({ canonicalId }) => canonicalId)
        : [entry.canonicalId];
    });
    assert.deepEqual([...publishedElementIds].sort(), [...portedElementIds].sort());
    for (const entry of portMap.entries) {
      if (entry.disposition !== "ported") continue;
      assert.ok(entry.evidence !== undefined, "published selector must carry dual evidence");
      UiVerificationEvidenceManifestSchema.parse(readJson(entry.evidence.fixtureEvidenceRef));
      UiVerificationEvidenceManifestSchema.parse(readJson(entry.evidence.liveReadOnlyEvidenceRef));
    }
  });

  it("binds every published fact to exact evidence and exact selector bindings", () => {
    assert.deepEqual(auditUcpathUiEvidenceBindings(evidenceBindingInput()), []);
    assert.deepEqual(auditCrmUiEvidenceBindings(crmEvidenceBindingInput()), []);
    assert.deepEqual(auditNewKronosUiEvidenceBindings(newKronosEvidenceBindingInput()), []);

    const wrongScreen = structuredClone(evidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { screen: string }[] }>;
    };
    const screenAssertion = wrongScreen.evidenceByRef["tests/support/fixtures/ui/ucpath/person-org.fixture.json"]?.assertions[0];
    if (!screenAssertion) throw new Error("fixture evidence assertion missing");
    screenAssertion.screen = "ucpath.person-org.detail";
    assert.match(auditUcpathUiEvidenceBindings(wrongScreen).join("\n"), /assertion screen drifted/);

    const wrongScenario = structuredClone(evidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { scenarioId: string }[] }>;
    };
    const fixtureAssertion = wrongScenario.evidenceByRef["tests/support/fixtures/ui/ucpath/person-org.fixture.json"]?.assertions[0];
    if (!fixtureAssertion) throw new Error("fixture evidence assertion missing");
    fixtureAssertion.scenarioId = "ui/ucpath-person-org-displayed-eid";
    assert.match(auditUcpathUiEvidenceBindings(wrongScenario).join("\n"), /assertion scenario drifted/);

    const wrongPortRow = structuredClone(evidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { portMapRows: { system: string; legacyKey: string }[] }[] }>;
    };
    const portAssertion = wrongPortRow.evidenceByRef["tests/support/fixtures/ui/ucpath/person-org.fixture.json"]?.assertions[0];
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
    const assertion = wrongPortRow.evidenceByRef["tests/support/fixtures/ui/crm/onboarding.fixture.json"]
      ?.assertions.find(({ semanticId }) => semanticId === "crm.onboarding.displayed-eid");
    if (assertion === undefined) throw new Error("CRM displayed-EID fixture assertion missing");
    assertion.portMapRows = [{ system: "crm", legacyKey: "search.resultRows()" }];
    assert.match(auditCrmUiEvidenceBindings(wrongPortRow).join("\n"), /assertion port-map rows drifted/);
  });

  it("rejects New Kronos evidence whose timecard fact is rebound to the search screen or a search port", () => {

    const wrongScreen = structuredClone(newKronosEvidenceBindingInput()) as {
      evidenceByRef: Record<string, { assertions: { semanticId: string; screen: string }[] }>;
    };
    const screenAssertion = wrongScreen.evidenceByRef["tests/support/fixtures/ui/new-kronos/timecard.live.json"]
      ?.assertions.find(({ semanticId }) => semanticId === "new-kronos.timecard.displayed-eid");
    if (screenAssertion === undefined) throw new Error("New Kronos displayed-EID live assertion missing");
    screenAssertion.screen = "new-kronos.employee-search";
    assert.match(auditNewKronosUiEvidenceBindings(wrongScreen).join("\n"), /assertion screen drifted/);

    const wrongPortRow = structuredClone(newKronosEvidenceBindingInput()) as {
      evidenceByRef: Record<string, {
        assertions: { semanticId: string; portMapRows: { system: string; legacyKey: string }[] }[];
      }>;
    };
    const portAssertion = wrongPortRow.evidenceByRef["tests/support/fixtures/ui/new-kronos/timecard.fixture.json"]
      ?.assertions.find(({ semanticId }) => semanticId === "new-kronos.timecard.displayed-eid");
    if (portAssertion === undefined) throw new Error("New Kronos displayed-EID fixture assertion missing");
    portAssertion.portMapRows = [{ system: "new-kronos", legacyKey: "search.firstResultSlat()" }];
    assert.match(auditNewKronosUiEvidenceBindings(wrongPortRow).join("\n"), /assertion port-map rows drifted/);


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
