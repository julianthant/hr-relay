# R2 supervisor report — Order 1 workflow-specific intake

**Status:** COMPLETE intake boundary, including the D312–D316 authority amendment;
`NEEDS COORDINATOR` decision residue preserved for R3

**Mode:** coordinated-read-only
(`/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/phase-3c-migration/board.md`)

**Branch:** `feature/03c-r2-order1-intake`

**Isolated launch parent:** `81c74fb0e4114891ee3d1261ff27268833a7536d`

**Profile/brief integration base:** `414d77b810f713d5813c79035fd38064ba04e73c`

**Scope:** u10–u12 only. No compiler/source/dashboard/parity/phase/roadmap/capability/session-panel
file changed, no external write occurred, and the coordinator board was not written.

## Outcome by unit

| Unit | Outcome | Evidence |
|---|---|---|
| u10 — workflow decisions | Created the complete §b records for `person-lookup` Search/Match and `i9-lookup`; inherited policy is cited, exact task seams are named, no workflow `you:` line remains, and the T1b authority conflict is explicit. | `docs/migrations/person-lookup.md`; `docs/migrations/i9-lookup.md`; commits `daa51858`, `14a801a9`, `66e0cd73` |
| u11 — reuse/provenance/live map | Classified every Order 1 seam REUSE/CUSTOMIZE/BUILD, pinned legacy source blobs, recorded fail-loud port deltas, live-verified I-9 login/search state, and closed the owned browser session. | `docs/coordinator/phase-3c-migration/research/r2-order1-reuse-map.md`; commits `daa51858`, `14a801a9` |
| u12 — R3-ready synthesis | Fixed workflow roles and stable contract ids, scenario/crash/impossible-case matrices, confidence maps, canary needs, capability close conditions, T2/T3 scope, D312–D316 consequences, and the decision packet below. | This report plus the intake and amendment commits |

## Exact implementation intake

- `person-lookup` remains one standalone `reject-active` workflow with Search and Match modes.
  Search preserves Order 0. Match CUSTOMIZES the UCPath driver and BUILDS
  `ucpath/search-hr-tasks-person` plus
  `workflow:person-lookup/derive-match-result`; a second workflow id is forbidden.
- `i9-lookup` is a standalone single-surface workflow. BUILD
  `i9/search-employees`, `i9/read-form-summary`, and
  `workflow:i9-lookup/derive-signer-result`, plus the store driver, verified login recipe and UI
  catalog. The legacy malformed-row skip, access-check default and empty-signer fallback do not port.
- Both workflows owe structural T1. The person mode chooser owes T2 and its live T3 condition; I-9's
  ordinary projections ride compiler conformance. The live T1b halves and the mode T3 are blocked on
  the decision below.
- D312's exact four-artifact cap applies to reuse-only workflows. Both Order 1 workflows keep the
  recipe/structural-scenario/live-declaration/migration-record base surface; their genuinely new
  reusable task/driver files own behavior only and do not carry descriptor, module, registry, or
  generic-dashboard glue.
