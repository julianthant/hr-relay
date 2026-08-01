import { z } from "zod";
import { deepFreeze } from "../../../domain/immutability.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  EidSchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
} from "../../../domain/ids.js";
import {
  UiEffectSchema,
  UiRoleSchema,
  UiSensitivitySchema,
  UiEvidenceReferenceSchema,
  UiPortMapRowReferenceSchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
  UiVerificationSchema,
} from "../../../domain/ui/contracts.js";
import {
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_EID_DISPLAY,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../domain/ui/ucpath-person-org.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../domain/trust/preflight-scenarios.js";

const LEGACY_COMMIT = "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc";
const UCPATH_SELECTOR_BLOB = "695d88fcc7a108f262b91b45eb1b9a276deaf427";
const FIXTURE_EVIDENCE = "evidence/ui/ucpath/person-org.fixture.json";
const LIVE_EVIDENCE = "evidence/ui/ucpath/person-org.live.json";
const SEARCH_SCENARIO = "ui/ucpath-person-org-search-eid-input";
const DISPLAY_SCENARIO = "ui/ucpath-person-org-displayed-eid";
const INPUT_PORT_KEY = "personOrgSummary.emplIdInput()";
const DISPLAY_PORT_KEY = "personOrgSummary.personIdValue()";

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/);
const LegacySelectorProvenanceSchema = z.strictObject({
  commit: z.literal(LEGACY_COMMIT),
  path: z.literal("src/systems/ucpath/selectors.ts"),
  key: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/),
  sourceLine: z.number().int().positive(),
  blob: GitBlobSchema,
});

export const LocatorRecipeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("role"),
    role: z.literal("textbox"),
    name: z.string().min(1),
    exact: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("css"), selector: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("css-fallback"),
    selectors: z.array(z.string().min(1)).min(2),
  }),
]);

export const StateEvidenceRuleSchema = z.strictObject({
  kind: z.literal("visible"),
  element: ElementIdSchema,
});

export const ObservationRecipeSchema = z.strictObject({
  kind: z.literal("element-text"),
  element: ElementIdSchema,
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
  valueType: z.enum(["eid", "none"]),
  locator: LocatorRecipeSchema,
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
  evidence: z.array(StateEvidenceRuleSchema).min(1),
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
  read: ObservationRecipeSchema,
  authoritativeFor: z.array(z.enum(["subject", "completion", "page-state"])).min(1),
  verification: UiVerificationSchema,
});

const DriverRootRecipeSchema = z.strictObject({
  kind: z.literal("content-frame"),
  selector: z.literal("#main_target_win0"),
  verification: UiVerificationSchema,
  provenance: LegacySelectorProvenanceSchema,
});

export const UiRegistrySchema = z.strictObject({
  system: BrowserSystemIdSchema,
  root: DriverRootRecipeSchema,
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});

export const UiRegistryPortBindingSchema = z.union([
  z.strictObject({
    system: BrowserSystemIdSchema,
    legacyKey: z.string().min(1),
    disposition: z.literal("ported"),
    semanticKind: z.literal("element"),
    canonicalId: ElementIdSchema,
    evidence: z.strictObject({
      verifiedAt: DateOnlySchema,
      fixtureEvidenceRef: UiEvidenceReferenceSchema,
      liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
    }),
  }),
  z.strictObject({
    system: BrowserSystemIdSchema,
    legacyKey: z.string().min(1),
    disposition: z.literal("driver-internal"),
    semanticKind: z.literal("driver-internal"),
  }),
]);

const UiEvidenceBindingInputSchema = z.strictObject({
  evidenceByRef: z.record(UiEvidenceReferenceSchema, UiVerificationEvidenceManifestSchema),
  portBindings: z.array(UiRegistryPortBindingSchema),
});

function verification(scenario: string, legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse("2026-08-01"),
    fixtureEvidenceRef: FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
    portMapRows: [{ system: "ucpath" as const, legacyKey }],
  };
}

