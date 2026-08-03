import { z } from "zod";
import { deepFreeze } from "../../../domain/immutability.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
} from "../../../domain/ids.js";
import {
  UiEffectSchema,
  UiEvidenceReferenceSchema,
  UiPortMapRowReferenceSchema,
  UiRoleSchema,
  UiSensitivitySchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
  UiVerificationSchema,
} from "../../../domain/ui/contracts.js";
import {
  CRM_ONBOARDING_DISPLAYED_EID,
  CRM_ONBOARDING_HISTORY_READY,
  CRM_ONBOARDING_HISTORY_ROWS,
  CRM_ONBOARDING_HISTORY_SCREEN,
  CRM_ONBOARDING_RECORD_FIELD_VALUE,
  CRM_ONBOARDING_RECORD_READY,
  CRM_ONBOARDING_RECORD_SCREEN,
  CRM_ONBOARDING_SEARCH_EMPTY,
  CRM_ONBOARDING_SEARCH_READY,
  CRM_ONBOARDING_SEARCH_RESULT_NAME_LINK,
  CRM_ONBOARDING_SEARCH_RESULT_ROW_CELLS,
  CRM_ONBOARDING_SEARCH_RESULT_ROWS,
  CRM_ONBOARDING_SEARCH_SCREEN,
} from "../../../domain/ui/crm-onboarding.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../domain/trust/preflight-scenarios.js";

const LEGACY_COMMIT = "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc";
const CRM_SELECTOR_BLOB = "e63530d375478dd330d07460c740f2027dbd7bdd";
const FIXTURE_EVIDENCE = "evidence/ui/crm/onboarding.fixture.json";
const LIVE_EVIDENCE = "evidence/ui/crm/onboarding.live.json";
const SEARCH_SCENARIO = "ui/crm-onboarding-search-results";
const RECORD_SCENARIO = "ui/crm-onboarding-record-identity";
const HISTORY_SCENARIO = "ui/crm-onboarding-history-transitions";

const SEARCH_ROWS_PORT_KEY = "search.resultRows()";
const SEARCH_CELLS_PORT_KEY = "search.resultRowCells()";
const SEARCH_LINK_PORT_KEY = "search.resultRowNameLink()";
const RECORD_FIELD_PORT_KEY = "record.thLabelFollowingTd()";
const HISTORY_ROWS_PORT_KEY = "onboardingHistory.historyRows()";

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const LegacySelectorProvenanceSchema = z.strictObject({
  commit: z.literal(LEGACY_COMMIT),
  path: z.literal("src/systems/crm/selectors.ts"),
  key: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/u),
  sourceLine: z.number().int().positive(),
  blob: GitBlobSchema,
});

export const CrmLocatorRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("css"), selector: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("row-cells"),
    rowElement: ElementIdSchema,
    selector: z.literal(":scope > td"),
  }),
  z.strictObject({
    kind: z.literal("row-name-link"),
    rowElement: ElementIdSchema,
    selector: z.literal(":scope > td:first-child a"),
  }),
  z.strictObject({
    kind: z.literal("label-following-cell"),
    labelCell: z.literal("th"),
    valueSelector: z.literal("xpath=following-sibling::td[1]"),
  }),
]);

export const CrmStateEvidenceRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("url-path"),
    path: z.enum([
      "/hr/ONB_SearchOnboardings",
      "/hr/ONB_ViewOnboarding",
      "/hr/ONB_ShowOnboardingHistory",
    ]),
  }),
  z.strictObject({
    kind: z.literal("heading"),
    name: z.enum(["Search Results", "No search results were found."]),
    exact: z.literal(true),
  }),
  z.strictObject({ kind: z.literal("element"), element: ElementIdSchema }),
]);

export const CrmObservationRecipeSchema = z.strictObject({
  kind: z.literal("labeled-field"),
  element: z.literal(CRM_ONBOARDING_RECORD_FIELD_VALUE),
  label: z.literal("UCPath Employee ID"),
  valueType: z.literal("eid"),
});

const ScreenDefinitionSchema = z.strictObject({
  id: ScreenIdSchema,
  system: BrowserSystemIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  verification: UiVerificationSchema,
});

const ElementDefinitionSchema = z.strictObject({
  id: ElementIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  role: UiRoleSchema,
  effect: UiEffectSchema,
  sensitivity: UiSensitivitySchema,
  locator: CrmLocatorRecipeSchema,
  requiredStates: z.array(PageStateIdSchema),
  verification: UiVerificationSchema,
  provenance: LegacySelectorProvenanceSchema,
  supersedes: z.array(ElementIdSchema),
});