- Their recipes use stable-id `task(...)` entries only: no `parallel`, `delegate`, `gate`, or
  `transaction` entry and no omission schema. Structural proof distinguishes checkpoint resume
  (including Search's `always-rerun` active-status read) from restart as the same logical item's new
  attempt, where every read/compute reruns.
- `legacy-workflow-person-lookup` and `legacy-workflow-i9-lookup` stay `open` until R3 native/live
  evidence lands. The I-9 entry's derived “pure UCPath read” wording is corrected at that boundary.

## D312–D316 authority amendment

The coordinator reopened R2 after its initial close. Integration commit
`1273c3605a0ae6776a86db34f36077fae49ff50b` ratified the owner text; R2 cited that exact authority
and amended the two migration records plus reuse map without implementing compiler/runtime behavior.

| Decision | Order 1 intake consequence |
|---|---|
| D312 | The strict four-artifact cap is recorded as reuse-only. Person Match and I-9 add genuine behavior, so their base four workflow artifacts may be joined only by behavior-owned task/driver/login/UI files; no workflow glue may hide in them. |
| D313 | Neither read-only workflow declares an omission. There is no replacement-value schema, hidden skip, mid-run value request, write-sensitive assertion, or in-workflow mandatory verifier. A future writing parent owns any separate visible verifier. |
| D314 | T1 includes both checkpoint resume and restart from start. Resume replays valid checkpoints but reruns every `always-rerun` ancestor, including Person Search's active-status read. Restart keeps the same logical item, mints the next attempt, ignores old read/compute checkpoints, and reruns every read/compute from the unchanged admitted input. |
| D315 | Every operation is an explicit stable-id `task(...)`; absence of parallel/delegate/gate/transaction entries is graph truth, not missing coverage. |
| D316 | Person Lookup is a named equivalence/deletion fixture. I-9 is not; it may use only the accepted compiler path after the Person-Lookup/Separations deletion gate and cannot revive the deleted path. |

D312 requires a live declaration but does not redefine `dryRun`; D313–D316 also leave D209 intact.
The read-only T1 conflict below therefore remains a separate unresolved coordinator decision.

## Live evidence — 2026-09-02

Read-only `playwright-cli` session `r2i9` used Duo Autopilot and reached Tracker I-9 Complete through
UCOP → WAYF → UCSD SSO → Duo. Dashboard link plus unique `#divSearchOptions` are current non-URL
login facts. The named search dialog and its clear-filter, Last Name, First Name, SSN, Profile ID,
Employee ID and exact Search locators each resolved once after the unrelated product announcement
was closed.

The repository-pinned 2026-06-06 signer subject has changed to an incomplete Section 1/2 action;
direct summary navigation now yields System Warning. It cannot re-verify summary/audit selectors.
R3 therefore needs a new same-day, access-visible completed signer canary. No person values are in
the artifacts. `playwright-cli list` returned no browsers after close.

## NEEDS COORDINATOR — read-only T1 live proof

Authority checked:

- doc 03c §4 and ref guards-and-tests §10.11 require every workflow's T1b live dry-run manifest;
- ref workflow-model §2/D209 requires a graph with no transaction node to refuse `dryRun` as
  `no-transaction-node`; and
- both Order 1 workflows must remain structurally read-only.

R2 does not choose or ratify an exception and changed none of those authorities. R3 waits for the
operator decision.

| Option | Consequence |
|---|---|
| **A — explicit `live-read` T1b arm (recommended)** | Add a distinct T1b admission/result mode for transaction-free graphs. D209's `dryRun` meaning stays intact; graph-level absence of transactions and zero write-authority deltas remain asserted; one durable live-evidence framework survives. Requires explicit owning-contract changes before R3. |
| **B — ordinary live-run evidence path** | Record read-only workflows through normal start/worker execution outside `dry-run-scenario`. D209 stays intact, but guards, result storage and close rules must accept a second proof authority. |
| **C — no live half for read-only T1** | Amend doc 03c/ref guards-and-tests so transaction-free workflows receive structural T1 plus selector evidence only. Lowest implementation cost, but weakens the stated every-workflow live proof. |

A no-op transaction is rejected rather than offered: it would falsify workflow effect/graph semantics
only to satisfy the runner. Option A best preserves both existing safety intents, but it is a
recommendation for the coordinator's operator decision sheet, not a decision made by R2.

## Review record

Pinned initial target: `daa518588b2e415891e3b5f4db52678d97e026a8`.

| Axis | Initial result | Resolution / re-review |
|---|---|---|
| Standards | 2 low + 1 judgement: over-copied inherited trust text and deferred task names | Reduced to workflow deltas; stable ids recorded in `14a801a9`. |
| Spec | 1 high + 2 medium + 1 low: D209 conflict, Match task classification, I-9 role, task ids | All corrected/preserved in `14a801a9`; focused Terra re-review: `Count: 0 · Worst: none`. |
| Docs | 3 medium + 3 low, then 1 medium + 1 low: missing crash/impossible cases and confidence mappings, stale citation/base attribution, access-probe wording | Corrected in `14a801a9` and `66e0cd73`; final Luna re-review: `Count: 0 · Worst: none`. |
| D312–D316 authority reconciliation | Coordinator amendment received after initial close; exact owner text was not yet on this branch | Pinned integration commit `1273c360`. Initial focused reviews of `e1a55921` found one spec medium, one standards medium plus two lows, and five docs mediums plus one low, with overlap on `always-rerun` and review-record evidence. Corrected in `9bd30dc5`; focused Terra spec, Luna standards and Luna docs re-reviews each returned `Count: 0 · Worst: none`. |

Correctness, Silent failures, Performance and Tests were skipped as code axes because the branch is
documentation-only and changes no runtime behavior. Security was supervisor-reviewed: no auth,
permission, secret, command-execution or external-write boundary changed; live evidence contains no
credential/person value. Simplify was not requested and no unnecessary implementation diff exists.

## Gates

| Gate | Result |
|---|---|
| Supervisor role policy | `codex: role policy valid (1 supervisor + 4 workers)` |
| `npm run typecheck` | PASS with the worktree's exact locked dependency install |
| `npm run lint` | PASS, ESLint over `src tests scripts --max-warnings 0` |
| `npm run roadmap:check` | PASS — `docs/roadmap/index.html is fresh.` |
| `git diff --check` | PASS after every document correction |
| Tests | Not run: documentation/intake artifacts only; no production/test behavior changed. |
| Live resource cleanup | PASS — `Browser 'r2i9' closed`; `playwright-cli list` → `(no browsers)` |

The first typecheck attempt before the locked install invoked a missing/incorrect compiler through an
incomplete shared dependency directory and was invalid environment evidence. `npm ci --ignore-scripts`
installed this worktree's lockfile; the table records the subsequent valid green run. The temporary
`node_modules/` was removed before final close.

## Board concurrency note

At intake, the exact read-only board was observed at main-checkout HEAD
`888893c2351e0b8abcf5d6a5da7f3ec013ad5896`, Git blob
`51259faa944c1663f979659cb82a24ce7e3ae13d`, SHA-256
`1f0254397458c44fcafdaf04e557df2ec1c0bf56242abec75a6dd10da6aac95e`.

At the initial close it had changed under the coordinator to main-checkout HEAD
`7b3325d672542c2c5f4c54396bb1a28c9d2597b8`, Git blob
`bf66a5def7fa0223b00eb0e4b069cb0cb2cdafd7`, SHA-256
`d814ff89527ca6a16465e0822a8b036b9cbb5e77794041e0fcd543626cccaf8c`.

At amendment close the coordinator-owned board had advanced independently to main-checkout HEAD
`889ca344f9c2740a4bf0f5664854773d81aeb628`, Git blob
`06bca6af98cf3596ab96f5faae2bf4aa7ec32a3d`, SHA-256
`fc56aa32eafbc6f9d4cb09600a563daedbde84e1b8e695d163068021f087f07f`. It records the D312–D316
amendment, permits R2 to close with the T1 residue isolated, and points the question to the
coordinator-owned decision sheet. The board bytes were unchanged at final verification while the
main checkout advanced to `db72bae6cfce55b5632f68176bfac1d86a895589`. R2 did not edit, stage or
commit the board.

## Commits and residue

| Commit | Logical category |
|---|---|
| `daa518588b2e415891e3b5f4db52678d97e026a8` | Initial two migration records plus reuse/provenance/live research |
| `14a801a9fbf3f2bb6b7d8a624ae8e12ca57787c2` | Review fixes and explicit D209/T1b conflict/options |
| `66e0cd737efbafddfa97d1551276b211a638e987` | Final trust-confidence and access-observation corrections |
| `06882995c13c289ee674163d2e4f06dc1f720e98` | Initial R2 report before the coordinator's D312–D316 amendment |
| `e1a55921a7468d980447ebf0e6c54d70b6b29f3d` | D312–D316 application pinned to integration authority `1273c360` |
| `9bd30dc5f604842d4bd0044543188dc4e18d6f71` | Focused review fixes and commit-qualified owner citations |

Open residue is exact: coordinator decision 1 for the read-only T1 live-proof contract; a new live
I-9 completed-signer canary; R1 compiler integration before R3 implementation. No successful-run
handoff was created.