export const UCPATH_UI_REGISTRY = deepFreeze(UiRegistrySchema.parse({
  system: "ucpath",
  root: {
    kind: "content-frame",
    selector: "#main_target_win0",
    verification: verification(SEARCH_SCENARIO, "getContentFrame()"),
    provenance: {
      commit: LEGACY_COMMIT,
      path: "src/systems/ucpath/selectors.ts",
      key: "getContentFrame()",
      sourceLine: 41,
      blob: UCPATH_SELECTOR_BLOB,
    },
  },
  screens: [
    {
      id: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      system: "ucpath",
      label: "Person Organizational Summary search",
      searchTerms: ["ucpath person org search screen"],
      sensitivity: "hr",
      verification: verification(SEARCH_SCENARIO, INPUT_PORT_KEY),
    },
    {
      id: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      system: "ucpath",
      label: "Person Organizational Summary detail",
      searchTerms: ["ucpath person org detail screen"],
      sensitivity: "hr",
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
    },
  ],
  elements: [
    {
      id: UCPATH_PERSON_ORG_EID_INPUT,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org EID input",
      searchTerms: ["person org eid input", "ucpath person org search eid"],
      role: "field",
      effect: "prepare",
      sensitivity: "hr",
      valueType: "eid",
      locator: { kind: "role", role: "textbox", name: "Empl ID", exact: true },
      requiredStates: [UCPATH_PERSON_ORG_SEARCH_READY],
      verification: verification(SEARCH_SCENARIO, INPUT_PORT_KEY),
      provenance: {
        commit: LEGACY_COMMIT,
        path: "src/systems/ucpath/selectors.ts",
        key: INPUT_PORT_KEY,
        sourceLine: 908,
        blob: UCPATH_SELECTOR_BLOB,
      },
      supersedes: [],
    },
    {
      id: UCPATH_PERSON_ORG_EID_DISPLAY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org displayed EID",
      searchTerms: ["person org displayed eid element"],
      role: "display",
      effect: "observe",
      sensitivity: "hr",
      valueType: "eid",
      locator: {
        kind: "css-fallback",
        selectors: [
          "#PERSON_NPC_VW_EMPLID",
          "#PER_INST_EMP_VW_OPRID\\$0",
          "#PER_INST_EMP_VW_EMPLID\\$0",
        ],
      },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
      provenance: {
        commit: LEGACY_COMMIT,
        path: "src/systems/ucpath/selectors.ts",
        key: DISPLAY_PORT_KEY,
        sourceLine: 959,
        blob: UCPATH_SELECTOR_BLOB,
      },
      supersedes: [],
    },
  ],
  states: [
    {
      id: UCPATH_PERSON_ORG_SEARCH_READY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_SEARCH_SCREEN,
      label: "Person Org search ready",
      searchTerms: ["person org search eid ready state"],
      sensitivity: "hr",
      evidence: [{ kind: "visible", element: UCPATH_PERSON_ORG_EID_INPUT }],
      timeoutMs: 30_000,
      verification: verification(SEARCH_SCENARIO, INPUT_PORT_KEY),
    },
    {
      id: UCPATH_PERSON_ORG_DETAIL_READY,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Person Org detail ready",
      searchTerms: ["person org displayed eid ready state"],
      sensitivity: "hr",
      evidence: [{ kind: "visible", element: UCPATH_PERSON_ORG_EID_DISPLAY }],
      timeoutMs: 30_000,
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
    },
  ],
  observations: [
    {
      id: UCPATH_PERSON_ORG_DISPLAYED_EID,
      system: "ucpath",
      screen: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      label: "Displayed Person Org EID",
      searchTerms: ["authoritative person org displayed eid"],
      sensitivity: "hr",
      valueType: "eid",
      read: { kind: "element-text", element: UCPATH_PERSON_ORG_EID_DISPLAY, valueType: "eid" },
      authoritativeFor: ["subject", "page-state"],
      verification: verification(DISPLAY_SCENARIO, DISPLAY_PORT_KEY),
    },
  ],
  scenarios: [
    {
      id: SEARCH_SCENARIO,
      kind: "ui-verification",
      title: "UCPath Person Org EID input resolves",
      system: "ucpath",
      semanticIds: [UCPATH_PERSON_ORG_EID_INPUT, UCPATH_PERSON_ORG_SEARCH_READY],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["exactly-one-visible", "accepts-canonical-eid", "recipe-resolves"],
    },
    {
      id: DISPLAY_SCENARIO,
      kind: "ui-verification",
      title: "UCPath Person Org displayed EID is authoritative",
      system: "ucpath",
      semanticIds: [UCPATH_PERSON_ORG_EID_DISPLAY, UCPATH_PERSON_ORG_DISPLAYED_EID, UCPATH_PERSON_ORG_DETAIL_READY],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["exactly-one-visible", "displayed-eid-equals-query", "recipe-resolves"],
    },
  ],
}));

