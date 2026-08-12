import { z } from "zod";
import { ScenarioIdSchema } from "../ids.js";
import type { ScenarioId } from "../ids.js";
import { deepFreeze } from "../immutability.js";

/**
 * `tests/scenario/` holds exactly TWO kinds of file, and the difference is
 * structural rather than editorial (D185).
 *
 * A **graph scenario** (`<name>.scenario.test.ts`) walks ONE declared path of
 * ONE descriptor and claims the coverage points it exercised. Every id it
 * declares is registered — in `EXECUTABLE_SCENARIO_MANIFEST` when a production
 * descriptor or contract references it, or in the graph claim corpus when it
 * covers a fixture descriptor's path.
 *
 * An **integration walk** (`<name>.walk.test.ts`) is the opposite shape: it
 * crosses SLICES rather than following one graph, so it claims no coverage
 * point and appears in no manifest row. It exists for the joins that only
 * composition can falsify — the manifest row that really minted a run, the
 * receipt that really froze into an archive.
 */
export const GRAPH_SCENARIO_FILE_PATTERN = /^tests\/scenario\/[a-z0-9-]+\.scenario\.test\.ts$/u;
export const INTEGRATION_WALK_FILE_PATTERN = /^tests\/scenario\/[a-z0-9-]+\.walk\.test\.ts$/u;

export const ExecutableScenarioSpecSchema = z.strictObject({
  scenarioId: ScenarioIdSchema,
  file: z.string().regex(GRAPH_SCENARIO_FILE_PATTERN),
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
  {
    scenarioId: "person-lookup/ucpath-drill-subject-mismatch",
    file: "tests/scenario/person-lookup-runtime.scenario.test.ts",
  },
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
  {
    scenarioId: "separations-kronos-timecard/reads-a-real-timecard",
    file: "tests/scenario/separations-kronos-timecard.scenario.test.ts",
  },
  {
    scenarioId: "separations-kronos-timecard/timecard-without-punches",
    file: "tests/scenario/separations-kronos-timecard.scenario.test.ts",
  },
  {
    scenarioId: "separations-kronos-timecard/employee-not-found",
    file: "tests/scenario/separations-kronos-timecard.scenario.test.ts",
  },
  {
    scenarioId: "separations-kronos-timecard/search-no-signal",
    file: "tests/scenario/separations-kronos-timecard.scenario.test.ts",
  },
  {
    scenarioId: "separations-kronos-timecard/wrong-employee-timecard",
    file: "tests/scenario/separations-kronos-timecard.scenario.test.ts",
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

/* ── the corpus's own layout (D185) ──────────────────────────────────────── */

/**
 * One file in `tests/scenario/`, as the guard's directory read observes it.
 *
 * The titles are passed in rather than read here for the reason every audit in
 * this module is pure: a mechanical arm that reaches the filesystem itself can
 * only ever be proved against the tree it happens to be standing in, and this
 * one has to be proved against DELIBERATELY VIOLATING corpora it will never
 * find on disk.
 */
export const ScenarioCorpusFileSchema = z.strictObject({
  /** Repo-relative, forward-slashed. */
  file: z.string().min(1),
  /** Every top-level `it(...)` title in declaration order. */
  itTitles: z.array(z.string()).readonly(),
});
export type ScenarioCorpusFile = z.infer<typeof ScenarioCorpusFileSchema>;

/**
 * The scenario id an `it` title CLAIMS, or `undefined` when the title is prose.
 *
 * The corpus's convention is `it("<scenario-id> — <what it walks>")`, and the
 * separator is load-bearing: the head either parses as a `ScenarioId` — a
 * slash-delimited kebab path — or it does not, and English prose never does.
 * That is what makes "an unregistered id" and "a sentence" distinguishable
 * without a list of blessed exceptions. A TYPO stays a claim (it is still
 * slug-shaped), which is the whole point: it must fail, not be reclassified as
 * prose and waved through.
 */
export function claimedScenarioId(title: string): string | undefined {
  const head = title.split(" — ")[0] ?? "";
  return ScenarioIdSchema.safeParse(head).success ? head : undefined;
}

/**
 * Both directions over the corpus DIRECTORY, which is the half
 * `auditExecutableScenarioParity` structurally cannot see: it audits the
 * registered set against production references, so a file registered nowhere
 * — or an `it` inside a registered file naming an id nobody registered — is
 * invisible to it in every direction.
 *
 * `graphClaimedIds` is the fixture side: `tests/scenario/coverage-claims.ts`
 * claims graph paths for descriptors that are test fixtures and therefore have
 * no production reference to be registered against.
 */
export function auditScenarioCorpusLayout(
  filesInput: readonly unknown[],
  graphClaimedIdsInput: readonly string[],
): readonly string[] {
  const files = filesInput.map((file) => ScenarioCorpusFileSchema.parse(file));
  const graphClaimed = new Set(graphClaimedIdsInput.map((id) => String(ScenarioIdSchema.parse(id))));
  const violations: string[] = [];

  const paths = files.map(({ file }) => file);
  for (const [index, path] of paths.entries()) {
    if (paths.indexOf(path) !== index) violations.push(`${path} is listed twice in the corpus`);
  }

  const rowsByFile = new Map<string, string[]>();
  for (const row of EXECUTABLE_SCENARIO_MANIFEST) {
    rowsByFile.set(row.file, [...(rowsByFile.get(row.file) ?? []), String(row.scenarioId)]);
  }
  const registeredFile = new Map(
    EXECUTABLE_SCENARIO_MANIFEST.map((row) => [String(row.scenarioId), row.file] as const),
  );
  for (const file of rowsByFile.keys()) {
    if (!paths.includes(file)) {
      violations.push(`manifest rows name ${file}, which is not in the scenario corpus`);
    }
  }

  for (const { file, itTitles } of files) {
    const isGraphScenario = GRAPH_SCENARIO_FILE_PATTERN.test(file);
    const isWalk = INTEGRATION_WALK_FILE_PATTERN.test(file);
    if (!isGraphScenario && !isWalk) {
      violations.push(
        `${file} is neither a graph scenario (<name>.scenario.test.ts) nor an integration walk `
        + "(<name>.walk.test.ts); the corpus has exactly two kinds",
      );
      continue;
    }
    if (itTitles.length === 0) violations.push(`${file} declares no test`);

    const claimed = itTitles
      .map((title) => claimedScenarioId(title))
      .filter((id): id is string => id !== undefined);

    if (isWalk) {
      if (rowsByFile.has(file)) {
        violations.push(`${file} is an integration walk and may not carry a manifest row`);
      }
      for (const id of claimed) {
        violations.push(
          `${file} is an integration walk and may not claim scenario ${id}; a graph path is claimed `
          + "by the scenario file that walks it",
        );
      }
      continue;
    }

    if (claimed.length === 0) {
      violations.push(
        `${file} is named a graph scenario but declares no scenario id; every test in it is prose`,
      );
    }
    for (const id of claimed) {
      const declaredIn = registeredFile.get(id);
      if (declaredIn === undefined) {
        if (!graphClaimed.has(id)) {
          violations.push(
            `${file} declares scenario ${id}, which is in no manifest row and claims no graph path`,
          );
        }
        continue;
      }
      if (declaredIn !== file) {
        violations.push(`${file} declares scenario ${id}, whose manifest row names ${declaredIn}`);
      }
    }
    for (const id of rowsByFile.get(file) ?? []) {
      if (!claimed.includes(id)) violations.push(`${file} carries a manifest row for ${id} but declares no such test`);
    }
  }

  return violations;
}
