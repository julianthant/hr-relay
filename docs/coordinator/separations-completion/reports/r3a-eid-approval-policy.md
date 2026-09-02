# R3a — supplied-EID approval policy

**Verified: D309 is ratified and implemented.** A separation whose independently supplied EID is proved by UCPath's actual read-back proceeds under typed machine-verification authority without inventing a human decision. A name-resolved identity still parks at the existing operator gate. Missing, malformed, moved, relabelled or mismatched evidence refuses before any write. The default coverage and parity gates are green, the dashboard is restored, and no real HR write or new workflow run occurred.

Date: 2026-09-02. Supervisor: `/root/sup_supervisor_separations_readiness`. Repository `/Users/julianhein/Projects/hr-automation-rebuild`, branch `feature/03b-live-close`; admitted source `0dd63cbc`, final implementation source `5931a695`. Exact brief `../briefs/r3a-eid-approval-policy.md`; established serial primary-checkout exception. Units u10-u12 are supervisor-owned. One read-only scout failed before returning findings due an account usage limit; it had no write ownership. One native `sup_terra` completed consequential review.

## Implemented authority

The graph now distinguishes three declared identity origins: `document-eid`, `canonical-eid` and `name-resolved`. The identity comparison task binds the requested identity to the UCPath job-summary EID that the store actually read back. For the two supplied-EID origins, exact read-back produces a machine-verification packet. A mismatch, missing proof, source relabel, moved packet digest or name-resolved packet presented as self-verifying fails loudly. A displayed name difference remains visible evidence and does not override exact supplied-EID/read-back equality. Employment and other business validations remain independent.

The existing identity gate has a workflow-declared condition. The executor evaluates it from canonical, schema-validated inputs: `name-resolved` requires the command-settled operator gate; supplied-EID machine verification makes that gate inapplicable. This does not grant callers or the dashboard a gate-suppression input. Generic gate settlement remains command-only, and unconditional gates keep required output typing.

When a conditional gate is inapplicable, the executor records it separately in `skippedGates`. A skipped gate cannot coexist with a gate result or checkpoint for the same dependency, cannot satisfy an unconditional/required gate, and cannot count as an operator decision. Task provenance re-evaluates the condition and canonical input before accepting the skip, so an older checkpoint or human result cannot masquerade as current machine verification after a replay condition changes. Receipts render the branch as absent/nonmandatory and name no operator actor or approval.

The shared identity-check harness, full separations composition, UCPath termination and Kuali finalization descriptors carry the typed authority to their transaction and receipt boundaries. Fake-external-system composition tests cover supplied-EID continuation and name-only parking through the real executor, gate command, checkpoint, receipt and terminal paths. `dryRun=true` retains zero-write semantics. Transaction idempotency, staged-subject binding, UNKNOWN refusal and all downstream write gates are unchanged.

Dashboard code only reflects the authority already served by the workflow: name-resolved runs present the real identity ceremony; supplied-EID machine verification has no approval command. The ceremony still requires a typed EID for the name-only candidate rather than treating selection as proof. Dashboard and scenario instruction twins document the non-obvious distinction. Root, `src/dashboard`, and `tests/scenario` AGENTS/CLAUDE pairs are byte-identical.

## Ratification and compatibility

D309 is recorded in `docs/rebuild/reference/decisions.md`; `docs/rebuild/reference/write-safety.md` §14.12 owns the normative contract. The charter, workflow model, task contract, stores, operator trust, guards/tests, phase 03b, migration record and roadmap were reconciled where their current authority claims changed. Historical D77/D287 evidence remains labelled as history.

D287's extra in-workflow per-write approvals are superseded for the supplied-EID verified path. An actual `dryRun=false` operation still requires the separate operational admission and explicit authorization owned by `hr-manage` and write-safety. It does not add another workflow approval gate. D309 does not select a deletion target, waive restoration, authorize retention of a real filing or settle the filing-survival protocol.

Two immutable pre-D309 receipt fixtures remain byte-for-byte pinned at their original SHA-256 digests (`95f32251...` and `5be0737d...`). The archive/read contract still accepts those frozen bytes. Re-deriving one against the current descriptor now refuses with the named D199 `canonical-input moved` condition because D309 deliberately moved the canonical schema. The test does not rewrite historical authority, loosen fingerprint binding or silently substitute the current schema.

## Commits

| Commit | Result |
|---|---|
| `47c47666` | Implemented source-conditioned identity authority, executor/provenance/receipt support, workflow propagation, dashboard rendering, tests and instruction twins. |
| `f785a029` | Ratified D309 in the owner and pointer, reconciled current canonical docs and regenerated the roadmap site. |
| `233cde61` | Refreshed workflow fingerprints after the final identity review moved the source closure. |
| `8063fb5f` | Repaired stale composition assumptions and pinned pre-D309 receipt compatibility/refusal evidence. |
| `5931a695` | Corrected the name-only parity ceremony and deliberately refreshed reviewed parity references. |

