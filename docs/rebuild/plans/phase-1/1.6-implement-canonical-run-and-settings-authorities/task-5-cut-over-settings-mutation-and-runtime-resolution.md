# Task 5 · Cut over settings mutation and runtime resolution
<!-- roadmap: p1f-settings-consumers -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** `src/server/dashboard/compose.ts`, `src/server/worker/compose.ts`,
`src/server/dry-run-scenario/runtime.ts` (every composition reads the catalog + protected store; boot
activation from the ordinary document; the `restartRequired` / `runtimeStatus` reporting);
`src/server/dashboard/worker-supervisor.ts` (a value-free spawn environment, P20); the browser/login
credential accessors under `src/infra/browser/**` (`next-use`: read the store at each use, nothing cached);
workflow defaults; `src/domain/preflight.ts` + `src/server/preflight/**` (settings inputs by name, P16); the
settings-editor query keeps the eight-leaf inventory (A8). **Does not touch:** SQL DDL, the settings
catalog or `ConfigSchema` storage model, `RunRecordService` lifecycle operations, the kernel's run
verbs, or the Settings surface. The operator-approved plan narrowly ADMITS the strict persisted-JSON /
domain declarations and wire extensions required for a protected workflow-input binding and P16,
the start-plan composition/fingerprint/evidence consumers that must keep that binding value-free,
and a read-only storage inspector; these are not SQL schema or lifecycle changes. **Owes:** §D331.11
P16, P20, P33's composition half, P4 at composition level. **Gate:** base + the deliberate limited
Separations Start parity refreeze below + those. **Deletion test:**
`composition-reads-no-environment-leaf` — boot each composition root under a hostile `process.env`
populated for every retired key and assert byte-identical `Config`, zero accessor reads and a refusal by
key name; red while any composition still reads the environment. **Order:** fifth.

- [x] Route secure bootstrap, workers, browser/login, workflow defaults and preflight inputs through the
  catalog and the protected store; leave Settings UI behaviour to 3.1 (§D331.7, §D331.8, §D331.10).
- [x] Revision/CAS updates, validation, restart-required reporting and protected write-only input reach
  every composition; every setting resolves from exactly one catalog leaf and one persisted authority.

**Approved assignment (2026-09-05).** The operator approved this complete Task-5 assignment in the
`/phase-plan 1.6.5` session, including two feasibility corrections. First, P16 and the protected
`timekeeperName` consumer cannot be implemented while every strict JSON/domain schema and start-plan
consumer stays excluded, so the narrow declaration/readback/fingerprint admission above replaces the
blanket exclusion; SQL DDL, config/catalog redesign and lifecycle operations remain excluded. Second,
the current Separations descriptor serves `Julian Zaw` through `inputRun.parser.constants`, and the
Run Start surface renders that value in twelve frozen `options`/`plan`/`result` scenes (three states ×
two themes × two viewports). Removing the protected value therefore cannot pass parity unchanged.
Only those twelve scene triples may be deliberately refrozen after their expected red result and
rendered/a11y review. The Settings references remain byte-unchanged; D331.11 P40 stays with 3.1.

**Operator amendment (2026-09-05, during 1.6.5.3).** The operator chose to hide the
timekeeper on the identity approval screen: each installation has one timekeeper who already
knows their identity. D331.6 and write-safety §14.5/§14.10 now bind approval to the retained
protected input identity instead of protected bytes or name-derived text. This admits the
identity packet, digest, refusal and display consumers required by that decision. The twelve
Start reference triples remain the planned refreeze; only directly affected identity approval
references may additionally change, after intended-red and rendered review. No unrelated
reference or Settings/Setup surface change is admitted. The prior stop condition for this exact
contract conflict is resolved; all other stop boundaries remain in force.

**Operator amendment (2026-09-05, protected test transaction references).** The operator approved
omitting transaction-key digests derived from protected canary inputs from receipts, logs,
diagnostics and dashboard/Archive output. The natural permanent key and its authoritative digest
remain private and unchanged for duplicate-write prevention, lookup and integrity validation;
setting rotation or clear/re-set must never create a new permanent transaction identity. Carry
source-aware protected bindings through test admission and retained run input. Public projections
use a closed withheld marker and existing independent run/write-intent identities, without a
value-derived substitute. This narrowly supersedes write-safety's mandatory digest presentation
for protected-source records, including historical projections; it does not alter lifecycle,
transaction identity, or authorize unrelated parity changes.

**Operator amendment (2026-09-06, generated parity provenance).** The operator approved
mechanically derived descriptor-hash updates in the 194 additional affected reference triples,
including their a11y provenance headers, metadata records and any displayed code-version hash.
The manifest truthfully changes 210 descriptor-bound triples in total: 30 Start-profile and
180 general-profile triples. Non-hash screen/a11y changes remain limited to the twelve approved
Separations Start triples and four directly affected identity-approval ceremony triples. Review
exact diffs; any other content, control or layout drift is still a stop condition. This supersedes
the earlier blanket reference-count limit only for generated code-version provenance.