const PageStateDefinitionSchema = z.strictObject({
  id: PageStateIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  evidence: z.array(CrmStateEvidenceRuleSchema).min(1),
  timeoutMs: z.number().int().positive(),
  verification: UiVerificationSchema,
});

const ObservationDefinitionSchema = z.strictObject({
  id: ObservationIdSchema,
  system: BrowserSystemIdSchema,
  screen: ScreenIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  valueType: z.literal("eid"),
  read: CrmObservationRecipeSchema,
  authoritativeFor: z.array(z.enum(["subject", "completion", "page-state"])).min(1),
  verification: UiVerificationSchema,
});

export const CrmUiRegistrySchema = z.strictObject({
  system: z.literal("crm"),
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});

export const CrmUiRegistryPortBindingSchema = z.strictObject({
  system: z.literal("crm"),
  legacyKey: z.string().min(1),
  disposition: z.literal("ported"),
  semanticKind: z.literal("element"),
  canonicalId: ElementIdSchema,
  evidence: z.strictObject({
    verifiedAt: DateOnlySchema,
    fixtureEvidenceRef: UiEvidenceReferenceSchema,
    liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
  }),
});

const CrmUiEvidenceBindingInputSchema = z.strictObject({
  evidenceByRef: z.record(UiEvidenceReferenceSchema, UiVerificationEvidenceManifestSchema),
  portBindings: z.array(CrmUiRegistryPortBindingSchema),
});

function verification(scenario: string, legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse("2026-08-02"),
    fixtureEvidenceRef: FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
    portMapRows: [{ system: "crm" as const, legacyKey }],
  };
}

function provenance(key: string, sourceLine: number) {
  return {
    commit: LEGACY_COMMIT,
    path: "src/systems/crm/selectors.ts" as const,
    key,
    sourceLine,
    blob: CRM_SELECTOR_BLOB,
  };
}

