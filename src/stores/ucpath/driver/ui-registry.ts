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

function verification(scenario: string) {
  return {
    verifiedAt: DateOnlySchema.parse("2026-08-01"),
    fixtureEvidenceRef: FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
  };
}

export const UCPATH_UI_REGISTRY = deepFreeze(UiRegistrySchema.parse({
  system: "ucpath",
  root: {
    kind: "content-frame",
    selector: "#main_target_win0",
    verification: verification(SEARCH_SCENARIO),
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
      verification: verification(SEARCH_SCENARIO),
    },
    {
      id: UCPATH_PERSON_ORG_DETAIL_SCREEN,
      system: "ucpath",
      label: "Person Organizational Summary detail",
      searchTerms: ["ucpath person org detail screen"],
      sensitivity: "hr",
      verification: verification(DISPLAY_SCENARIO),
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
      verification: verification(SEARCH_SCENARIO),
      provenance: {
        commit: LEGACY_COMMIT,
        path: "src/systems/ucpath/selectors.ts",
        key: "personOrgSummary.emplIdInput()",
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
      locator: { kind: "css", selector: "#PERSON_NPC_VW_EMPLID" },
      requiredStates: [UCPATH_PERSON_ORG_DETAIL_READY],
      verification: verification(DISPLAY_SCENARIO),
      provenance: {
        commit: LEGACY_COMMIT,
        path: "src/systems/ucpath/selectors.ts",
        key: "personOrgSummary.personIdValue()",
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
      verification: verification(SEARCH_SCENARIO),
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
      verification: verification(DISPLAY_SCENARIO),
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
      verification: verification(DISPLAY_SCENARIO),
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
  const states = new Set(registry.states.map(({ id }) => id));
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
      if (!states.has(state)) issues.push(`${element.id} references unknown state ${state}`);
    }
    for (const superseded of element.supersedes) {
      if (!elements.has(superseded)) issues.push(`${element.id} supersedes unknown element ${superseded}`);
      if (superseded === element.id) issues.push(`${element.id} cannot supersede itself`);
    }
  }
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

export function parseUcpathRegistryEid(input: string) {
  return EidSchema.parse(input);
}
