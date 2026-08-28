# Decisions — R2c `clear-pending` diagnostic scope — 2026-08-28
_Answer positionally: `1 A`, `1 B`, or `1 C + "note"`. Unanswered items stay open._

## 1 · How should R2c obtain a reproducible failed page state?

**Situation.** The historical 4568 dry run failed because the SS Smart HR search produced neither
of the two settlement signals within 45 seconds, but it persisted no post-click DOM, route, frame,
or screenshot evidence. Two fresh isolated searches now show the old implementation succeeding in
under one second. Without a different live state, a regression test for a banner-first repair would
either stay green against the old code or invent an unobserved fixture.

**Options.**

- **A. Authorize one diagnostic-capture unit before u32.** Add narrowly scoped, redacted failure
  capture at the SS Smart HR settlement boundary, with tests and correctness/silent-failure review;
  then hold R2c until that instrumentation captures a real differential state. This delays the repair
  and may require waiting for the failure to recur, but preserves the reproduce-first and fail-loud
  bars.
- **B. Authorize the banner-first redesign without causal reproduction.** Implement and test the
  count-banner classifier as hardening even though the current live state also passes the old code.
  This is faster, but it cannot prove the historical bug is fixed and risks regressing unobserved
  row-before-banner or no-match states.
- **C. Park R2c and move to other Phase 3b work.** Make no diagnostic or settlement change now. This
  avoids speculative code, but exit row 5 and the 4568 rehearsal remain open with no improved evidence
  if the failure repeats.

**Recommendation.** **A** — it is the only option that can produce a real RED fixture without
weakening the repository's fail-loud rule or pretending the current successful page reproduces the
historical failure.

**Notes.** _(your notes here)_