export const CRM_UI_REGISTRY = deepFreeze(CrmUiRegistrySchema.parse({
  system: "crm",
  screens: [
    {
      id: CRM_ONBOARDING_SEARCH_SCREEN,
      system: "crm",
      label: "CRM onboarding search results",
      searchTerms: ["crm onboarding search screen"],
      sensitivity: "hr",
      verification: verification(SEARCH_SCENARIO, SEARCH_ROWS_PORT_KEY),
    },
    {
      id: CRM_ONBOARDING_RECORD_SCREEN,
      system: "crm",
      label: "CRM onboarding record",
      searchTerms: ["crm onboarding record screen"],
      sensitivity: "hr",
      verification: verification(RECORD_SCENARIO, RECORD_FIELD_PORT_KEY),
    },
    {
      id: CRM_ONBOARDING_HISTORY_SCREEN,
      system: "crm",
      label: "CRM onboarding history",
      searchTerms: ["crm onboarding history screen"],
      sensitivity: "hr",
      verification: verification(HISTORY_SCENARIO, HISTORY_ROWS_PORT_KEY),
    },
  ],
  elements: [
    {
      id: CRM_ONBOARDING_SEARCH_RESULT_ROWS,
      system: "crm",
      screen: CRM_ONBOARDING_SEARCH_SCREEN,
      label: "Onboarding search result rows",
      searchTerms: ["crm onboarding result rows"],
      role: "grid",
      effect: "observe",
      sensitivity: "hr",
      locator: { kind: "css", selector: "table tbody tr" },
      requiredStates: [CRM_ONBOARDING_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, SEARCH_ROWS_PORT_KEY),
      provenance: provenance(SEARCH_ROWS_PORT_KEY, 18),
      supersedes: [],
    },
    {
      id: CRM_ONBOARDING_SEARCH_RESULT_ROW_CELLS,
      system: "crm",
      screen: CRM_ONBOARDING_SEARCH_SCREEN,
      label: "Onboarding search result row cells",
      searchTerms: ["crm onboarding result row cells"],
      role: "row",
      effect: "observe",
      sensitivity: "hr",
      locator: {
        kind: "row-cells",
        rowElement: CRM_ONBOARDING_SEARCH_RESULT_ROWS,
        selector: ":scope > td",
      },
      requiredStates: [CRM_ONBOARDING_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, SEARCH_CELLS_PORT_KEY),
      provenance: provenance(SEARCH_CELLS_PORT_KEY, 36),
      supersedes: [],
    },
    {
      id: CRM_ONBOARDING_SEARCH_RESULT_NAME_LINK,
      system: "crm",
      screen: CRM_ONBOARDING_SEARCH_SCREEN,
      label: "Onboarding search result name link",
      searchTerms: ["crm onboarding result name link"],
      role: "link",
      effect: "navigate",
      sensitivity: "hr",
      locator: {
        kind: "row-name-link",
        rowElement: CRM_ONBOARDING_SEARCH_RESULT_ROWS,
        selector: ":scope > td:first-child a",
      },
      requiredStates: [CRM_ONBOARDING_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, SEARCH_LINK_PORT_KEY),
      provenance: provenance(SEARCH_LINK_PORT_KEY, 45),
      supersedes: [],
    },
    {
      id: CRM_ONBOARDING_RECORD_FIELD_VALUE,
      system: "crm",
      screen: CRM_ONBOARDING_RECORD_SCREEN,
      label: "Onboarding record labeled field value",
      searchTerms: ["crm onboarding labeled record field"],
      role: "display",
      effect: "observe",
      sensitivity: "restricted",
      locator: {
        kind: "label-following-cell",
        labelCell: "th",
        valueSelector: "xpath=following-sibling::td[1]",
      },
      requiredStates: [CRM_ONBOARDING_RECORD_READY],
      verification: verification(RECORD_SCENARIO, RECORD_FIELD_PORT_KEY),
      provenance: provenance(RECORD_FIELD_PORT_KEY, 57),
      supersedes: [],
    },
    {
      id: CRM_ONBOARDING_HISTORY_ROWS,
      system: "crm",
      screen: CRM_ONBOARDING_HISTORY_SCREEN,
      label: "Onboarding history rows",
      searchTerms: ["crm onboarding history rows"],
      role: "grid",
      effect: "observe",
      sensitivity: "restricted",
      locator: { kind: "css", selector: "table.detailList tr" },
      requiredStates: [CRM_ONBOARDING_HISTORY_READY],
      verification: verification(HISTORY_SCENARIO, HISTORY_ROWS_PORT_KEY),
      provenance: provenance(HISTORY_ROWS_PORT_KEY, 176),
      supersedes: [],
    },
  ],
  states: [
    {
      id: CRM_ONBOARDING_SEARCH_READY,
      system: "crm",
      screen: CRM_ONBOARDING_SEARCH_SCREEN,
      label: "CRM onboarding search results ready",
      searchTerms: ["crm onboarding search ready state"],
      sensitivity: "hr",
      evidence: [
        { kind: "url-path", path: "/hr/ONB_SearchOnboardings" },
        { kind: "heading", name: "Search Results", exact: true },
      ],
      timeoutMs: 30_000,
      verification: verification(SEARCH_SCENARIO, SEARCH_ROWS_PORT_KEY),
    },
    {
      id: CRM_ONBOARDING_SEARCH_EMPTY,
      system: "crm",
      screen: CRM_ONBOARDING_SEARCH_SCREEN,
      label: "CRM onboarding search has no results",
      searchTerms: ["crm onboarding no search results state"],
      sensitivity: "hr",
      evidence: [
        { kind: "url-path", path: "/hr/ONB_SearchOnboardings" },
        { kind: "heading", name: "No search results were found.", exact: true },
      ],
      timeoutMs: 30_000,
      verification: verification(SEARCH_SCENARIO, SEARCH_ROWS_PORT_KEY),
    },
    {
      id: CRM_ONBOARDING_RECORD_READY,
      system: "crm",
      screen: CRM_ONBOARDING_RECORD_SCREEN,
      label: "CRM onboarding record identity ready",
      searchTerms: ["crm onboarding record identity ready state"],
      sensitivity: "restricted",
      evidence: [
        { kind: "url-path", path: "/hr/ONB_ViewOnboarding" },
        { kind: "element", element: CRM_ONBOARDING_RECORD_FIELD_VALUE },
      ],
      timeoutMs: 30_000,
      verification: verification(RECORD_SCENARIO, RECORD_FIELD_PORT_KEY),
    },
    {
      id: CRM_ONBOARDING_HISTORY_READY,
      system: "crm",
      screen: CRM_ONBOARDING_HISTORY_SCREEN,
      label: "CRM onboarding history ready",
      searchTerms: ["crm onboarding history ready state"],
      sensitivity: "restricted",
      evidence: [
        { kind: "url-path", path: "/hr/ONB_ShowOnboardingHistory" },
        { kind: "element", element: CRM_ONBOARDING_HISTORY_ROWS },
      ],
      timeoutMs: 30_000,
      verification: verification(HISTORY_SCENARIO, HISTORY_ROWS_PORT_KEY),
    },
  ],
  observations: [
    {
      id: CRM_ONBOARDING_DISPLAYED_EID,
      system: "crm",
      screen: CRM_ONBOARDING_RECORD_SCREEN,
      label: "Displayed CRM onboarding EID",
      searchTerms: ["authoritative crm onboarding displayed eid"],
      sensitivity: "restricted",
      valueType: "eid",
      read: {
        kind: "labeled-field",
        element: CRM_ONBOARDING_RECORD_FIELD_VALUE,
        label: "UCPath Employee ID",
        valueType: "eid",
      },
      authoritativeFor: ["subject", "page-state"],
      verification: verification(RECORD_SCENARIO, RECORD_FIELD_PORT_KEY),
    },
  ],
  scenarios: [
    {
      id: SEARCH_SCENARIO,
      kind: "ui-verification",
      title: "CRM onboarding search rows and verified empty state resolve",
      system: "crm",
      semanticIds: [
        CRM_ONBOARDING_SEARCH_RESULT_ROWS,
        CRM_ONBOARDING_SEARCH_RESULT_ROW_CELLS,
        CRM_ONBOARDING_SEARCH_RESULT_NAME_LINK,
        CRM_ONBOARDING_SEARCH_READY,
        CRM_ONBOARDING_SEARCH_EMPTY,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: RECORD_SCENARIO,
      kind: "ui-verification",
      title: "CRM onboarding record exposes an authoritative exact EID",
      system: "crm",
      semanticIds: [
        CRM_ONBOARDING_RECORD_FIELD_VALUE,
        CRM_ONBOARDING_RECORD_READY,
        CRM_ONBOARDING_DISPLAYED_EID,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "displayed-eid-equals-query"],
    },
    {
      id: HISTORY_SCENARIO,
      kind: "ui-verification",
      title: "CRM onboarding history exposes exact five-cell transitions",
      system: "crm",
      semanticIds: [CRM_ONBOARDING_HISTORY_ROWS, CRM_ONBOARDING_HISTORY_READY],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
  ],
}));

export type CrmUiRegistry = z.infer<typeof CrmUiRegistrySchema>;

export function auditCrmUiRegistry(registryInput: unknown = CRM_UI_REGISTRY): readonly string[] {
  const result = CrmUiRegistrySchema.safeParse(registryInput);
  if (!result.success) return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const registry = result.data;
  const issues: string[] = [];
  const allIds = [
    ...registry.screens.map(({ id }) => id),
    ...registry.elements.map(({ id }) => id),
    ...registry.states.map(({ id }) => id),
    ...registry.observations.map(({ id }) => id),
  ];
  if (new Set(allIds).size !== allIds.length) issues.push("CRM semantic UI ids must be globally unique");
  const searchTerms = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations]
    .flatMap((fact) => fact.searchTerms.map((term) => term.trim().toLowerCase()));
  if (new Set(searchTerms).size !== searchTerms.length) issues.push("CRM search terms must resolve to one canonical id");
  const screens = new Set(registry.screens.map(({ id }) => id));
  const elements = new Map(registry.elements.map((element) => [element.id, element]));
  const states = new Map(registry.states.map((state) => [state.id, state]));
  const scenarios = new Set(registry.scenarios.map(({ id }) => id));
  const facts = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations];
  for (const fact of facts) {
    if (fact.system !== "crm") issues.push(`${fact.id} crosses the CRM system boundary`);
    for (const scenario of fact.verification.scenarios) {
      if (!scenarios.has(scenario)) issues.push(`${fact.id} references unknown verification scenario ${scenario}`);
    }
  }
  for (const fact of [...registry.elements, ...registry.states, ...registry.observations]) {
    if (!screens.has(fact.screen)) issues.push(`${fact.id} references an unknown CRM screen`);
  }
  for (const element of registry.elements) {
    for (const state of element.requiredStates) {
      const stateDefinition = states.get(state);
      if (stateDefinition === undefined) issues.push(`${element.id} references unknown state ${state}`);
      else if (stateDefinition.screen !== element.screen) issues.push(`${element.id} required state crosses screens`);
    }
    if (element.locator.kind === "row-cells" || element.locator.kind === "row-name-link") {
      if (!elements.has(element.locator.rowElement)) {
        issues.push(`${element.id} references unknown row element ${element.locator.rowElement}`);
      }
    }
  }
  for (const state of registry.states) {
    for (const evidence of state.evidence) {
      if (evidence.kind === "element" && !elements.has(evidence.element)) {
        issues.push(`${state.id} references unknown evidence element ${evidence.element}`);
      }
    }
  }
  for (const observation of registry.observations) {
    if (!elements.has(observation.read.element)) {
      issues.push(`${observation.id} reads an unknown CRM element`);
    }
  }
  const globalScenarioIds = [
    ...PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => ScenarioIdSchema.parse(id)),
    ...registry.scenarios.map(({ id }) => id),
  ];
  if (new Set(globalScenarioIds).size !== globalScenarioIds.length) {
    issues.push("CRM UI scenario ids must be globally unique");
  }
  const semanticIds = new Set(allIds);
  const referencedScenarios = new Set(facts.flatMap(({ verification: value }) => value.scenarios));
  for (const scenario of registry.scenarios) {
    for (const id of scenario.semanticIds) {
      if (!semanticIds.has(id)) issues.push(`${scenario.id} references unknown CRM semantic id ${id}`);
    }
    if (!referencedScenarios.has(scenario.id)) issues.push(`CRM verification scenario ${scenario.id} is vacuous`);
  }
  return issues;
}