**Outcome and protected-input decision.** Every dashboard, worker, dry-run, smoke and backfill
composition resolves ordinary configuration from the active document plus explicit host facts and
defaults, and reads protected values through one journal-authenticated protected-store source. No
resolver receives `process.env`; each worker receives a closed settings-value-free bootstrap environment,
performs its own secure provider bootstrap and reads the protected store at next use without caching.
The existing eight-leaf Settings editor remains A8 until 3.1.

`separations` declares `timekeeperName` as a value-free protected workflow-input binding: the server-side
descriptor carries only `input path → protected setting name`, never the value. Caller-supplied bytes for
that protected path are refused rather than compared. Start admission reads the journal-authenticated
entry once before any plan row, lifecycle identity or browser access; absent blocks by protected name and
unreadable stays unknown. The exact value is retained in canonical run input for the queued run and is
never reread by that run. Value-free binding metadata — protected name, input path and store `valueId` —
travels with the strict start-plan/run-input JSON so every canonical/start/receipt fingerprint preimage
replaces the protected bytes with that binding identity. Plan titles/subtitles, command wires, receipts,
logs, refusals and diagnostic output carry neither the exact value nor a digest derived from it. D331.6's
existing run-evidence `last4` exception remains available only where its direct-identifier evidence policy
already permits it; comparison records carry the verdict and value-free binding, not a value-derived
digest. Historical rows remain readable through an explicit value-free legacy marker and no historical
protected value or old value-derived digest is newly served. Rerun/relaunch retains the already-canonical
input; it does not read the current store again.

**Implementation sequence.** One supervisor performs these stable steps in order:

1. **1.6.5.1 — runtime authority.** Reverify this approved plan, Task-4 ancestry, clean target and
   assigned branch/worktree. Freeze the acceptance matrix below and its red controls. Compose one
   journal-authenticated protected reader only after database authority opens. Replace environment-shaped
   resolver inputs with the ordinary document and explicit `HostConfigFacts`; use the activated runtime
   snapshot/token as worker identity. Cover dashboard, worker, dry-run scenario, activity pseudonym
   backfill and the two live smoke scripts. Preserve D321 coupling and fail named rather than defaulting.
2. **1.6.5.2 — process and credential isolation.** Replace bulk environment inheritance with an
   explicit child environment containing only justified process mechanics and D324's sanctioned host-
   display channel — no catalogued ordinary, protected or provider value. Each child admits provider
   `.env` itself and reads the protected store after its database opens. Route browser/login and other
   credential consumers through next-use accessors; retain no protected cache across uses. Extend
   `secrets-single-source` with the protected `process.env` WRITE/DELETE arm and its negative control.
3. **1.6.5.3 — protected workflow input.** Add the bundle-safe value-free descriptor declaration and
   one reusable server admission adapter before the existing single ingress parse. Remove the Separations
   browser constant and filer subtitle exposure. Persist canonical input plus value-free binding identity;
   sanitize start-plan, command, run-input, receipt, evidence-obligation and served fingerprint paths.
   Preserve stored canonical input for start, rerun, retry, relaunch and omission evaluation without a
   second protected-store read. Existing workflow examples/fixtures must exercise the same server-owned
   binding rather than baking a production value into a bundle-safe descriptor.
4. **1.6.5.4 — P16 doctor/preflight.** Add a strictly read-only protected authority inspection. When
   readable, doctor and the retained `authority.health` preflight report every catalogued protected name
   and `present` only; unreadable produces the existing closed unknown/failure arm, never `present:false`.
   Serve no value, digest, `valueId`, timestamp or path beyond the configured root basename. Add D183
   dispositions for every new strict wire leaf and prove the inspector writes no file/table/metadata.
   Do not build the 3.1 Setup/preflight UI.
5. **1.6.5.5 — restart scopes, guards and authority notes.** Prove a protected apply leaves generation,
   claim token and an in-flight run byte-identical while the next accessor sees the new value. Prove an
   ordinary apply makes the next claim refuse `runtime-stale`, with the active snapshot unchanged until
   restart, and require worker composition to supply the full claim token. Land
   `composition-reads-no-environment-leaf` with separate non-retired-noise identity and per-retired-key
   refusal arms; update `guard-inventory.json`, D331 supersession notes in workflow guidance and the
   descriptor import-closure manifest. Do not create a new decision number: D331 is the ratified owner.
6. **1.6.5.6 — rendered and candidate proof.** Demonstrate the twelve affected Separations Start scenes
   red for the intended removed value, run `npm run test:parity:update`, inspect exact PNG/a11y/metadata
   diffs in both themes and viewports, and then restore full assert-mode parity. Use Playwright CLI against
   an owned synthetic/dev BFF; no live HR system. Run the focused and complete gates below, commit the
   candidate/evidence, record `awaiting independent review`, dispatch `/supervise`'s fresh read-only
   `sup_review`, fix tactical findings in this worktree and renew review until PASS. Integrate only the
   accepted candidate, rerun integration gates, record evidence/cleanup and mark only Task 5 complete.

