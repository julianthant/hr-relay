/**
 * Sanitized 2026-08-28 read-only measurement that bounded DCR3's search
 * vocabulary. It intentionally carries counts and closed values only: no run,
 * trace, item, title, or person identity from the live corpus is fixture data.
 */
export const SANITIZED_CROSS_DATE_SEARCH_CORPUS = Object.freeze({
  authority: Object.freeze({
    runs: 7,
    workflow: "separations",
    days: Object.freeze([
      Object.freeze({ day: "2026-08-27", states: Object.freeze({ done: 1, failed: 3 }) }),
      Object.freeze({ day: "2026-08-28", states: Object.freeze({ "parked-gate": 1, failed: 2 }) }),
    ]),
    shape: Object.freeze({ single: 7 }),
    dryRun: Object.freeze({ true: 7 }),
    resolvedSystems: Object.freeze({ ucpath: 7, kuali: 7, "new-kronos": 7 }),
    retryOf: Object.freeze({ present: 2, absent: 5 }),
    displayName: Object.freeze({ present: 0, absent: 7 }),
  }),
  projection: Object.freeze({
    folds: 57,
    validSpanLines: 959,
    authorityJoinedSpanIdentities: 7,
    orphanSpanIdentitiesExcluded: 50,
    authorityRunsMissingSpans: 0,
  }),
});
