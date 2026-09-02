# R3b — exact pending sweep and surviving filing authority

**Verified: u17 and u18 are implemented without a real HR write.** A pending termination sweep is now bound to the exact machine-observed eligible and protected transaction set, revalidated before selection, and verified after deletion without allowing the real filing row to disappear. Kuali finalization now requires a fresh read proving its exact UCPath filing still exists. Default coverage and parity are green, the dashboard is restored, and no new workflow run, gate decision, registry mutation, deletion or real write occurred.

Date: 2026-09-02. Supervisor: `/root/sup_supervisor_separations_readiness`. Repository `/Users/julianhein/Projects/hr-automation-rebuild`, branch `feature/03b-live-close`; admitted source `52968cf0`, final implementation/reference source `f2eee0ae`. Exact brief `../briefs/r3b-sweep-and-filing-survival.md`; established serial primary-checkout exception. Units u17/u18 are supervisor-owned. One native read-only scout mapped the pre-change authority; one native `sup_terra` completed consequential review.

## Exact pending-set authority

The authenticated SS Smart HR search/detail read now produces one canonical `UcpathPendingTransactionSet`: every in-progress termination for the exact EID is in the ordered `eligible` partition, and every other transaction returned by that same search is in the ordered `protected` partition. Each row includes the stable UCPath transaction ID plus EID, rendered name, action, approval status and effective/start date. Duplicate IDs, another EID, an unsorted set or a row in the wrong partition fails schema admission.

Live read-only mapping proved the bridge to the separate Transactions in Progress deletion grid. The grid has six named data columns but no transaction-ID column; its row and checkbox suffixes are positional. The real driver obtains stable IDs from each SS Smart HR detail page, then requires a complete unique match on EID, normalized name, date and termination action before associating one checkbox with one transaction. Transaction Type and Country are required nonempty grid facts and retained in staging evidence, but they are not cross-surface identity because the detail authority does not expose them. Full sanitized provenance is `../evidence/r3b/live-pending-row-identity.md`.

The permanent v2 intent key hashes the complete canonical eligible/protected set, so two sets for one EID cannot alias. An exact replay reuses the settled intent before opening a browser. A historical empty person-only no-op cannot suppress a later nonempty v2 set. Any immutable person-only key is recognized only as retired authority and refuses before browser, probe, fence or click; it is never reinterpreted or rewritten.

The write sequence independently scans the exact set, and `prepare` re-reads the stable-ID source immediately before touching a checkbox. Missing, extra, changed, newly appeared, ambiguous, moved or already-gone eligible rows refuse before selection/fence/click. The post-delete verifier requires the exact selected set absent and every protected transaction still present with unchanged facts. UNKNOWN or an unreadable outcome still stops; ordinary sweep-before-file ordering remains.

Current deletion settlements carry a version-2 durable proof with the canonical selected and protected transaction-ID lists plus the full set digest. This answers the compatibility concern without changing frozen bytes: pre-D310 historical result/archive proof remains accepted under its original observation-only schema, while every new D310 commit requires the v2 proof. The stable IDs of the deleted and protected sets are therefore recoverable from the durable proof, and the digest binds their complete load-bearing row facts to the intent. Archive resolution recognizes both named schema eras; it does not upgrade old evidence.

## Filing survival before Kuali

The Kuali finalization graph now contains an always-rerun **Verify Current UCPath Filing** task immediately before the finalization transaction. It performs a fresh authenticated SS Smart HR read and requires exactly one row whose stable transaction ID equals the successful filing receipt, whose EID/effective date agree, and whose status remains acceptable. Missing, denied, deleted, changed, ambiguous or mismatched evidence refuses before the Kuali fence/click.

The filing-presence task consumes the already durable filing receipt. A downstream refusal preserves that receipt and never re-files to repair finalization. Its observation uses the existing freshness boundary and is not checkpoint-reused. D307 operator-asserted omission evidence remains visibly asserted and cannot qualify as controlled filing presence.

Real executor/composition tests cover the deleted-filing refusal from migration §9.36 and the valid surviving path, crash/resume/replay, exact-set changes, retired-key refusal, protected-row survival, supplied-EID continuation without a workflow gate, name-only parking at its single identity gate, dry-run zero write deltas and UNKNOWN stops. No caller/UI bypass or additional ordinary supplied-EID approval was added.

## Ratification

D310 is recorded in `docs/rebuild/reference/decisions.md`; the normative mechanics are in `docs/rebuild/reference/write-safety.md`. Migration §9.39, phase 03b and the roadmap record exactly what the code proves: the deletion witness is an independent disposable exact set, and the real filing must survive through finalization. D309 remains unchanged: supplied EID plus exact read-back is machine authority with no workflow gate; name-only identity has one operator gate.

