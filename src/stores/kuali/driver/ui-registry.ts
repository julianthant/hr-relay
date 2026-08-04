/**
 * The Kuali semantic UI registry — the closed set of screens, elements, page
 * states, and observations the Kuali driver may resolve.
 *
 * Three elements, and only three: the EID field (the write's SUBJECT), the
 * timekeeper field (what the write changes), and the Save button (the external
 * commit). Everything else on an RRSS Separation Request Form is deliberately
 * absent — this registry exists to serve Phase 2's transaction proof, and an
 * element nobody uses is an element nobody verifies.
 *
 * Every element is a legacy PORT with exact provenance (legacy commit, path,
 * key, source line, blob) plus its own live read-only re-verification on
 * 2026-08-04. Two ports narrow deliberately, and both narrowings are safety
 * fixes rather than transcription:
 *
 *  - `save.navbarSaveButton()` is a three-deep `.or()` chain in legacy
 *    (`[class*="action-bar"] button:has-text("Save")` → `nav button:has-text("Save")`
 *    → the role selector). On the live 2026-08-04 DOM there is exactly ONE
 *    `button "Save"`, and it sits in one action group with `button "Send Back"`
 *    and `button "Mark Complete"` — both of which ADVANCE the workflow. A
 *    `has-text("Save")` branch is a substring match; a fallback chain around a
 *    button whose neighbours file real separation steps is precisely the
 *    "plausible-but-wrong element" this program bans. The port keeps the exact
 *    role+name branch only, and the driver fails loud on any match count but 1.
 *  - `separationForm.separationDate()` is NOT ported at all, but it is worth
 *    recording why the live check mattered: its legacy recipe is the loose
 *    regex `/Separation Date/`, while the live accessible name is
 *    `"Separation Date (Last day actively employed)*"`. A future port must use
 *    the full literal.
 */
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
  KUALI_RRSS_DISPLAYED_EID,
  KUALI_RRSS_DISPLAYED_TIMEKEEPER,
  KUALI_RRSS_DOCUMENT_READY,
  KUALI_RRSS_DOCUMENT_SCREEN,
  KUALI_RRSS_EID_FIELD,
  KUALI_RRSS_SAVE_BUTTON,
  KUALI_RRSS_TIMEKEEPER_FIELD,
  KUALI_RRSS_TIMEKEEPER_STAGED,
} from "../../../domain/ui/kuali-rrss-document.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../domain/trust/preflight-scenarios.js";

const LEGACY_COMMIT = "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc";
const KUALI_SELECTOR_BLOB = "1c55c7d307891e07951ca38a89548418bdc23f49";
const FIXTURE_EVIDENCE = "evidence/ui/kuali/rrss-document.fixture.json";
const LIVE_EVIDENCE = "evidence/ui/kuali/rrss-document.live.json";
const IDENTITY_SCENARIO = "ui/kuali-rrss-document-identity";
const WRITE_SURFACE_SCENARIO = "ui/kuali-rrss-timekeeper-write-surface";

const EID_PORT_KEY = "separationForm.eid()";
const TIMEKEEPER_PORT_KEY = "timekeeperTasks.timekeeperName()";
const SAVE_PORT_KEY = "save.navbarSaveButton()";

const VERIFIED_AT = "2026-08-04";

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const LegacySelectorProvenanceSchema = z.strictObject({
  commit: z.literal(LEGACY_COMMIT),
  path: z.literal("src/systems/kuali/selectors.ts"),
  key: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/u),
  sourceLine: z.number().int().positive(),
  blob: GitBlobSchema,
  /**
   * When the rebuild does NOT copy the legacy recipe verbatim, the reason is
   * recorded here and reviewed. A silent narrowing would be indistinguishable
   * from a transcription error.
   */
  narrowedFromLegacy: z.string().min(1).optional(),
});

/**
 * Kuali form controls are addressed the way the live accessibility tree
 * exposes them: role + the EXACT accessible name, `*` included. There is no
 * CSS arm and no `.or()` arm on purpose — doc 09 §13 OQ1 (c) records that DOM
 * refs change on every reload, and the Save neighbourhood makes a fuzzy match
 * dangerous.
 */
