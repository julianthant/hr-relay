import { z } from "zod";
import { ScenarioIdSchema } from "../../rules/identity/ids.js";
import type { ScenarioId } from "../../rules/identity/ids.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineWorkflowRole } from "./module-role.js";
import { workflowStructuralScenarioPath } from "./source-layout.js";

/** Declared scenario IDs and paths are registry metadata, not proof of execution; an unresolved source stays unresolved until a collected test supplies evidence. */
export const GRAPH_SCENARIO_FILE_PATTERN =
  /^tests\/scenario\/(?:[a-z0-9-]+\.scenario\.test\.ts|workflows\/(?:[a-z0-9-]+\/structural|[a-z0-9-]+\/steps\/[a-z0-9-]+\/structural)\.scenario\.test\.ts)$/u;
export const INTEGRATION_WALK_FILE_PATTERN = /^tests\/scenario\/[a-z0-9-]+\.walk\.test\.ts$/u;
/** A DASHBOARD scenario over the real projection/command service (no browser, no graph). A third KIND, not a graph arm: it claims NO scenario id — the opposite obligation to a graph scenario. */
export const DASHBOARD_SCENARIO_FILE_PATTERN =
  /^tests\/scenario\/dashboard\/[a-z0-9-]+\/[a-z0-9-]+\.scenario\.test\.ts$/u;

export const ExecutableScenarioSpecSchema = z.strictObject({
  scenarioId: ScenarioIdSchema,
  file: z.union([z.string().regex(GRAPH_SCENARIO_FILE_PATTERN), z.literal("tests/workflows/person-lookup/workflow.scenarios.integration.test.ts")]),
});

/** Production scenario ids are registered here; contracts and descriptors may reference only these, and a lane separately proves each row is a real `it(...)` in its file. */
/** Every registered workflow owns exactly one structural scenario source file. */
const SEPARATIONS_KRONOS_TIMECARD_FILE = workflowStructuralScenarioPath("separations-kronos-timecard",
  defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: "kronos-timecard" }));
const SEPARATIONS_KUALI_READ_FILE = workflowStructuralScenarioPath("separations-kuali-read",
  defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: "kuali-extraction" }));
const SEPARATIONS_IDENTITY_CHECK_FILE = workflowStructuralScenarioPath("separations-identity-check",
  defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: "identity-check" }));
/** The UCPath termination write — the two transactions share one file. */
const SEPARATIONS_UCPATH_TERMINATION_FILE = workflowStructuralScenarioPath("separations-ucpath-termination",
  defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: "ucpath-transaction" }));
const SEPARATIONS_KUALI_FINALIZATION_FILE = workflowStructuralScenarioPath("separations-kuali-finalization",
  defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: "kuali-finalization" }));
const SEPARATIONS_FILE = workflowStructuralScenarioPath("separations", defineWorkflowRole({ kind: "composition" }));

/** The person-lookup workflow — ONE structural scenario file, as §10.3 admits exactly one collected structural scenario per workflow. */
const PERSON_LOOKUP_FILE = workflowStructuralScenarioPath("person-lookup", defineWorkflowRole({ kind: "composition" }));

export const DECLARED_SCENARIO_MANIFEST = deepFreeze(ExecutableScenarioSpecSchema.array().parse([
  { scenarioId: "person-lookup/s1", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s2", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s3", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s4", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s5", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s6", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s7", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s8", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s9", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s10", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s11", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s12", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s13", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s14", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s15", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/s16", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/m1b", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/m1", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/m2", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/m3", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/m4", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/m5", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/f1", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/f2", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/f3", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/f4", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/f5", file: "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts" },
  { scenarioId: "person-lookup/happy-by-eid", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/happy-by-eid-with-dates", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/ambiguous-name", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/not-found", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/crm-failure-retry", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/crm-subject-mismatch", file: PERSON_LOOKUP_FILE },
  { scenarioId: "person-lookup/ucpath-drill-subject-mismatch", file: PERSON_LOOKUP_FILE },
  // The two ordinary recovery choices, proved over the registered descriptor.
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
    file: SEPARATIONS_KRONOS_TIMECARD_FILE,
  },
  {
    scenarioId: "separations-kronos-timecard/timecard-without-punches",
    file: SEPARATIONS_KRONOS_TIMECARD_FILE,
  },
  {
    scenarioId: "separations-kronos-timecard/employee-not-found",
    file: SEPARATIONS_KRONOS_TIMECARD_FILE,
  },
  {
    scenarioId: "separations-kronos-timecard/search-no-signal",
    file: SEPARATIONS_KRONOS_TIMECARD_FILE,
  },
  {
    scenarioId: "separations-kronos-timecard/wrong-employee-timecard",
    file: SEPARATIONS_KRONOS_TIMECARD_FILE,
  },
  {
    scenarioId: "separations-kuali-read/reads-a-real-separation-document",
    file: SEPARATIONS_KUALI_READ_FILE,
  },
  {
    scenarioId: "separations-kuali-read/unprocessed-document-absent-arms",
    file: SEPARATIONS_KUALI_READ_FILE,
  },
  {
    scenarioId: "separations-kuali-read/non-separation-document",
    file: SEPARATIONS_KUALI_READ_FILE,
  },
  {
    scenarioId: "separations-kuali-read/unparseable-separation-date",
    file: SEPARATIONS_KUALI_READ_FILE,
  },
  {
    scenarioId: "separations-kuali-read/unknown-termination-type",
    file: SEPARATIONS_KUALI_READ_FILE,
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
  DECLARED_SCENARIO_MANIFEST.map(({ scenarioId }) => scenarioId),
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

/* ── the corpus's own layout ──────────────────────────────────────── */

/** One file in `tests/scenario/`, as the guard's directory read observes it. Titles are passed in, not read here, so this pure audit is proved against violating corpora, not a live tree. */
const ScenarioCorpusFileSchema = z.strictObject({
  /** Repo-relative, forward-slashed. */
  file: z.string().min(1),
  /** Every top-level `it(...)` title in declaration order. */
  itTitles: z.array(z.string()).readonly(),
});
export type ScenarioCorpusFile = z.infer<typeof ScenarioCorpusFileSchema>;

// Slug-shaped title typos still claim scenarios and must fail validation.
export function claimedScenarioId(title: string): string | undefined {
  const head = title.split(" — ")[0] ?? "";
  return ScenarioIdSchema.safeParse(head).success ? head : undefined;
}

/** Both directions over the corpus DIRECTORY — the half the registered-set audit cannot see. `graphClaimedIds` supplies graph claims for fixture descriptors with no production reference. */
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
  for (const row of DECLARED_SCENARIO_MANIFEST) {
    rowsByFile.set(row.file, [...(rowsByFile.get(row.file) ?? []), String(row.scenarioId)]);
  }
  const registeredFile = new Map(
    DECLARED_SCENARIO_MANIFEST.map((row) => [String(row.scenarioId), row.file] as const),
  );
  for (const file of rowsByFile.keys()) {
    if (!paths.includes(file)) {
      violations.push(`manifest rows name ${file}, which is not in the scenario corpus`);
    }
  }

  for (const { file, itTitles } of files) {
    const isGraphScenario = GRAPH_SCENARIO_FILE_PATTERN.test(file) || file === "tests/workflows/person-lookup/workflow.scenarios.integration.test.ts";
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
