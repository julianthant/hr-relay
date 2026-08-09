import { z } from "zod";
import { ScenarioIdSchema } from "../ids.js";
import type { ScenarioId } from "../ids.js";
import { deepFreeze } from "../immutability.js";

export const ExecutableScenarioSpecSchema = z.strictObject({
  scenarioId: ScenarioIdSchema,
  file: z.string().regex(/^tests\/scenario\/[a-z0-9-]+\.scenario\.test\.ts$/u),
});
export type ExecutableScenarioSpec = z.infer<typeof ExecutableScenarioSpecSchema>;

/**
 * Production scenario ids are independently registered here. Contracts and
 * descriptors may reference only these ids; the architecture lane separately
 * proves each row is an actual `it("<scenario-id> …")` in the named file.
 */
export const EXECUTABLE_SCENARIO_MANIFEST = deepFreeze(ExecutableScenarioSpecSchema.array().parse([
  { scenarioId: "person-lookup/happy-by-eid", file: "tests/scenario/person-lookup.scenario.test.ts" },
  { scenarioId: "person-lookup/happy-by-eid-with-dates", file: "tests/scenario/person-lookup.scenario.test.ts" },
  { scenarioId: "person-lookup/ambiguous-name", file: "tests/scenario/person-lookup.scenario.test.ts" },
  { scenarioId: "person-lookup/not-found", file: "tests/scenario/person-lookup.scenario.test.ts" },
  { scenarioId: "person-lookup/crm-failure-retry", file: "tests/scenario/person-lookup.scenario.test.ts" },
  { scenarioId: "person-lookup/crm-subject-mismatch", file: "tests/scenario/person-lookup-runtime.scenario.test.ts" },
  { scenarioId: "ocr/extract/complete", file: "tests/scenario/ocr-extraction.scenario.test.ts" },
  {
    scenarioId: "ocr/extract/illegible-mandatory",
    file: "tests/scenario/ocr-extraction.scenario.test.ts",
  },
  {
    scenarioId: "ocr/extract/skipped-field-refused",
    file: "tests/scenario/ocr-extraction.scenario.test.ts",
  },
  {
    scenarioId: "ocr/extract/provider-unavailable",
    file: "tests/scenario/ocr-extraction.scenario.test.ts",
  },
  { scenarioId: "intake/pdf/every-page", file: "tests/scenario/intake-pdf-pages.scenario.test.ts" },
  { scenarioId: "intake/pdf/page-window", file: "tests/scenario/intake-pdf-pages.scenario.test.ts" },
  {
    scenarioId: "intake/pdf/page-out-of-range",
    file: "tests/scenario/intake-pdf-pages.scenario.test.ts",
  },
  { scenarioId: "intake/pdf/unreadable", file: "tests/scenario/intake-pdf-pages.scenario.test.ts" },
  {
    scenarioId: "normalization/contact/rule-only",
    file: "tests/scenario/normalization-contact.scenario.test.ts",
  },
  {
    scenarioId: "normalization/contact/census-advice",
    file: "tests/scenario/normalization-contact.scenario.test.ts",
  },
  {
    scenarioId: "normalization/contact/nominatim-fallback",
    file: "tests/scenario/normalization-contact.scenario.test.ts",
  },
  {
    scenarioId: "normalization/contact/advisory-unavailable",
    file: "tests/scenario/normalization-contact.scenario.test.ts",
  },
  {
    scenarioId: "normalization/contact/ambiguous",
    file: "tests/scenario/normalization-contact.scenario.test.ts",
  },
  {
    scenarioId: "normalization/contact/ai-advice",
    file: "tests/scenario/normalization-contact.scenario.test.ts",
  },
  {
    scenarioId: "normalization/contact/ai-withheld-field",
    file: "tests/scenario/normalization-contact.scenario.test.ts",
  },
  { scenarioId: "roster/match/exact-eid", file: "tests/scenario/roster-match.scenario.test.ts" },
  { scenarioId: "roster/match/name-only", file: "tests/scenario/roster-match.scenario.test.ts" },
  { scenarioId: "roster/match/ambiguous", file: "tests/scenario/roster-match.scenario.test.ts" },
  {
    scenarioId: "roster/match/name-eid-conflict",
    file: "tests/scenario/roster-match.scenario.test.ts",
  },
  { scenarioId: "roster/match/no-match", file: "tests/scenario/roster-match.scenario.test.ts" },
  { scenarioId: "intake/spreadsheet/happy", file: "tests/scenario/intake-extraction.scenario.test.ts" },
  { scenarioId: "intake/spreadsheet/no-header", file: "tests/scenario/intake-extraction.scenario.test.ts" },
  {
    scenarioId: "intake/spreadsheet/duplicate-headers",
    file: "tests/scenario/intake-extraction.scenario.test.ts",
  },
  { scenarioId: "intake/spreadsheet/unreadable", file: "tests/scenario/intake-extraction.scenario.test.ts" },
  {
    scenarioId: "kuali-timekeeper-annotation/dry-run-preview",
    file: "tests/scenario/kuali-timekeeper-annotation.scenario.test.ts",
  },
  {
    scenarioId: "kuali-timekeeper-annotation/subject-mismatch",
    file: "tests/scenario/kuali-timekeeper-annotation.scenario.test.ts",
  },
  {
    scenarioId: "kuali-timekeeper-annotation/committed",
    file: "tests/scenario/kuali-timekeeper-annotation.scenario.test.ts",
  },
  {
    scenarioId: "kuali-timekeeper-annotation/already-present",
    file: "tests/scenario/kuali-timekeeper-annotation.scenario.test.ts",
  },
]));

export const EXECUTABLE_SCENARIO_IDS: readonly ScenarioId[] = Object.freeze(
  EXECUTABLE_SCENARIO_MANIFEST.map(({ scenarioId }) => scenarioId),
);

/** Both directions: no typo reference, no orphan manifest row, no unexecuted row. */
export function auditExecutableScenarioParity(
  referencedInput: readonly string[],
  observedInput: readonly string[] = EXECUTABLE_SCENARIO_IDS,
): readonly string[] {
  const violations: string[] = [];
  const referenced = referencedInput.map((id) => ScenarioIdSchema.parse(id));
  const observed = observedInput.map((id) => ScenarioIdSchema.parse(id));
  const registered = new Set(EXECUTABLE_SCENARIO_IDS);
  const referencedSet = new Set(referenced);
  const observedSet = new Set(observed);
  if (referencedSet.size !== referenced.length) violations.push("scenario references contain a duplicate id");
  if (observedSet.size !== observed.length) violations.push("observed scenario executions contain a duplicate id");
  for (const id of referencedSet) {
    if (!registered.has(id)) violations.push(`referenced scenario ${id} is not registered as executable`);
  }
  for (const id of registered) {
    if (!referencedSet.has(id)) violations.push(`executable scenario ${id} is orphaned from descriptors/contracts`);
    if (!observedSet.has(id)) violations.push(`registered scenario ${id} was not executed`);
  }
  for (const id of observedSet) {
    if (!registered.has(id)) violations.push(`observed execution ${id} has no scenario manifest row`);
  }
  return violations;
}
