# DCC2 independent findings ledger

This ledger supersedes raw review conclusions where explicitly corrected below. Raw reports remain
for audit; withdrawn findings are not blockers. Full gates and the final close report are separate.

## Candidate chain

- First resolved merge tree: `d8bf813e71925756f1f238dd142886410ba3e5ff` — eight independent axes.
- Corrected tree: `55bdd6ab9b52c941bc9b0a5594d6e24f543cb1a8` — eight independent delta axes.
- Test typing correction: `877254acdce78a4425b6561dc2140a27d4861adc` — one Promise.resolve change, covered by Tests.
- Final bounded corrections: `45a935d7f59d6d649a8db4bb5ab4e44a20e1c17b` — Standards, Security,
  Tests and Spec followup. Production delta is ordinal intermediate-directory labels plus unused
  symbol removal; tests add a valid-control/schema-path precondition and three-boundary symlink regression.
- Final test expectation: `a296aa29b7308d318c6fc4a8a9ba9642acbe9082` — one existing symlink-race
  expected string updated from supplied intermediate basename to ordinal 1. Tests followup covers it.
- CLI fixture typing correction: `e4ab3837feef579e8462b59e27eb9eb3015d0f65` — CLI composition
  accepts the fixed `.tracker-rebuild` direct child of its trust anchor, not custom nested state roots.
  Only its unsupported nested-root matrix case is removed; doctor/browser retain that case and
  all 18 applicable CLI cases remain. No production type broadening or assertion removal within
  a supported case. Tests and Security independently review this one-file delta.
- M3F approved fixture repair: `56ba105f1841097927a444d6454686c954b4e9db` — four runtime and
  three test additions exactly matching 845ca5a1/964c9636, plus four-line AGENTS note. Supervisor's
  additional focused preflight found two missing-credential failures and withdrew e4ab readiness.
  The existing synthetic sessions now supply the existing fixture Duo gate through an optional
  forwarded input. Production CLI omission and fail-loud default credentials remain unchanged.
  Independent Tests, Security, Correctness and Silent failures reviews all returned zero.

All candidate reviews were pinned before the merge commit, with HEAD ac40292b and merge parent
13175b13. After full-gate acceptance, local merge `0b9a4de73504aeb1dc354e82927e0423960b0a37`
preserves exact final tree 56ba105f and both those parents.

## Findings and explicit retractions

| Axis | Initial/corrected finding | Verified disposition |
|---|---|---|
| Standards | Raw corpus-read exception could escape; later an intermediate component entered a trusted label | Closed raw-error boundary, private safe-error type and ordinal intermediate labels. Final independent Standards review: zero. Configured final-root basename policy intentionally retained. |
| Spec | Requested union of absent diagnoses around malformed authority | **WITHDRAWN by same reviewer**: frozen baseline explicitly withholds absence classification when any authority row is malformed. No new union/absence policy implemented. |
| Spec | Docs overclaimed every problem and then globally suppressed supplied workflow values | Narrowed malformed refusal and corpus parsing/stream-structure guarantees; existing authority identity-mismatch diagnostic explicitly unchanged. Final independent Spec review: zero. |
| Correctness | HIGH claim that archived retained task-without-queued-root must be newly refused | **RETRACTED by same reviewer** after exact baseline inspection: reverse rule covers current non-archived runs, not all retained archived task streams. No unsupported behavior change. Final Correctness delta: zero. |
| Correctness/preservation | Exact task-parent predicate and caller-abort deadline-disarm proof were missing at first pin | Exact baseline parent comparison restored; red-capable regressions and timer mutation proof retained. Reviewed corrected candidate. |
| Silent failures | None | Initial and corrected independent review: zero. |
| Performance | Quadratic malformed-resolution deduplication; full orphan-history array/sort | Exact-key Set and streaming strict record inspection. All released records still validated. Final Performance delta: zero. |
| Performance | Proposed separate current-owner summary | **WITHDRAWN**: would skip malformed released history and change authority. Total inspection remains O(history) I/O; no claim of bounded total runtime. |
| Tests | No direct concrete Vite transport-error test | Two direct tests pass and fail under wrong-reason mutation. Cleared in independent delta. |
| Tests | Dynamic-key fixture did not establish marker-bearing nested schema failure | Valid queued control and exact nested invalid-key precondition added. Old full issue.path formatter mutation still passes because union.path is root: this is a **negative control, not a demonstrated nested-key egress regression**. Never represent that mutation as RED. Final Tests disposition recorded separately. |
| Docs | Diagnostic contract lagged actual safe-error boundary | Owner and root AGENTS updated. Docs delta: zero; final Spec/Standards review covers subsequent wording. |
| Security | Supplied span/parent paths and filenames could disclose synthetic private/secret/person markers | Field-only contradictions, grouped SHA-256 filenames, safe error vocabulary. Historical 57-case run included one unsupported custom CLI isolation fixture; current matrix has 56 applicable cases (19 doctor, 19 browser wire, 18 CLI). Final Security review and current logs are recorded separately. |

## Review coverage decision

M1/M2 are read-only mapping/judgment, verified by supervisor against git/owner excerpts. M3 requires
all eight axes because it changes authority, concurrency, public contracts, errors and performance.
All were independently dispatched using native high roles. Final production delta is solely diagnostic
label construction and unused-symbol removal: Standards/Security cover it; Tests covers test changes;
Spec covers owner wording. No new authority/concurrency/performance behavior requires repeating the
already-cleared axes. Generated roadmap freshness is a gate, not a subjective review.
M4 is independent verification only; any source change must return for a bounded repair/review.

M3F has its own four independent delta reports (`dcc2-m3f-review-*.md`). Their production-default
trace covers CLI composition → optional forwarding → unchanged worker factory → strict credential
identity resolution. The runtime/test blobs equal the approved source commit exactly; existing
assertions and timeouts are unchanged. Performance loops, schemas, wire/auth/core/migrations and
UI did not change, so those prior axes remain valid rather than being re-run without cause.

## Gate honesty

Old full typecheck/lint canceled by coordinator SIGTERM remain **CANCELED, exit 143**.
Intermediate suites with failures remain **RED** even where many tests passed.
Light-lock timeout is **QUEUED/75**, not a product pass or failure. Full coverage/parity are not
authorized until explicit coordinator allocation; an available OS lock alone does not authorize them.

## M4 manual UI discovery after passing gates

Full coverage 3,831/3,831 and parity 239/239 passed on 56ba105f with actual exit 0. The subsequent
loaded Storage health response contained degraded spanAuthority and four malformed span-stream
problems, while the rendered detail omits this field. Both original ac40292 and baseline 13175
DoctorReport omit it; dashboard source was deliberately preserved exactly from baseline. Prior
review scopes remain cleared, but that does not imply visual coverage of these diagnoses.

Supervisor verified owner §2.5's exact wire accounting and §9.8's narrower explicit visible inventory,
then requested coordinator disposition rather than treating the new observation as automatically
waived or authorizing a new UI feature. Coordinator independently verified both source parents,
the exact candidate and owner/evidence, and explicitly allowed the bounded backend commit without
closing the presentation gap. **OPEN dcc-storage-span-visibility** remains coordinator-owned under
dashboard-surfaces §9.8: degraded 11 stream / 7 live runs with four malformed diagnoses are served,
not rendered. This is non-blocking for the exact reconciliation only, not global UI acceptance.
Raw M4 report, screenshot/snapshot and successful HTTP response are the evidence. The unsuccessful
capture helper and favicon 404 remain explicit, not silently rewritten into passing browser proof.