function portRowKey(row: z.infer<typeof UiPortMapRowReferenceSchema>): string {
  return `${row.system}:${row.legacyKey}`;
}

export function auditCrmUiEvidenceBindings(input: unknown): readonly string[] {
  const parsed = CrmUiEvidenceBindingInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { evidenceByRef, portBindings } = parsed.data;
  const issues: string[] = [];
  const facts = [
    ...CRM_UI_REGISTRY.screens.map((fact) => ({ ...fact, screen: fact.id })),
    ...CRM_UI_REGISTRY.elements,
    ...CRM_UI_REGISTRY.states,
    ...CRM_UI_REGISTRY.observations,
  ];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const bindingsByRow = new Map(portBindings.map((binding) => [
    portRowKey({ system: binding.system, legacyKey: binding.legacyKey }),
    binding,
  ]));
  for (const fact of facts) {
    const expectedRows = fact.verification.portMapRows.map(portRowKey);
    for (const row of fact.verification.portMapRows) {
      if (!bindingsByRow.has(portRowKey(row))) {
        issues.push(`${fact.id} references unknown CRM port-map row ${portRowKey(row)}`);
      }
    }
    const evidenceRefs = [
      [fact.verification.fixtureEvidenceRef, "deterministic-fixture"],
      [fact.verification.liveReadOnlyEvidenceRef, "live-read-only"],
    ] as const;
    for (const [ref, evidenceKind] of evidenceRefs) {
      const manifest = evidenceByRef[ref];
      if (manifest === undefined) {
        issues.push(`${fact.id} is missing CRM evidence manifest ${ref}`);
        continue;
      }
      if (manifest.evidenceKind !== evidenceKind) issues.push(`${fact.id} ${ref} has the wrong evidence kind`);
      if (manifest.system !== "crm") issues.push(`${fact.id} ${ref} crosses systems`);
      if (manifest.verifiedAt !== fact.verification.verifiedAt) issues.push(`${fact.id} ${ref} verification date drifted`);
      if (!manifest.screens.includes(fact.screen)) issues.push(`${fact.id} ${ref} omits screen ${fact.screen}`);
      const assertions = manifest.assertions.filter(({ semanticId }) => semanticId === fact.id);
      if (assertions.length !== 1) issues.push(`${fact.id} ${ref} must have exactly one evidence assertion`);
      for (const assertion of assertions) {
        if (assertion.screen !== fact.screen) issues.push(`${fact.id} ${ref} assertion screen drifted`);
        if (!fact.verification.scenarios.includes(assertion.scenarioId)) {
          issues.push(`${fact.id} ${ref} assertion scenario drifted`);
        }
        if (JSON.stringify(assertion.portMapRows.map(portRowKey)) !== JSON.stringify(expectedRows)) {
          issues.push(`${fact.id} ${ref} assertion port-map rows drifted`);
        }
      }
    }
  }
  for (const [ref, manifest] of Object.entries(evidenceByRef)) {
    for (const assertion of manifest.assertions) {
      if (!factsById.has(assertion.semanticId)) issues.push(`${ref} asserts unknown CRM semantic id ${assertion.semanticId}`);
    }
  }
  for (const element of CRM_UI_REGISTRY.elements) {
    const binding = bindingsByRow.get(portRowKey({ system: "crm", legacyKey: element.provenance.key }));
    if (binding === undefined || binding.canonicalId !== element.id) {
      issues.push(`${element.id} does not resolve to its exact CRM ported row`);
      continue;
    }
    if (binding.evidence.verifiedAt !== element.verification.verifiedAt
      || binding.evidence.fixtureEvidenceRef !== element.verification.fixtureEvidenceRef
      || binding.evidence.liveReadOnlyEvidenceRef !== element.verification.liveReadOnlyEvidenceRef) {
      issues.push(`${element.id} CRM port-map evidence drifted`);
    }
  }
  return issues;
}
