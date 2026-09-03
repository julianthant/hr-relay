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
/**
 * R10 (§10.9) moves a workflow's structural scenario into its own folder —
 * `tests/scenario/workflows/<workflow-id>/structural.scenario.test.ts` — and
 * `separations-kuali-finalization` is the first pair in the tree (D266). Both
 * layouts are graph scenarios and both are accepted while the corpus migrates;
 * the folder form is exact on purpose (`structural`, one workflow folder deep),
 * so a stray `tests/scenario/workflows/<id>/dry-run.scenario.ts` sibling still
 * fails every check that names the two kinds. The walk pattern is deliberately
 * untouched: a walk crosses slices and belongs to no workflow folder.
 */
export const GRAPH_SCENARIO_FILE_PATTERN =
  /^tests\/scenario\/(?:[a-z0-9-]+|workflows\/[a-z0-9-]+\/structural)\.scenario\.test\.ts$/u;
export const INTEGRATION_WALK_FILE_PATTERN = /^tests\/scenario\/[a-z0-9-]+\.walk\.test\.ts$/u;
/**
 * R10 §10.9's T2 tier: `tests/scenario/dashboard/<feature>/<name>.scenario.test.ts`
 * — a DASHBOARD feature over the real projection and the real command service,
 * no browser and no graph.
 *
 * It is a third kind rather than a third arm of the graph pattern because it
 * carries the opposite obligation: a graph scenario MUST claim a scenario id
 * (a file that claims none is walking nothing), and a dashboard scenario must
 * claim NONE — a graph path is claimed by the file that walks the graph, which
 * is the same rule the integration walk already carries. Folding the two into
 * one pattern would make each obligation unenforceable against the other.
 */
export const DASHBOARD_SCENARIO_FILE_PATTERN =
  /^tests\/scenario\/dashboard\/[a-z0-9-]+\/[a-z0-9-]+\.scenario\.test\.ts$/u;

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
/** Chunk 3 registers eleven rows against one file; naming it once keeps them aligned. */
const SEPARATIONS_IDENTITY_CHECK_FILE = "tests/scenario/separations-identity-check.scenario.test.ts";
/** Chunk 4's UCPath termination write — the two transactions share one file. */
const SEPARATIONS_UCPATH_TERMINATION_FILE =
  "tests/scenario/separations-ucpath-termination.scenario.test.ts";
/**
 * Chunk 5's Kuali finalization — one file, three kinds of arm. 5a's contract
 * walks run the real task implementations against the deterministic driver
 * (the only way to observe "it refused" rather than "it returned something
 * plausible"); 5b's sequencer walks drive the real write sequencer over a real
 * authority database; 5b's pure graph walk covers the gate.
 */
const SEPARATIONS_KUALI_FINALIZATION_FILE =
  "tests/scenario/workflows/separations-kuali-finalization/structural.scenario.test.ts";
/**
 * Chunk 6's COMPOSITION — the largest graph in the program, and one file for
 * the same three kinds of arm chunk 5 established: pure fold walks for the five
 * composition-only refusals, sequencer walks over a real authority database for
 * the three transaction nodes' twelve paths, and a pure graph walk for the gate
 * and the terminal derive.
 */
const SEPARATIONS_FILE =
  "tests/scenario/workflows/separations/structural.scenario.test.ts";

/**
 * Order 0's workflow — ONE structural scenario beside its `live-read` manifest
 * (D318). Its pure graph walks and its runtime task walks merged into that one
 * file on 2026-09-02, retiring the two root-level files that used to split
 * them; §10.3 admits exactly one collected structural scenario per workflow.
 */
const PERSON_LOOKUP_FILE =
  "tests/scenario/workflows/person-lookup/structural.scenario.test.ts";