export const KualiLocatorRecipeSchema = z.strictObject({
  kind: z.literal("role-exact-name"),
  role: z.enum(["textbox", "button"]),
  name: z.string().min(1),
  exact: z.literal(true),
});
export type KualiLocatorRecipe = z.infer<typeof KualiLocatorRecipeSchema>;

export const KualiStateEvidenceRuleSchema = z.discriminatedUnion("kind", [
  /** `…/build/space/<space>/actions/<actionId>` — which redirects to `…/view`. */
  z.strictObject({ kind: z.literal("action-view-url"), space: z.string().regex(/^[0-9a-f]{24}$/u) }),
  /** The level-1 heading is the document number; it is how we prove identity. */
  z.strictObject({ kind: z.literal("document-number-heading"), level: z.literal(1) }),
  z.strictObject({ kind: z.literal("element"), element: ElementIdSchema }),
]);

export const KualiObservationRecipeSchema = z.strictObject({
  kind: z.literal("input-value"),
  element: ElementIdSchema,
  /** Kuali inputs return whitespace-padded values (legacy LESSONS.md:49-54). */
  trim: z.literal(true),
  valueType: z.enum(["eid", "text"]),
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
  locator: KualiLocatorRecipeSchema,
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
  evidence: z.array(KualiStateEvidenceRuleSchema).min(1),
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
  valueType: z.enum(["eid", "text"]),
  read: KualiObservationRecipeSchema,
  authoritativeFor: z.array(z.enum(["subject", "completion", "page-state"])).min(1),
  verification: UiVerificationSchema,
});

export const KualiUiRegistrySchema = z.strictObject({
  system: z.literal("kuali"),
  screens: z.array(ScreenDefinitionSchema).min(1),
  elements: z.array(ElementDefinitionSchema).min(1),
  states: z.array(PageStateDefinitionSchema).min(1),
  observations: z.array(ObservationDefinitionSchema).min(1),
  scenarios: z.array(UiVerificationScenarioSchema).min(1),
});
export type KualiUiRegistry = z.infer<typeof KualiUiRegistrySchema>;