export type UcpathUiRegistry = z.infer<typeof UiRegistrySchema>;

export function auditUcpathUiRegistry(registryInput: unknown = UCPATH_UI_REGISTRY): readonly string[] {
  const result = UiRegistrySchema.safeParse(registryInput);
  if (!result.success) return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const registry = result.data;
  const issues: string[] = [];
  const allIds = [
    ...registry.screens.map(({ id }) => id),
    ...registry.elements.map(({ id }) => id),
    ...registry.states.map(({ id }) => id),
    ...registry.observations.map(({ id }) => id),
  ];
  if (new Set(allIds).size !== allIds.length) issues.push("semantic UI ids must be globally unique");
  const terms = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations]
    .flatMap((definition) => definition.searchTerms.map((term) => term.trim().toLowerCase()));
  if (new Set(terms).size !== terms.length) issues.push("search terms must resolve to one canonical id");
  const screens = new Set(registry.screens.map(({ id }) => id));
  const elements = new Map(registry.elements.map((element) => [element.id, element]));
  const states = new Map(registry.states.map((state) => [state.id, state]));
  const scenarios = new Set(registry.scenarios.map(({ id }) => id));
  const definitions = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations];
  for (const definition of definitions) {
    if (definition.system !== registry.system) issues.push(`${definition.id} crosses a system boundary`);
    for (const scenario of definition.verification.scenarios) {
      if (!scenarios.has(scenario)) issues.push(`${definition.id} references unknown verification scenario ${scenario}`);
    }
  }
  for (const definition of [...registry.elements, ...registry.states, ...registry.observations]) {
    if (!screens.has(definition.screen)) issues.push(`${definition.id} references an unknown screen`);
  }
  for (const scenario of registry.root.verification.scenarios) {
    if (!scenarios.has(scenario)) issues.push(`driver root references unknown verification scenario ${scenario}`);
  }
  for (const element of registry.elements) {
    for (const state of element.requiredStates) {
      const stateDefinition = states.get(state);
      if (!stateDefinition) issues.push(`${element.id} references unknown state ${state}`);
      else if (stateDefinition.screen !== element.screen) issues.push(`${element.id} required state crosses screens`);
    }
    for (const superseded of element.supersedes) {
      if (!elements.has(superseded)) issues.push(`${element.id} supersedes unknown element ${superseded}`);
      if (superseded === element.id) issues.push(`${element.id} cannot supersede itself`);
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visitSupersedes(id: string): void {
    if (visiting.has(id)) {
      issues.push(`supersedes cycle includes ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const element = registry.elements.find((candidate) => candidate.id === id);
    for (const superseded of element?.supersedes ?? []) visitSupersedes(superseded);
    visiting.delete(id);
    visited.add(id);
  }
  for (const element of registry.elements) visitSupersedes(element.id);
  for (const state of registry.states) {
    for (const evidence of state.evidence) {
      const element = elements.get(evidence.element);
      if (!element) issues.push(`${state.id} references unknown evidence element ${evidence.element}`);
      else if (element.screen !== state.screen) issues.push(`${state.id} evidence crosses screens`);
    }
  }
  for (const observation of registry.observations) {
    const element = elements.get(observation.read.element);
    if (!element) issues.push(`${observation.id} reads an unknown element`);
    else if (element.screen !== observation.screen) issues.push(`${observation.id} reads across screens`);
  }
  const globalScenarioIds = [
    ...PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => ScenarioIdSchema.parse(id)),
    ...registry.scenarios.map(({ id }) => id),
  ];
  if (new Set(globalScenarioIds).size !== globalScenarioIds.length) issues.push("UI scenario ids must be globally unique");
  const semanticIds = new Set(allIds);
  for (const scenario of registry.scenarios) {
    if (scenario.system !== registry.system) issues.push(`${scenario.id} crosses a system boundary`);
    for (const id of scenario.semanticIds) {
      if (!semanticIds.has(id)) issues.push(`${scenario.id} references unknown semantic id ${id}`);
    }
  }
  const referencedScenarios = new Set([
    ...registry.root.verification.scenarios,
    ...registry.screens.flatMap(({ verification: value }) => value.scenarios),
    ...registry.elements.flatMap(({ verification: value }) => value.scenarios),
    ...registry.states.flatMap(({ verification: value }) => value.scenarios),
    ...registry.observations.flatMap(({ verification: value }) => value.scenarios),
  ]);
  for (const scenario of registry.scenarios) {
    if (!referencedScenarios.has(scenario.id)) issues.push(`verification scenario ${scenario.id} is vacuous`);
  }
  return issues;
}

function portRowKey(row: z.infer<typeof UiPortMapRowReferenceSchema>): string {
  return `${row.system}:${row.legacyKey}`;
}

export function auditUcpathUiEvidenceBindings(input: unknown): readonly string[] {
  const parsed = UiEvidenceBindingInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { evidenceByRef, portBindings } = parsed.data;
  const issues: string[] = [];
  const facts = [
    ...UCPATH_UI_REGISTRY.screens.map((fact) => ({ ...fact, screen: fact.id })),
    ...UCPATH_UI_REGISTRY.elements,
    ...UCPATH_UI_REGISTRY.states,
    ...UCPATH_UI_REGISTRY.observations,
  ];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const bindingsByRow = new Map(portBindings.map((binding) => [
    portRowKey({ system: binding.system, legacyKey: binding.legacyKey }),
    binding,
  ]));

  for (const fact of facts) {
    const expectedRows = fact.verification.portMapRows.map(portRowKey);
    for (const row of fact.verification.portMapRows) {
      if (!bindingsByRow.has(portRowKey(row))) issues.push(`${fact.id} references unknown port-map row ${portRowKey(row)}`);
    }
    const evidenceRefs = [
      [fact.verification.fixtureEvidenceRef, "deterministic-fixture"],
      [fact.verification.liveReadOnlyEvidenceRef, "live-read-only"],
    ] as const;
    for (const [ref, evidenceKind] of evidenceRefs) {
      const manifest = evidenceByRef[ref];
      if (!manifest) {
        issues.push(`${fact.id} is missing evidence manifest ${ref}`);
        continue;
      }
      if (manifest.evidenceKind !== evidenceKind) issues.push(`${fact.id} ${ref} has the wrong evidence kind`);
      if (manifest.system !== fact.system) issues.push(`${fact.id} ${ref} crosses systems`);
      if (manifest.verifiedAt !== fact.verification.verifiedAt) issues.push(`${fact.id} ${ref} verification date drifted`);
      if (!manifest.screens.includes(fact.screen)) issues.push(`${fact.id} ${ref} omits screen ${fact.screen}`);
      const assertions = manifest.assertions.filter(({ semanticId }) => semanticId === fact.id);
      if (assertions.length !== 1) issues.push(`${fact.id} ${ref} must have exactly one evidence assertion`);
      for (const assertion of assertions) {
        if (assertion.screen !== fact.screen) issues.push(`${fact.id} ${ref} assertion screen drifted`);
        if (!fact.verification.scenarios.includes(assertion.scenarioId)) {
          issues.push(`${fact.id} ${ref} assertion scenario drifted`);
        }
        const assertionRows = assertion.portMapRows.map(portRowKey);
        if (JSON.stringify(assertionRows) !== JSON.stringify(expectedRows)) {
          issues.push(`${fact.id} ${ref} assertion port-map rows drifted`);
        }
      }
    }
  }
  for (const [ref, manifest] of Object.entries(evidenceByRef)) {
    for (const assertion of manifest.assertions) {
      if (!factsById.has(assertion.semanticId)) issues.push(`${ref} asserts unknown semantic id ${assertion.semanticId}`);
    }
  }

  const rootBinding = bindingsByRow.get(portRowKey({ system: "ucpath", legacyKey: UCPATH_UI_REGISTRY.root.provenance.key }));
  if (!rootBinding || rootBinding.disposition !== "driver-internal") {
    issues.push("UCPath driver root must resolve to its driver-internal port-map row");
  }
  for (const element of UCPATH_UI_REGISTRY.elements) {
    const binding = bindingsByRow.get(portRowKey({ system: element.system, legacyKey: element.provenance.key }));
    if (!binding || binding.disposition !== "ported" || binding.canonicalId !== element.id) {
      issues.push(`${element.id} does not resolve to its exact ported row`);
      continue;
    }
    if (binding.evidence.verifiedAt !== element.verification.verifiedAt
      || binding.evidence.fixtureEvidenceRef !== element.verification.fixtureEvidenceRef
      || binding.evidence.liveReadOnlyEvidenceRef !== element.verification.liveReadOnlyEvidenceRef) {
      issues.push(`${element.id} port-map evidence drifted`);
    }
  }
  return issues;
}

export function parseUcpathRegistryEid(input: string) {
  return EidSchema.parse(input);
}