The ratification does not select a disposable live target, establish its restoration/retention disposition, authorize a live write, or claim that the controlled proof has run. Historical evidence stays historical. Root, UCPath-store and scenario instruction twins document the non-obvious contract and are byte-identical.

## Commits

| Commit | Result |
|---|---|
| `1bda8afb` | Implemented exact-set contracts, v2 key/replay refusal, live/fake UCPath read-stage-verify paths, filing-presence task, workflow wiring, tests, manifest and instruction twins. |
| `730a5030` | Ratified D310's proved mechanics in the owner/pointer and reconciled migration, phase and roadmap authority. |
| `4e00d145` | Preserved frozen historical proof compatibility while requiring recoverable v2 exact-set evidence for new settlements; repaired finalization and D307 fixtures. |
| `f2eee0ae` | Committed the reviewed deliberate parity reference update for the moved descriptor/graph authority. |

All implementation commits used explicit path staging on `feature/03b-live-close`. No push, master merge, board write or branch deletion occurred.

## Gates and causal reds

| Command / proof | Result | Evidence |
|---|---|---|
| Focused red → green | New exact-set and filing-presence assertions failed before implementation, then the repaired cluster passed 11 files / 242 tests; broader R3b focus passed 9 files / 125 tests | supervisor TDD loop |
| `npm run typecheck` | exit 0 after complete contract/fixture propagation | final source |
| `npm run lint` | exit 0, zero warnings | final source |
| First `npm run test:coverage` | exit 1; 378/389 files, 4,618 passed and 11 failed of 4,629; exposed frozen proof-shape, filing fixture and D307 inventory incompatibilities | `../evidence/r3b/full-gates.log` |
| **Final `npm run test:coverage`** | **exit 0; 389/389 files, 4,818/4,818 tests, 132.71 s** | `../evidence/r3b/full-gates-green.log` |
| Coverage | statements 85.26%; branches 76.33%; functions 89.21%; lines 87.20% | same log |
| `npm run build:manifest:check` | exit 0, current | final check |
| `npm run roadmap:check` | exit 0, fresh | final check |
| `git diff --check`; affected instruction twin comparisons | exit 0 | final check |
| First `npm run test:parity` | exit 1; 208 expected reference drifts while 79 behavior tests passed | `../evidence/r3b/parity.log` |
| Reviewed `npm run test:parity:update` | exit 0; 287/287 | `../evidence/r3b/parity-update.log` |
| **Final `npm run test:parity`** | **exit 0; 287/287 in 1.1 m** | `../evidence/r3b/parity-green.log` |

The parity audit covered 456 text and 55 PNG references. Text changes were the two descriptor hash families, served short fingerprints, the new node/scenario/counts and implementation hashes. PNG differences were localized to rendered fingerprints or the affected Explorer graph, including a visual check of the new filing-presence node. No UI source changed. Exact classification: `../evidence/r3b/parity-reference-audit.md`.

## Review

Native `sup_terra_r3b_consequential_review` returned PASS with no correctness, security, replay or compatibility finding. Its independent focus passed 9 files / 115 tests. It verified complete exact-set keying, pre-effect refusal of retired keys, re-read/protected survival, always-rerun filing presence, D307 assertion integrity and dry-run zero writes. The supervisor reviewed the full `52968cf0..f2eee0ae` change, the compatibility repair, generated outputs and parity deltas. Full conclusion: `../evidence/r3b/consequential-review.md`.

## Restored runtime

`npm run dashboard` remains running: BFF PID **39300** on `127.0.0.1:3938`, Vite PID **39297** on `127.0.0.1:5174`; both returned HTTP 200. Bootstrap serves descriptor-set hash `26584ed3f0c7cb6af09d89674a6613b3854ca98ba2aaccab5dc0af0435f33a68` and separations fingerprint `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`, matching the current build/reference authority.

Storage doctor reports healthy schema 29 authority, generation 2025, `quick_check ok`, a current gap-zero backup and 19 reconciled current streams. Durable counts remain runs/write intents/write attempts/outbox = **19/0/0/0**, exactly the pre-run baseline. No dashboard run was started. The owned live mapping browser closed and the final browser sweep reports none. Structured proof: `../evidence/r3b/runtime-after.json`.

## Integration state and residue

R3b closes the implementation mechanics, not the live controlled proof. R4 still needs an explicitly authorized disposable target, an independently proved deletion with exact pre/post evidence, and an operator-owned restoration/retention disposition. A legitimate real filing may be retained as filing evidence; it can never serve as the deletion witness or a blanket restoration waiver. Operational `dryRun=false` admission remains separate from workflow identity gating.

No R3b operator call remains. The remaining target/disposition packet can proceed against these implemented seams without reopening D309 or adding per-write approval gates.