**Operator-approved P16 proof clarification (2026-09-06).** The operator approved the narrow
SQLite reader-bookkeeping exception to the no-file-mutation acceptance clause. The observer uses the existing read-only/no-migrate SQLite mode and
secure no-follow file reads, with exact journal authentication and a second file/ancestry fence.
Missing, insecure, malformed, moving, or unsettled settings authority returns unavailable; doctor
never acquires/reaps a settings lock, creates a baseline, cleans a temporary, or settles prepare/
rollback evidence. Tests pin settings files and all filesystem metadata, database/WAL bytes and
authority metadata. For a live WAL connection, only SQLite's documented SHM read-mark bytes
100–119 are volatile reader coordination; all other SHM bytes remain pinned. These marks carry
no database content ([SQLite WAL format](https://www.sqlite.org/walformat.html#the_wal_index_header)).

**Acceptance and disproof matrix.** Production-composed tests use synthetic settings/authority roots and
canary values; scanning one helper in isolation is insufficient:

| Boundary | Required result | Forbidden effect / disproof |
|---|---|---|
| Non-retired hostile environment noise | Dashboard, worker and dry-run resolve byte-identical `Config` with zero environment accessor reads | Resolver accepts an environment object or output/provenance changes |
| Each retired environment key | Boot refuses by key before protected-store, browser or child-spawn work | Fallback, silent shadowing or a value in the refusal |
| Worker spawn with protected canary | Spawn environment contains no catalogued ordinary/protected/provider value; child opens its own authorities | Bulk parent-environment inheritance or protected publication |
| `timekeeperName` set/rotate/clear | A new plan reads once; a queued run retains its original value; clear blocks a new plan before persistence/identity minting | Cache/reread, caller override, plan row, id or browser access on blocked admission |
| Start/run/evidence sinks | Binding name/path/`valueId` replaces protected bytes in fingerprints; permitted receipt display is at most the existing D331 run-evidence transform | Exact value, value-derived digest/comparator, title/subtitle/refusal leak or setting revision in the claim token |
| Protected apply during a claim | Generation, settings epoch, full claim and in-flight record stay byte-identical; the run settles | `runtime-stale`, claim loss or in-flight mutation |
| Ordinary apply | Next `claimNext` refuses `runtime-stale`; current run/snapshot remains unchanged until restart | Old generation accepts new work or an absent claim-token arm skips validation |
| Doctor/preflight | Every readable catalog name reports presence; unreadable remains unknown; report is read-only | Value/digest/`valueId`/timestamp, expanded path or a mutated authority |
| Architecture deletion tests | Real tree passes; env-read and protected-env-write fixtures fail for their intended reason | Hand-maintained allowlist, dead walker or catalog key escaping coverage |
| Rendered Start flow | Only the approved Separations `options`/`plan`/`result` reference triples change and no protected value remains | Settings reference or unrelated DOM/copy/layout change; baseline weakening |

**Gate cadence and verification scope.** Use focused checks after each related step, including:

```text
npm run test -- --project unit tests/unit/server/settings-runtime-reader.test.ts tests/unit/worker-composition.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/dry-run-scenario-composition.test.ts tests/unit/activity-person-pseudonym-backfill.test.ts tests/unit/start-plan.test.ts tests/unit/separations-composition-wire.test.ts tests/unit/server/start-plan-omissions.test.ts tests/unit/server/bff-flow.test.ts tests/unit/storage-doctor.test.ts tests/unit/preflight.test.ts tests/unit/evidence-receipt-d82.test.ts
npm run test -- --project architecture tests/unit/architecture/composition-reads-no-environment-leaf.test.ts tests/unit/architecture/secrets-single-source.test.ts tests/unit/architecture/settings-catalog.test.ts tests/unit/architecture/runtime-environment-coverage.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/evidence-receipt.test.ts tests/unit/architecture/guard-manifest.test.ts
```

Use the current real filenames if a listed new proof is placed beside an existing owning suite; do not
drop its assertions or suite membership. Before every logical implementation commit, and again on the
exact reviewed/integrated tree, run serially:

```text
npm run typecheck
npm run lint
npm run test:coverage
npm run build:manifest:check
npm run stores:catalog:check
npm run roadmap:check
npm run test:architecture
npm run test:parity
git diff --check
```

Run `npm run build:manifest` before its check when the descriptor/base import closure changes. Coverage
uses at most four file workers and never contends with compiler/linter processes. Recheck rebuild ports
3938/5174 and preserve any other owner's listener before browser/coverage work; all state, artifacts and
browser sessions are owned/worktree-local or disposable synthetic roots. Close owned servers/sessions
and sweep only attributable orphans. No live HR login, real submit, transaction-bearing verification,
real operator `.tracker`, performance lane, Settings UI, SQL migration, push or next-task work is in scope.

Stop only for a changed prerequisite, a new SQL DDL or config/catalog-model need, a lifecycle/run-verb
change, a Settings/Setup surface expansion, a protected value/digest that another contract would require
on a wire/environment/evidence sink, parity drift beyond the admitted twelve scenes, or an actual blocker.
The strict JSON bindings, start-plan/fingerprint/evidence consumers, read-only doctor wire and limited
reference refresh above are already approved and must not be returned as the same scope question.
Tactical review fixes remain with this supervisor using focused red/green checks; a material scope or
ownership change returns to planning and behavior-changing conflict resolution requires renewed review.

**Supervisor sizing and assignment.** One serial supervisor owns the task. Runtime activation,
protected input, spawn isolation and P16 meet in the same settings reader/composition/start boundary;
two candidates could not independently satisfy the hostile-environment, value-sink and restart-scope
proofs in either merge order. The primary checkout is integration-only, so implementation uses the
planned dedicated worktree. Recheck ref/path/capacity/base immediately before creation; their absence
at planning time is expected and is not a blocker.

| Assignment | Branch | Absolute worktree | Base / start prerequisite | Owned seams and resources | Acceptance gates | Merge condition |
|---|---|---|---|---|---|---|
| `1.6.5` | `codex/phase-1-6-settings-consumers` | `/Users/julianhein/Projects/hr-worktree-settings-consumers` | The verified full approved-plan commit on local `master`, containing Task-4 completion `5849220cfcda7f87a557488f1d6b2e9bdcb9d25e`; resolve the plan commit after this section is committed, then recheck ancestry, cleanliness, ref/path absence and four-worktree capacity before creation | Task-5 composition/settings-runtime/browser-accessor/start-plan/protected-input/evidence/doctor/preflight seams, named scripts, guards, docs, tests and exact Separations Start references; synthetic private settings/authority roots and owned Playwright runtime only | Acceptance matrix; focused unit/architecture tests; typecheck, lint, complete coverage, manifest/store/roadmap checks, standalone architecture, full parity after only the admitted refreeze, diff check and manual two-theme/two-viewport inspection | Freeze the exact candidate and obtain fresh `sup_review` PASS. Against latest local `master` still containing this approved plan and Task-4 prerequisite, integrate without a behavior-changing conflict or renew review; run exact integrated-tree gates, record review/merge/gate evidence, remove only the owned worktree/ref and mark only Task 5 complete. No push. |

**Task 5 implementation verification (2026-09-06; not yet a review candidate).** Implementation is
in `codex/phase-1-6-settings-consumers` at `/Users/julianhein/Projects/hr-worktree-settings-consumers`,
based on approved plan `247cf28ff2e3315699333e89536ee36b797ee503`, retaining prerequisite
`5849220cfcda7f87a557488f1d6b2e9bdcb9d25e`. Steps 1–5 have passed their focused proofs. Step 6
has completed rendered negative controls and full gates. All reference-scope amendments are approved.
Independent review, integration and task completion remain outstanding.

| Proof | Verified evidence |
|---|---|
| Runtime and process authority, steps 1–2 | Focused runtime 142 tests; process isolation 137; protected environment guard 20. Ordinary configuration uses persisted settings and host facts; child bootstrap admits its own provider source and next-use protected reader. |
| Protected input and public sinks, step 3 | Safety 91 tests; adjacent consumers 225; retained input/binding and fingerprint checks 48. Admission, historical projection, private permanent-key stability and public digest withholding are covered by the owning start, receipt, write-proof and restart suites. |
| Read-only doctor/preflight, step 4 | Doctor and adjacent consumers 169 tests; architecture 130; exact read-only authority proof 11, including the approved SQLite SHM read-mark exception. |
| Restart and hostile environment, step 5 | Combined unit proof 101 tests and focused architecture 88. Real worker claim barriers prove protected rotation preserves the active run and full token; ordinary apply rejects the next claim as runtime-stale and a restarted runtime activates the new snapshot. Catalog-derived retired-key cases cover dashboard, worker and both dry-run boundaries. |
| Full code gates | Typecheck and lint PASS; full coverage 421 files / 5,314 tests PASS, 85.58% statements, 77.07% branches, 89.64% functions, 87.69% lines. Manifest, store-catalog and roadmap freshness PASS. Standalone architecture 77 files / 817 tests PASS. |
| Rendered negative controls | Temporary copies of the original a11y bodies, with current generated provenance, failed all four Options, four Plan and four Result comparisons specifically on the removed timekeeper control/text. Each four-case group passed after `test:parity:update`; filtered wrapper runs correctly refused to claim full required a11y evidence. Full update passed 269 cases; the final full assert-mode run passed 269 cases, including required body-backed a11y evidence. Diff check PASS. |
| Manual browser and reference scope | Playwright CLI against an owned synthetic BFF inspected all twelve Start views across both themes and viewports; no timekeeper field/name remained. Exact metadata and a11y audit found two generated descriptor-hash mappings across 210 triples; non-hash differences are the twelve Start triples plus the six inspector count changes described below. Counted pixel bounds, using the lane's existing 0.2 threshold, agree. A sole unrelated PNG with zero counted differences was restored byte-for-byte. |

**Operator amendment (2026-09-06, generated inspector totals).** After the remaining decision was
presented, the operator instructed the supervisor to complete the task. This approves the six
`explorer-transaction` reference triples displaying generated schema field totals of `107 reads /
14 writes`, formerly `103 / 13`, because admitted protected bindings add fields to the existing
contracts. These are field totals, not additional HR transactions. The allowance is limited to
those count glyphs and corresponding a11y text, alongside the already approved code-version hashes.
No further content, control, layout, Settings/Setup or transaction change is authorized.


**Task 5 candidate — awaiting independent review (2026-09-06).** Implementation commit
`599fbb895fc2f77da06b7aa35714766fa92cf748` is based on approved plan
`247cf28ff2e3315699333e89536ee36b797ee503`, retaining prerequisite
`5849220cfcda7f87a557488f1d6b2e9bdcb9d25e`. The evidence commit containing this paragraph is
the candidate review head; its only source difference from the implementation commit removes an
extra EOF blank line caught by the staged diff check in the newly added protected-journal module.
The task remains open pending fresh read-only `sup_review`, accepted fixes, integration gates and
owned-worktree cleanup. No scope decision remains open.

The implementation gate run passed typecheck, lint, full coverage (421 files / 5,314 tests;
statements/branches/functions/lines 85.58/77.08/89.64/87.69%), manifest/store/roadmap checks,
standalone architecture (77 files / 817 tests), and full assertion parity (269 tests). Two initial
four-worker coverage attempts timed out in the unchanged lifecycle-SQL guard; the isolated guard
passed both tests, and the complete two-worker run passed without changing assertions, membership,
coverage floors or deadlines. Use two workers for subsequent full coverage on this host, within
the approved maximum of four. Logs: `/tmp/hr-settings-commit-typecheck.log`,
`/tmp/hr-settings-commit-lint.log`, `/tmp/hr-settings-commit-coverage-two.log`, and
`/tmp/hr-settings-commit-{manifest,stores,roadmap,architecture,parity}.log`.

The evidence revision is validated again with the full serial gate block under the
`/tmp/hr-settings-evidence-` log prefix. Scope is exactly the original Task 5 plus its recorded
operator amendments. The 210 changed a11y/metadata pairs contain only generated provenance plus
the twelve Start removals and six approved inspector count changes; 49 PNGs change, with counted
pixel differences restricted to those removals/counts or displayed hashes. The four allowed identity
ceremony triples have no non-hash body drift. All twelve intended-red controls and manual CLI
inspections are documented above. Settings/Setup behavior, SQL DDL, live HR transactions, performance
work and Task 1.6.6 remain excluded. The temporary handoff was consumed and removed after its
remaining decision was approved and its surviving facts were recorded here. Manual servers and
browser sessions are stopped; the owned checkout stays stable for review.

**Task 5 review repairs (2026-09-06; awaiting renewed independent review).** Fresh read-only
`/root/sup_review_settings_consumers` (`sup_review`, Sol 5.6/high) returned **CHANGES REQUIRED**
on `04331f0fb0ef73f2de809653739fc202ccabb94d` (tree
`f7e70e0d539535a727542aeb113dc871e8b10baa`) against the approved base. Four findings concerned
archive raw-input hashing, archive citation integrity, settlement sibling proof/key hashing, and
rerun proof/key disclosure. Its tentative terminal-dependency concern was disproved: terminal
records hold coordinates and protected-aware output digests, not raw checkpoint outputs.

The repair candidate keeps the task open for renewed review. Archive digests
and citations bind both retained input copies using source metadata, plus the permitted frozen
projection; already-withheld diagnostic blobs cannot become indirect value comparators. Every
archive reference authenticates the retained private digest before index/detail/delete/relaunch;
historical raw digests remain readable for authentication only. Settlement fingerprinting obtains
retained bindings inside the existing authority transaction and applies them across sibling proof,
output and private-key copies. Exact durable settlement replay still compares private records.
Rerun plans retain private natural-key digests while their public schema uses the closed withheld
marker. Source metadata binds safe proof facts, warning and plan fingerprints, preview consent,
the repeat occurrence and the final atomic fence. Historical input metadata is retained rather
than resolved from current settings. No SQL DDL or lifecycle verb changed.

Focused negative controls reproduced each finding: protected raw/archive diagnostic changes,
safe-content/corrupt-reference acceptance, protected settlement proof/private-key changes, public
rerun key disclosure, preview consent and occurrence-fence context loss. Restoring the corrections
passed the combined nine-file, 151-test set, including archive/capture/retention, restart no-repeat,
source eligibility and repeat settlement. Logs use `/tmp/hr-settings-fix-`; the `*-red.log` files
record intended failures and `combined.log` the restored combined pass. Typecheck and lint passed
after correcting test-only branded types. Typecheck and lint passed staged tree
`c50b9d9a2b145b925733bf4c45cb7d8655268726`; full coverage was interrupted when the additional
lifecycle fingerprint issue below was found, and is not passing evidence. Its log is
`/tmp/hr-settings-repaired-coverage-interrupted.log`. The complete candidate gate block must be
renewed after the remaining repair; prior tree identity and outcomes are recorded in
`/tmp/hr-settings-repaired-identity.log` and matching gate logs. The prior review
findings remain pending reviewer acceptance; integration and owned cleanup remain unfinished.

The repaired reference update passed 269 cases. Compared with the reviewed candidate, all 210
a11y/metadata pairs and 31 PNG changes contain only regenerated code hashes; the a11y audit has
zero non-hash differences and counted pixels lie inside displayed hash glyphs. Against the approved
base, the total remains 210 pairs / 49 PNGs, with exactly twelve Start removals and six approved
inspector count changes. Logs: `/tmp/hr-settings-fix-parity-update.log`,
`/tmp/hr-settings-fix-parity-scope.log`, `/tmp/hr-settings-full-parity-scope.log`, and
`/tmp/hr-settings-fix-parity-counted-pixel-bounds.json`. Full assertion parity follows in the serial
gate block; no additional visual allowance was used.

**Historical archive lifecycle amendment and repair (operator-approved 2026-09-06).**
The independent reviewer confirmed that create/archive fingerprint projection was admitted by step 3,
while retaining a safe archive identity in relaunch/delete requests crossed the lifecycle identity
exclusion. The operator explicitly approved that narrow extension. D331.6 and D330.4/D330.5 now bind
canonical relaunch/delete to the safe `archiveFingerprint` already cited by Archive, instead of the
private historical content digest. First apply authenticates the retained archive before matching
that reference. The existing lifecycle journal retains its safe commitment for exact replay after
source deletion; differing references, ordinary request facts and original fences still refuse.
Create/relaunch projection applies retained bindings across raw/parsed input; archive commitments
use authenticated permitted content. Archive mismatch refusals return the safe reference. Private
archive authentication, immutable historical records, lifecycle edges, CAS and transaction boundaries
remain intact; no SQL DDL, new verb, screen or protected-digest hash fallback is admitted.

The create/archive intended-red and 76-test neighboring pass are recorded in
`/tmp/hr-settings-fix-lifecycle-input-{red,green}.log`. Historical relaunch/delete value-rotation and
archive refusal negative controls are `/tmp/hr-settings-lifecycle-{archive,refusal}-red.log`.
The restored combined lifecycle/archive/settlement/rerun set passes six files and 145 tests in
`/tmp/hr-settings-lifecycle-combined.log`, including replay after source deletion, divergence and
zero generation change on replay/refusal. Existing journal corruption and archive divergence
assertions remain intact. The temporary handoff was consumed after verifying its base, prerequisite,
owned dirty state and gate evidence; surviving facts are recorded here. Task 5 remains open for
full candidate gates, regenerated provenance, renewed independent review, integration and cleanup.

**Renewed candidate record (2026-09-06; awaiting independent review).** The commit containing this
record repairs the original four findings and the approved lifecycle identity extension against
base `247cf28ff2e3315699333e89536ee36b797ee503`, retaining prerequisite
`5849220cfcda7f87a557488f1d6b2e9bdcb9d25e`. The serial candidate gate block and exact staged-tree
identity are recorded under `/tmp/hr-settings-review-ready-` (`identity.log` plus typecheck, lint,
coverage, manifest, stores, roadmap, architecture, parity and diff logs). The full block must pass
before this candidate is committed and submitted to a fresh independent reviewer. The review
selection rule requires a fresh complete review after a lifecycle identity amendment; all prior
findings remain in the reconciliation ledger above, rather than being dropped or reset.

The latest provenance refresh passes 269 cases. Its audit against the reviewed candidate shows
210 a11y/metadata pairs, 31 PNGs, zero non-hash a11y differences, and counted pixel changes only
inside code-hash glyphs, including two representative visual inspections. Against the approved base,
scope remains 210 pairs / 49 PNGs, with twelve Start removals and six approved inspector counts only.
Evidence: `/tmp/hr-settings-lifecycle-parity-update.log`, `lifecycle-parity-scope.log`,
`lifecycle-full-parity-scope.log` and `lifecycle-parity-counted-pixel-bounds.json` under `/tmp/hr-settings-`.
Full coverage on the preceding staged tree passed 5,321 tests and exposed two capture-route fixtures
that assumed a historical raw seal equaled the new protected-aware digest. The fixtures now prove a
valid historical raw seal is accepted at the real HTTP boundary before changing only the media type;
the existing unsafe-media, error-classification and zero-byte-open assertions remain unchanged.
The three-file, 73-test neighboring set passes in `/tmp/hr-settings-capture-fixture-green.log`;
the original full-run failure is `/tmp/hr-settings-renewed-coverage.log`. No production code or
reference hash changed for this fixture correction.

All 58 attributable retained test scratch roots were rechecked for owner identity and dead process
group, then removed; `/tmp/hr-settings-scratch-cleanup.json` records the exact paths. No owned manual
browser/BFF remains. Integration, final gates, completion marking and owned branch/worktree removal
remain pending independent PASS.

**Fresh complete review and private archive correction (2026-09-06; awaiting renewed review).**
`/root/sup_review_settings_consumers_final` (`sup_review`, Sol 5.6/high) reviewed complete
base `247cf28ff2e3315699333e89536ee36b797ee503` through candidate
`da421fa95ddae2614e99853e93da672c26084db2`, tree `e72d81bf0c7749331f9d56c87e9c774aca73381a`.
It returned **CHANGES REQUIRED**: R1/R3/R4/R5 were fixed and the withdrawn terminal-dependency
concern stayed closed; R2 still allowed new protected archives' private input to change without
invalidating their safe digest. The exact-tree candidate gates passed 423 files / 5,323 tests,
77 files / 817 standalone architecture tests and 269 parity cases; all freshness and diff checks passed.

The tactical correction compares new protected archive input directly with the independently retained
run input inside one archive-repository read snapshot. Both raw and parsed copies must match; no
protected digest or current-run display fallback is introduced. Historical raw-seal authentication,
safe citations, replay, archive immutability and all lifecycle effects remain unchanged.
Nine negative controls reproduced acceptance of altered raw, parsed and both copies at index/detail,
capture resource/bytes, delete and relaunch; the restored four-file, 128-test neighboring suite passes.
Logs: `/tmp/hr-settings-private-archive-{red,green}.log`. Full gates, generated hashes, reviewer
acceptance, integration, completion recording and owned worktree/branch cleanup remain pending.

Adjacent command/repository/recovery/redaction checks pass six files / 406 tests after correcting a
fixture's independent retained input; no redaction assertion changed. Typecheck and lint pass, and
manifest/store/roadmap generation leaves their output unchanged. The full parity update passes
269 cases without changing any reference; the approved total remains twelve Start removals, six
inspector counts and generated provenance only. Evidence: `/tmp/hr-settings-private-archive-adjacent.log`,
`private-archive-{typecheck,lint,parity-update,parity-scope,full-parity-scope}.log` under `/tmp/hr-settings-`.
The serial full gate block for the correction is pinned by `/tmp/hr-settings-private-final-identity.log`
and its corresponding gate logs before commit. The same fresh complete reviewer will verify this
bounded R2 correction and neighboring regressions; requirements and lifecycle identity semantics
have not changed. The commit containing this correction remains **awaiting independent review**.

**Independent PASS and integration preparation (2026-09-06).**
`/root/sup_review_settings_consumers_final` (`sup_review`, Sol 5.6/high) returned **PASS** on
`a93ba1a5caa071a4432ba22115a1e8e36aa5b4fd`, tree `b7fc3d066110e1f7734ec8a1004ec61776545ede`.
R1–R5 are closed; the terminal-dependency concern remains withdrawn. The reviewer independently
inspected code, tests, contracts and exact-tree logs; it did not rerun write-producing gates or browser
work. Candidate gates passed 423 files / 5,332 coverage tests, 77 files / 817 standalone architecture
tests and 269 parity cases, with typecheck, lint, manifest/store/roadmap and diff checks passing.
Evidence is `/tmp/hr-settings-private-final-identity.log` and its matching gate logs.

Integration consumes clean local master `001a7ad4525ef9e42765ab3c296c4853e169e4a3`, which retains the
approved plan and Task-4 prerequisite. The only conflict joins Task-5 evidence with master's revised
Task-6 heading; both intents are preserved. D336's future settings conversion and master's D340 desktop
changes remain intact. No behavior-changing conflict resolution was needed. The exact combined tree
is verified in the owned worktree with its example-only environment; the serial gate identity/results
are `/tmp/hr-settings-integrated-identity.log` and matching gate logs. Task completion and owned
worktree/branch removal remain pending those gates and verified integration. No push or Task-6 work.

**Latest-master integration (2026-09-06).** The first combined tree was committed as
`40b3ae42a2722584f4240264573ed00dfd13f961` after all gates passed (5,332 coverage tests,
817 standalone architecture tests, 257 desktop parity cases). Before the primary checkout became
available, its owner completed D340's minimum-canvas amendment as
`3e6a7d1f7607052c407303c2357f70a6828176c7`. That clean latest master retains both required ancestors.
The follow-up merge preserves its 1024×720 desktop canvas. Source/tests/contracts merged cleanly;
only six approved narrow Separations options/plan/result PNGs conflicted. They were regenerated from
the combined code and all six visually inspected, preserving both intents without a code conflict fix.
No unrelated reference was refreshed. The focused run first failed on the old PNGs; regeneration
passed both scene tests. Its wrapper also required a body-backed accessibility case; including that
existing case gave a fully passing three-test focused run. Logs use
`/tmp/hr-settings-desktop-merge-parity-{red,update,green}.log`.

Playwright CLI against the owned synthetic fixture BFF reconfirmed all twelve Start state/theme/
viewport combinations with no protected display. Evidence is `/tmp/hr-settings-desktop-browser-inspection.log`
and `/tmp/hr-settings-desktop-{options,plan,result}-{dark,light}-{1024,1440}.png`.
The owned CLI browser and BFF were closed; the sole browser console error was the fixture's absent
favicon. No live system or real submit was used. The next full serial gate block is bound by
`/tmp/hr-settings-integrated-final-identity.log` and matching logs before the merge commit.
Review remains PASS for the unchanged settings implementation; no behavior-changing conflict fix
was made. Task completion and owned branch/worktree removal remain pending final integration.

The first latest-master gate block passed typecheck, lint, 5,332 coverage tests, generated checks and
817 architecture tests, then full parity exposed twelve additional narrow-view PNGs whose newly
visible code-version labels still showed master's previous descriptor hash (247 cases passed).
The operator-approved hash-only refresh covers these references. All counted differences are
140–141 pixels inside the code-hash glyph rectangle; representative light/dark results were inspected.
Only those twelve PNGs changed, with no additional a11y, metadata, layout or copy change.
The focused thirteen-test update passes; full assert-mode parity and all exact-tree commit gates
follow before integration. Evidence: `/tmp/hr-settings-desktop-hash-update.log`,
`/tmp/hr-settings-desktop-hash-pixel-bounds.json` and `/tmp/hr-settings-desktop-hash-full-parity.log`.
The final accepted combined gate identity is `/tmp/hr-settings-integrated-accepted-identity.log`;
its matching gate logs supersede the preceding failed-parity block without hiding that failure.

**Task 1.6.5 complete (2026-09-06).** Steps 1.6.5.1–1.6.5.6 are accepted. Independent
`sup_review` PASS on `a93ba1a5caa071a4432ba22115a1e8e36aa5b4fd` closes R1–R5; the withdrawn
terminal-dependency concern remains closed. The reviewed settings implementation is integrated as
`5f1c6907f002c839b1af95060cdafab9415aff87`, including latest local master
`3e6a7d1f7607052c407303c2357f70a6828176c7`. The approved plan and Task-4 prerequisite remain ancestors.
The documentation-boundary resolution preserves Task-5 evidence and master's future Task-6 plan.
The six overlapping Start PNGs were regenerated and inspected to preserve both protected-value
removal and master's desktop canvas; no behavior-changing source conflict was resolved.

| Verification | Accepted evidence |
|---|---|
| Candidate | 423 files / 5,332 coverage tests; 77 files / 817 architecture tests; 269 parity cases; typecheck, lint, manifest/store/roadmap and diff PASS; `/tmp/hr-settings-private-final-*` |
| Final combined implementation | Exact staged tree and all serial gate results in `/tmp/hr-settings-integrated-accepted-identity.log` and matching logs; 5,332 coverage tests, 817 architecture tests, 259 current desktop parity cases PASS |
| Browser and parity scope | Twelve Start combinations inspected with Playwright CLI; six merge PNGs inspected; initial approved Start removals, inspector counts and provenance retained. Master's separate D340 changes are preserved, not an unrelated Task-5 refreeze. `/tmp/hr-settings-desktop-browser-inspection.log` and `desktop-merge-parity-*` logs |
| Completion record | Exact final tree and serial typecheck/lint/coverage, generated, standalone architecture, full parity and diff results in `/tmp/hr-settings-completion-identity.log` and matching logs |
| Preservation and cleanup | Master advanced to the exact gated merge tree; existing primary `.env` untouched. Owned synthetic browser/BFF closed, attributable failed-test scratch removed, owned worktree and branch removed before this completion record was applied. Browser evidence retained under `/tmp/hr-settings-final-browser-evidence`; exact scratch paths in `/tmp/hr-settings-scratch-cleanup.json`. No push. |

Only Task 1.6.5 is marked complete. Task 1.6.6 and the remainder of Phase 1.6 remain open; no live HR
login, real submit, SQL DDL, Settings/Setup work, performance lane or next-task implementation ran.