export const KualiUiRegistryPortBindingSchema = z.strictObject({
  system: z.literal("kuali"),
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

const KualiUiEvidenceBindingInputSchema = z.strictObject({
  evidenceByRef: z.record(UiEvidenceReferenceSchema, UiVerificationEvidenceManifestSchema),
  portBindings: z.array(KualiUiRegistryPortBindingSchema),
});

/** The Kuali Build space that owns the RRSS form (legacy `src/config.ts:131`). */
export const KUALI_RRSS_SPACE_ID = "5e47518b90adda9474c14adb";

function verification(scenario: string, legacyKey: string) {
  return {
    verifiedAt: DateOnlySchema.parse(VERIFIED_AT),
    fixtureEvidenceRef: FIXTURE_EVIDENCE,
    liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
    scenarios: [ScenarioIdSchema.parse(scenario)],
    portMapRows: [{ system: "kuali" as const, legacyKey }],
  };
}

function provenance(key: string, sourceLine: number, narrowedFromLegacy?: string) {
  return {
    commit: LEGACY_COMMIT,
    path: "src/systems/kuali/selectors.ts" as const,
    key,
    sourceLine,
    blob: KUALI_SELECTOR_BLOB,
    ...(narrowedFromLegacy === undefined ? {} : { narrowedFromLegacy }),
  };
}

export const KUALI_UI_REGISTRY = deepFreeze(KualiUiRegistrySchema.parse({
  system: "kuali",
  screens: [
    {
      id: KUALI_RRSS_DOCUMENT_SCREEN,
      system: "kuali",
      label: "Kuali RRSS Separation Request Form document",
      searchTerms: ["kuali rrss separation request document screen"],
      sensitivity: "restricted",
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
    },
  ],
  elements: [
    {
      id: KUALI_RRSS_EID_FIELD,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document EID field",
      searchTerms: ["kuali rrss document eid field"],
      role: "field",
      effect: "observe",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", role: "textbox", name: "EID*", exact: true },
      requiredStates: [KUALI_RRSS_DOCUMENT_READY],
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
      provenance: provenance(EID_PORT_KEY, 96),
      supersedes: [],
    },
    {
      id: KUALI_RRSS_TIMEKEEPER_FIELD,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document timekeeper name field",
      searchTerms: ["kuali rrss document timekeeper name field"],
      role: "field",
      effect: "prepare",
      sensitivity: "hr",
      locator: { kind: "role-exact-name", role: "textbox", name: "Timekeeper Name:*", exact: true },
      requiredStates: [KUALI_RRSS_DOCUMENT_READY, KUALI_RRSS_TIMEKEEPER_STAGED],
      verification: verification(WRITE_SURFACE_SCENARIO, TIMEKEEPER_PORT_KEY),
      provenance: provenance(TIMEKEEPER_PORT_KEY, 138),
      supersedes: [],
    },
    {
      id: KUALI_RRSS_SAVE_BUTTON,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document Save button",
      searchTerms: ["kuali rrss document save button external commit"],
      role: "button",
      effect: "external-commit",
      sensitivity: "restricted",
      locator: { kind: "role-exact-name", role: "button", name: "Save", exact: true },
      requiredStates: [KUALI_RRSS_TIMEKEEPER_STAGED],
      verification: verification(WRITE_SURFACE_SCENARIO, SAVE_PORT_KEY),
      provenance: provenance(
        SAVE_PORT_KEY,
        223,
        "legacy chains [class*=\"action-bar\"] button:has-text(\"Save\") .or(nav button:has-text(\"Save\")) "
        + ".or(role button Save exact); the rebuild keeps ONLY the exact role+name branch because the live "
        + "2026-08-04 DOM has exactly one button \"Save\" adjacent to \"Send Back\" and \"Mark Complete\", "
        + "and a has-text fallback around workflow-advancing buttons is an unacceptable write risk",
      ),
      supersedes: [],
    },
  ],
  states: [
    {
      id: KUALI_RRSS_DOCUMENT_READY,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document loaded and identifiable",
      searchTerms: ["kuali rrss document ready state"],
      sensitivity: "restricted",
      evidence: [
        { kind: "action-view-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "document-number-heading", level: 1 },
        { kind: "element", element: KUALI_RRSS_EID_FIELD },
      ],
      // A cold document open measured ~6s live on 2026-08-04; 30s is the same
      // budget every other store's ready state carries.
      timeoutMs: 30_000,
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
    },
    {
      id: KUALI_RRSS_TIMEKEEPER_STAGED,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "RRSS document with an unsaved staged timekeeper value",
      searchTerms: ["kuali rrss document timekeeper staged state"],
      sensitivity: "restricted",
      // Structural evidence only. That the field holds the STAGED value is
      // proved by the prepare task's read-back (`fillWithVerify` discipline),
      // not by a page-state rule — a value-dependent state id would be a
      // different state per value and could not be registered at all.
      evidence: [
        { kind: "action-view-url", space: KUALI_RRSS_SPACE_ID },
        { kind: "element", element: KUALI_RRSS_TIMEKEEPER_FIELD },
        { kind: "element", element: KUALI_RRSS_SAVE_BUTTON },
      ],
      timeoutMs: 30_000,
      verification: verification(WRITE_SURFACE_SCENARIO, TIMEKEEPER_PORT_KEY),
    },
  ],
  observations: [
    {
      id: KUALI_RRSS_DISPLAYED_EID,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "Displayed RRSS document EID",
      searchTerms: ["authoritative kuali rrss displayed eid"],
      sensitivity: "restricted",
      valueType: "eid",
      read: { kind: "input-value", element: KUALI_RRSS_EID_FIELD, trim: true, valueType: "eid" },
      authoritativeFor: ["subject"],
      verification: verification(IDENTITY_SCENARIO, EID_PORT_KEY),
    },
    {
      id: KUALI_RRSS_DISPLAYED_TIMEKEEPER,
      system: "kuali",
      screen: KUALI_RRSS_DOCUMENT_SCREEN,
      label: "Displayed RRSS document timekeeper name",
      searchTerms: ["authoritative kuali rrss displayed timekeeper name"],
      sensitivity: "hr",
      valueType: "text",
      read: { kind: "input-value", element: KUALI_RRSS_TIMEKEEPER_FIELD, trim: true, valueType: "text" },
      authoritativeFor: ["completion"],
      verification: verification(WRITE_SURFACE_SCENARIO, TIMEKEEPER_PORT_KEY),
    },
  ],
  scenarios: [
    {
      id: IDENTITY_SCENARIO,
      kind: "ui-verification",
      title: "A Kuali RRSS document exposes an authoritative exact EID",
      system: "kuali",
      semanticIds: [KUALI_RRSS_EID_FIELD, KUALI_RRSS_DOCUMENT_READY, KUALI_RRSS_DISPLAYED_EID],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
    {
      id: WRITE_SURFACE_SCENARIO,
      kind: "ui-verification",
      title: "The Kuali timekeeper write surface resolves to exactly one field and one Save",
      system: "kuali",
      semanticIds: [
        KUALI_RRSS_TIMEKEEPER_FIELD,
        KUALI_RRSS_SAVE_BUTTON,
        KUALI_RRSS_TIMEKEEPER_STAGED,
        KUALI_RRSS_DISPLAYED_TIMEKEEPER,
      ],
      fixtureEvidenceRef: FIXTURE_EVIDENCE,
      liveReadOnlyEvidenceRef: LIVE_EVIDENCE,
      assertions: ["recipe-resolves", "exactly-one-visible"],
    },
  ],
}));

export function auditKualiUiRegistry(registryInput: unknown = KUALI_UI_REGISTRY): readonly string[] {
  const result = KualiUiRegistrySchema.safeParse(registryInput);
  if (!result.success) return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const registry = result.data;
  const issues: string[] = [];
  const allIds = [
    ...registry.screens.map(({ id }) => id),
    ...registry.elements.map(({ id }) => id),
    ...registry.states.map(({ id }) => id),
    ...registry.observations.map(({ id }) => id),
  ];
  if (new Set(allIds).size !== allIds.length) issues.push("Kuali semantic UI ids must be globally unique");
  const searchTerms = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations]
    .flatMap((fact) => fact.searchTerms.map((term) => term.trim().toLowerCase()));
  if (new Set(searchTerms).size !== searchTerms.length) issues.push("Kuali search terms must resolve to one canonical id");
  const screens = new Set(registry.screens.map(({ id }) => id));
  const elements = new Map(registry.elements.map((element) => [element.id, element]));
  const states = new Map(registry.states.map((state) => [state.id, state]));
  const scenarios = new Set(registry.scenarios.map(({ id }) => id));
  const facts = [...registry.screens, ...registry.elements, ...registry.states, ...registry.observations];
  for (const fact of facts) {
    if (fact.system !== "kuali") issues.push(`${fact.id} crosses a system boundary`);
    for (const scenario of fact.verification.scenarios) {
      if (!scenarios.has(scenario)) issues.push(`${fact.id} references unknown verification scenario ${scenario}`);
    }
  }
  for (const fact of [...registry.elements, ...registry.states, ...registry.observations]) {
    if (!screens.has(fact.screen)) issues.push(`${fact.id} references an unknown Kuali screen`);
  }
  for (const element of registry.elements) {
    for (const state of element.requiredStates) {
      const stateDefinition = states.get(state);
      if (stateDefinition === undefined) issues.push(`${element.id} references unknown state ${state}`);
      else if (stateDefinition.screen !== element.screen) issues.push(`${element.id} required state crosses screens`);
    }
    // The one element that can mutate the outside world must say so, and no
    // element that only observes may claim it.
    if (element.id === KUALI_RRSS_SAVE_BUTTON && element.effect !== "external-commit") {
      issues.push(`${element.id} must declare the external-commit effect`);
    }
    if (element.id !== KUALI_RRSS_SAVE_BUTTON && element.effect === "external-commit") {
      issues.push(`${element.id} may not claim the external-commit effect`);
    }
    // Kuali's Save neighbourhood is the whole reason this registry is exact.
    if (element.locator.role === "button" && !element.locator.exact) {
      issues.push(`${element.id} button recipe must be an exact-name match`);
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
    if (!elements.has(observation.read.element)) issues.push(`${observation.id} reads an unknown Kuali element`);
  }
  const subjectObservations = registry.observations.filter(({ authoritativeFor }) =>
    authoritativeFor.includes("subject"));
  if (subjectObservations.length !== 1) {
    issues.push("Kuali must expose exactly one subject-authoritative observation for the write binding");
  }
  const globalScenarioIds = [
    ...PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => ScenarioIdSchema.parse(id)),
    ...registry.scenarios.map(({ id }) => id),
  ];
  if (new Set(globalScenarioIds).size !== globalScenarioIds.length) {
    issues.push("Kuali UI scenario ids must be globally unique");
  }
  const semanticIds = new Set(allIds);
  const referencedScenarios = new Set(facts.flatMap(({ verification: value }) => value.scenarios));
  for (const scenario of registry.scenarios) {
    for (const id of scenario.semanticIds) {
      if (!semanticIds.has(id)) issues.push(`${scenario.id} references unknown Kuali semantic id ${id}`);
    }
    if (!referencedScenarios.has(scenario.id)) issues.push(`Kuali verification scenario ${scenario.id} is vacuous`);
  }
  return issues;
}

function portRowKey(row: z.infer<typeof UiPortMapRowReferenceSchema>): string {
  return `${row.system}:${row.legacyKey}`;
}

export function auditKualiUiEvidenceBindings(input: unknown): readonly string[] {
  const parsed = KualiUiEvidenceBindingInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { evidenceByRef, portBindings } = parsed.data;
  const issues: string[] = [];
  const facts = [
    ...KUALI_UI_REGISTRY.screens.map((fact) => ({ ...fact, screen: fact.id })),
    ...KUALI_UI_REGISTRY.elements,
    ...KUALI_UI_REGISTRY.states,
    ...KUALI_UI_REGISTRY.observations,
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
        issues.push(`${fact.id} references unknown Kuali port-map row ${portRowKey(row)}`);
      }
    }
    const evidenceRefs = [
      [fact.verification.fixtureEvidenceRef, "deterministic-fixture"],
      [fact.verification.liveReadOnlyEvidenceRef, "live-read-only"],
    ] as const;
    for (const [ref, evidenceKind] of evidenceRefs) {
      const manifest = evidenceByRef[ref];
      if (manifest === undefined) {
        issues.push(`${fact.id} is missing Kuali evidence manifest ${ref}`);
        continue;
      }
      if (manifest.evidenceKind !== evidenceKind) issues.push(`${fact.id} ${ref} has the wrong evidence kind`);
      if (manifest.system !== "kuali") issues.push(`${fact.id} ${ref} crosses systems`);
      if (manifest.externalWriteAttempted !== false) issues.push(`${fact.id} ${ref} claims an external write`);
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
      if (!factsById.has(assertion.semanticId)) issues.push(`${ref} asserts unknown Kuali semantic id ${assertion.semanticId}`);
    }
  }
  for (const element of KUALI_UI_REGISTRY.elements) {
    const binding = bindingsByRow.get(portRowKey({ system: "kuali", legacyKey: element.provenance.key }));
    if (binding === undefined || binding.canonicalId !== element.id) {
      issues.push(`${element.id} does not resolve to its exact Kuali ported row`);
      continue;
    }
    if (binding.evidence.verifiedAt !== element.verification.verifiedAt
      || binding.evidence.fixtureEvidenceRef !== element.verification.fixtureEvidenceRef
      || binding.evidence.liveReadOnlyEvidenceRef !== element.verification.liveReadOnlyEvidenceRef) {
      issues.push(`${element.id} Kuali port-map evidence drifted`);
    }
  }
  return issues;
}