All commits were made on `feature/03b-live-close` with explicit path staging. No push, master merge, board write or branch deletion occurred.

## Gates and causal reds

| Command / proof | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 after union/fixture propagation | verified at final source |
| `npm run lint` | exit 0, zero warnings | verified at final source |
| First `npm run test:coverage` | exit 1; 384/389 files and 4,802/4,809 tests passed; 7 stale-assumption failures across 5 files | `../evidence/r3a/test-coverage.log` |
| Focused repair set | exit 0; 5 files / 60 tests | supervisor verification before `8063fb5f` |
| **Final `npm run test:coverage`** | **exit 0; 389 files / 4,809 tests; 135.21 s; suite-size passed** | `../evidence/r3a/test-coverage-green.log` |
| Coverage | statements 85.27%; branches 76.30%; functions 89.13%; lines 87.22% | same log |
| `npm run build:manifest:check` | exit 0; generated closure current | final check |
| `npm run roadmap:check` | exit 0; generated site current | final check |
| `git diff --check` | exit 0 | final check |
| First `npm run test:parity` | exit 1; 151 reference failures: the descriptor hash moved throughout the served fixture, plus one name-only test still expected the retired radio ceremony | `../evidence/r3a/parity-assert.log` |
| Representative parity comparison | unrelated run PNG was byte-identical apart from served a11y/meta hash text; the identity-gate image showed the intended typed-EID ceremony and preserved refused-state messaging | visual supervisor review |
| `npm run test:parity:update` | exit 0; 287/287; deliberate product/reference update only after comparison | `../evidence/r3a/parity-update.log` |
| **Final `npm run test:parity`** | **exit 0; 287/287** | `../evidence/r3a/parity-assert-green.log` |

The parity commit contains one test correction and 510 reviewed reference files: 228 a11y references, 228 metadata references and 54 PNGs where the visible footer fingerprint or identity ceremony changed. It did not mask a remaining assertion failure. The original red coverage and parity logs are retained rather than replaced.

## Review

Native `sup_terra_r3a_consequential_review` returned PASS with no correctness, security, replay or provenance finding. Its focused gate passed 10 files / 97 tests and independently checked conditional re-evaluation, skipped-gate/result exclusivity, supplied-EID read-back binding, name-resolved gate necessity, receipt authority and write-path propagation. Source code did not change after that review; subsequent commits repaired stale tests/frozen evidence and parity references. The supervisor reviewed those repairs, the complete `0dd63cbc..5931a695` diff, the generated manifest/roadmap output, representative parity images and final runtime rendering.

## Restored runtime and UI proof

`npm run dashboard` remains running: BFF PID **93076** on `127.0.0.1:3938`, Vite PID **93074** on `127.0.0.1:5174`. Both returned HTTP 200. Bootstrap descriptor hash is `b20c628d09fb866ad45940e5fa824b48d72d559596deea770f000e75ef38045b`; Explorer serves separations fingerprint `ea47a1839f9d3bb89509962217203663d9e1ff422847d3abb8217723949bd417`, matching the generated manifest.

Using `playwright-cli`, the supervisor opened the exact historical route and selected **Separations** in the Workflow Panel:
`http://127.0.0.1:5174/?day=2026-09-01&run=ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`.

The route rendered 12 historical rows and the selected run. Its shape honestly showed Kuali extraction, Identity check, Job summary and Kronos timecard done, with UCPath transaction and Kuali finalization pending. Receipt rendered `Dry run`, `Partial outcome` and `No receipt`; the corresponding receipt request returned 500, so the UI did not invent a downstream receipt. The sanitized workflow-shape screenshot is `../evidence/r3a/runtime-workflow-shape.png`; structured health and click-path evidence is `../evidence/r3a/runtime-after.json`.

That 2026-09-01 run predates D309. It demonstrates useful historical workflow rendering, not the new machine-verification branch. The new branch is proved by the real composition fixtures and reviewed parity UI; a fresh submit-free runtime rehearsal remains a separate follow-on. No Start, retry, approval, deletion or worker command was issued. The owned `r3a` browser closed, `playwright-cli list` reported no browsers, and the dashboard was left running as required.

## Integration state and residue

Read-only worktree sweep found one primary checkout on `feature/03b-live-close` and no worker worktree. The temporary detached diagnostic worktree was cleaned and removed. Local branches are `feature/03b-live-close` and `master`; retain both. Owned source, test, canonical-doc and generated paths are committed. The report/evidence are the only R3a close artifacts added after implementation.

No R3a operator call remains. The earlier unresolved deletion-target/restoration-or-retention and filing-survival protocol remains under its existing decision owner; it does not weaken or block D309. R3a does not claim a controlled live write, final separation completion or criterion-5 closure.