export const EXECUTABLE_SCENARIO_MANIFEST = deepFreeze(ExecutableScenarioSpecSchema.array().parse([
  { scenarioId: "person-lookup/happy-by-eid", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/happy-by-eid-with-dates", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/ambiguous-name", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/not-found", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/crm-failure-retry", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/crm-subject-mismatch", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/ucpath-drill-subject-mismatch", file: PERSON_LOOKUP_FILE },
  // D314 — the two ordinary recovery choices, proved over the registered descriptor.
  { scenarioId: "person-lookup/resume-from-checkpoints", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/restart-from-start", file: PERSON_LOOKUP_FILE },
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
  {
    scenarioId: "separations-kuali-read/reads-a-real-separation-document",
    file: "tests/scenario/separations-kuali-read.scenario.test.ts",
  },
  {
    scenarioId: "separations-kuali-read/unprocessed-document-absent-arms",
    file: "tests/scenario/separations-kuali-read.scenario.test.ts",
  },
  {
    scenarioId: "separations-kuali-read/non-separation-document",
    file: "tests/scenario/separations-kuali-read.scenario.test.ts",
  },
  {
    scenarioId: "separations-kuali-read/unparseable-separation-date",
    file: "tests/scenario/separations-kuali-read.scenario.test.ts",
  },
  {
    scenarioId: "separations-kuali-read/unknown-termination-type",
    file: "tests/scenario/separations-kuali-read.scenario.test.ts",
  },
  { scenarioId: "separations-identity-check/single-active-job", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/similar-name-never-auto-proceeds", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/different-name-two-candidates", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/already-terminated-single-row", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/already-terminated-multi-row", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/concurrent-active-jobs", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/unreadable-department", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/job-summary-not-found", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/gate-approved", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/gate-rejected", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-identity-check/gate-evidence-moved", file: SEPARATIONS_IDENTITY_CHECK_FILE },
  { scenarioId: "separations-ucpath-termination/dry-run-preview", file: SEPARATIONS_UCPATH_TERMINATION_FILE },
  { scenarioId: "separations-ucpath-termination/already-present", file: SEPARATIONS_UCPATH_TERMINATION_FILE },
  { scenarioId: "separations-ucpath-termination/subject-mismatch", file: SEPARATIONS_UCPATH_TERMINATION_FILE },
  { scenarioId: "separations-ucpath-termination/committed", file: SEPARATIONS_UCPATH_TERMINATION_FILE },
  { scenarioId: "separations-ucpath-termination/gate-approved", file: SEPARATIONS_UCPATH_TERMINATION_FILE },
  {
    scenarioId: "separations-ucpath-termination/pending-sweep-committed",
    file: SEPARATIONS_UCPATH_TERMINATION_FILE,
  },
  { scenarioId: "separations-ucpath-termination/emplid-not-recognized", file: SEPARATIONS_UCPATH_TERMINATION_FILE },
  { scenarioId: "separations-ucpath-termination/submit-refused", file: SEPARATIONS_UCPATH_TERMINATION_FILE },
  {
    scenarioId: "separations-ucpath-termination/last-date-worked-not-verified",
    file: SEPARATIONS_UCPATH_TERMINATION_FILE,
  },
  {
    scenarioId: "separations-ucpath-termination/submit-outcome-unknown",
    file: SEPARATIONS_UCPATH_TERMINATION_FILE,
  },
  {
    scenarioId: "separations-ucpath-termination/unreadable-probe-is-not-absent",
    file: SEPARATIONS_UCPATH_TERMINATION_FILE,
  },
  {
    scenarioId: "separations-ucpath-termination/pending-sweep-nothing-to-do",
    file: SEPARATIONS_UCPATH_TERMINATION_FILE,
  },
  {
    scenarioId: "separations-ucpath-termination/pending-sweep-refuses-unreadable-scan",
    file: SEPARATIONS_UCPATH_TERMINATION_FILE,
  },
  {
    scenarioId: "separations-kuali-finalization/stage-refusals",
    file: SEPARATIONS_KUALI_FINALIZATION_FILE,
  },
  {
    scenarioId: "separations-kuali-finalization/save-verify-read-back",
    file: SEPARATIONS_KUALI_FINALIZATION_FILE,
  },
  {
    scenarioId: "separations-kuali-finalization/department-option-refusals",
    file: SEPARATIONS_KUALI_FINALIZATION_FILE,
  },
  { scenarioId: "separations-kuali-finalization/dry-run-preview", file: SEPARATIONS_KUALI_FINALIZATION_FILE },
  { scenarioId: "separations-kuali-finalization/subject-mismatch", file: SEPARATIONS_KUALI_FINALIZATION_FILE },
  { scenarioId: "separations-kuali-finalization/committed", file: SEPARATIONS_KUALI_FINALIZATION_FILE },
  { scenarioId: "separations-kuali-finalization/already-present", file: SEPARATIONS_KUALI_FINALIZATION_FILE },
  {
    scenarioId: "separations-kuali-finalization/save-not-landed-parks",
    file: SEPARATIONS_KUALI_FINALIZATION_FILE,
  },
  { scenarioId: "separations-kuali-finalization/gate-approved", file: SEPARATIONS_KUALI_FINALIZATION_FILE },
  { scenarioId: "separations/action-resolved", file: SEPARATIONS_FILE },
  { scenarioId: "separations/action-not-in-action-list", file: SEPARATIONS_FILE },
  { scenarioId: "separations/action-ambiguous", file: SEPARATIONS_FILE },
  { scenarioId: "separations/plan-refusals", file: SEPARATIONS_FILE },
  { scenarioId: "separations/subject-resolution", file: SEPARATIONS_FILE },
  { scenarioId: "separations/employment-refusals", file: SEPARATIONS_FILE },
  { scenarioId: "separations/date-reconciliation", file: SEPARATIONS_FILE },
  { scenarioId: "separations/receipt-refusals", file: SEPARATIONS_FILE },
  { scenarioId: "separations/kronos-hard-fails", file: SEPARATIONS_FILE },
  { scenarioId: "separations/gate-approved", file: SEPARATIONS_FILE },
  { scenarioId: "separations/dry-run-preview", file: SEPARATIONS_FILE },
  { scenarioId: "separations/subject-mismatch", file: SEPARATIONS_FILE },
  { scenarioId: "separations/pending-sweep-committed", file: SEPARATIONS_FILE },
  { scenarioId: "separations/pending-sweep-nothing-to-do", file: SEPARATIONS_FILE },
  { scenarioId: "separations/termination-committed", file: SEPARATIONS_FILE },
  { scenarioId: "separations/termination-already-present", file: SEPARATIONS_FILE },
  { scenarioId: "separations/finalization-committed", file: SEPARATIONS_FILE },
  { scenarioId: "separations/finalization-already-present", file: SEPARATIONS_FILE },
  { scenarioId: "separations/finalization-parks-after-termination", file: SEPARATIONS_FILE },
  { scenarioId: "separations/re-read-is-a-new-item", file: SEPARATIONS_FILE },
  { scenarioId: "separations/gate-resume-shape", file: SEPARATIONS_FILE },
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
    const isDashboardScenario = DASHBOARD_SCENARIO_FILE_PATTERN.test(file);
    if (!isGraphScenario && !isWalk && !isDashboardScenario) {
      violations.push(
        `${file} is neither a graph scenario (<name>.scenario.test.ts), a dashboard scenario `
        + "(dashboard/<feature>/<name>.scenario.test.ts) nor an integration walk (<name>.walk.test.ts); "
        + "the corpus has exactly three kinds",
      );
      continue;
    }
    if (itTitles.length === 0) violations.push(`${file} declares no test`);

    const claimed = itTitles
      .map((title) => claimedScenarioId(title))
      .filter((id): id is string => id !== undefined);

    if (isWalk || isDashboardScenario) {
      const kind = isWalk ? "an integration walk" : "a dashboard scenario";
      if (rowsByFile.has(file)) {
        violations.push(`${file} is ${kind} and may not carry a manifest row`);
      }
      for (const id of claimed) {
        violations.push(
          `${file} is ${kind} and may not claim scenario ${id}; a graph path is claimed `
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
