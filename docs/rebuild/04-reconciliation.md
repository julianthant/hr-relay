# Reconciliation memo — binding cross-doc decisions (2026-07-17 through 2026-08-04)

Status: **binding revision 2026-08-04 (Round 29).** Earlier rounds remain as decision history;
Round 7 supersedes incompatible typing, UI-access, control, delegation, recovery, trust,
knowledge, and workflow-editor claims; Round 9 supersedes the proposed executor-lane/session-pool
capacity model; Round 10 supersedes D73 and ratifies isolated coexistence, one all-at-once cutover,
legacy preservation/change accounting, coverage floors, and deferred probe milestones; Round 11
moves the rebuild out of `temp_src/` into its own repository, superseding the in-tree half of D88
and amending the mechanics of D89/D90; Round 12 ratifies D94's fail-closed cross-repo accounting
mechanics.
Round 18 ratifies the remaining Phase-1f runtime/authority seams as D109–D118; Rounds 19–21 add
D119–D121 from the live lane that produced Phase 1's exit test; Rounds 22–29 add D122–D130 and
D132–D133 from the Phase-2 transaction proof, the 1i-spine live run, the UCPath receipt probe, and
the verification lanes those exposed (`D131` was never issued — see the D-series note below). Round
30 adds **D135**, which lands the Kuali write and withdraws D128; `D134` was claimed concurrently by
the 2g event/trust work in the same session. Rounds 31–34 are tail 2g, authored in three concurrent
lanes that each minted overlapping numbers and were renumbered on merge by the earliest-committed
rule (§Numbering rule below): **D136** is the parked-write resolvability fix, **D137–D139** are
diagnostic bundles / notification inbox / knowledge records, **D140–D143** are the D82 evidence
receipt, and **D144** closes the transaction-node terminal-dependency gap D140–D143 recorded. Round
35 adds **D145**, which recalibrates the parity lane's pixel allowance to the measured floor after
the uncalibrated one was caught hiding content drift *and* blocking its own repair.

> **What this doc is, as of Round 10: a decision CHANGELOG, not a specification.** Its job is to
> record *what was decided, when, and which doc owns it* — so a reader can reconstruct why a
> contract has its current shape. It is **not** where you read the current contract. The owning
> doc (D1 matrix below) is the only readable current truth, and every ratified decision must be
> folded into that doc **in the same commit that records it** (charter standing rule, added
> 2026-07-26). Round 8–29 entries are therefore deliberately one-liners with a pointer: the normative
> text lives in the owner. Rounds 1–7 predate that rule and still carry normative prose; treat
> the owning doc as authoritative wherever they differ.

Three adversarial reviews (`reviews/01-review.md`, `reviews/02-review.md`, `reviews/03-review.md`)
found that docs 01–03 describe divergent systems at their seams. This memo is the orchestrator's
binding resolution. **Every decision below overrides anything contradicting it in docs 01–03.**
Amendment agents rewrite each doc to comply; a doc may reference another doc's owned contract but
must never redefine it.

> **Implementation rule:** don't implement from this file. D1–D25 are historical rationale, not
> copyable current API/DDL; D26–D72 amend each other in round order (later wins); D73–D145 are
> pointers only. **Read the owning doc.** If an owning doc contradicts a decision here, the doc is
> either correct (it was folded) or stale (it wasn't) — check the doc's amendment date against the
> round date and fix the doc, never work from this memo. Current contract shapes live in owning
> docs 01–03 and 05–06/09–12.

## ⚠ Read before citing any `D<n>`: TWO independent D-series exist

**A bare `D22` is ambiguous, and the two `D22`s are unrelated decisions.**

| Series | Range | Lives in | Cite it as |
|---|---|---|---|
| **Reconciliation series** — the cross-doc decisions in THIS memo | `D1`–`D145` | this file | `D22` (bare) |
| **Row-model series** — three row types, eight statuses, containment, delegation shapes | `row-model D1`–`row-model D24` | doc 03 §9 (ratified 2026-07-24/25) | **`row-model D22`**, prefix mandatory |

The collision is live, not hypothetical: this memo's **D22** is the *contract-shape + guards owner
split* (doc 09 owns write-safety shapes), while doc 03's **row-model D22** is *the status vocabulary
shortens — `Verified done` renders as `Done`*. They share nothing but the number, and D126 amends
the row-model one. **Never write a row-model decision without the `row-model` prefix**, and when you
read a bare `D<n>` in a doc-03 presentation context, check which series it belongs to before acting
on it.

**Numbering rule for new decisions.** Take the next unused number in this memo's series and ratify it
into its owning doc in the SAME commit. Under concurrent authoring, two agents can mint the same
number — if you find yours already taken when you go to commit, renumber YOURS (the
earliest-committed claim keeps the number) and re-grep `docs/rebuild/`, `src/**`, and `tests/**` for
the id you are abandoning.

**Known gap: `D131` was never issued.** It was claimed and then released during the 2026-08-04
concurrent-authoring contention that produced D126–D133; the claiming work landed under a different
number. No decision text was lost — `D131` appears nowhere in this repository, and it must not be
reused, so the gap stays visible as the record of the race.

## D1 — Contract ownership matrix (one owner per concept, others reference)

| Concept | Owner |
|---|---|
| Task contract (`defineTask`), id grammar, error taxonomy, effect/dry-run mechanics, retry policy, decoration, stores, session providers, shared leaf-code homes | **Doc 01** |
| Workflow builder API (single API), descriptor shape, RunEnvelope, run-state machine incl. gates/parks, checkpoint/resume model | **Doc 02** |
| Span/event wire schema, notes stream, storage layout, isolated-runtime/import boundary, SSE wire shapes, completion (fan-out/approval) union | **Doc 03** |
| One-item workers, explicit browser-session boundaries, driver leases, queue dispatch/backpressure, page isolation | **Doc 05** |
| Canonical-field intake mapping, normalization outcomes, admission manifests, durable capture, roster/local projections, Edit Data | **Doc 06** |
| Write intents, proof/completion union, subject proof, recovery sequence, immutable ledger | **Doc 09** |
| Guard/test inventory, scenario execution lanes, non-vacuity/meta-guard | **Doc 10** |
| Clock, config/instance snapshots, fiscal dates, secrets, environment preflight, local network boundary | **Doc 11** |
| Semantic UI vocabulary/drivers, run evidence/diagnostics, scenario corpus, structured knowledge/fix records, workflow explorer/editor, base capability inventory | **Doc 12** |

Each doc gets a header table stating what it owns and what it imports from siblings.

## D2 — Task identity
`<system>/<verb-object>` slash grammar (doc 01's). One closed `SystemId` union covering browser
systems (named after the REAL `src/systems/` dirs — `new-kronos`, `old-kronos`, not `kronos`) plus
service systems (D4). Doc 02/03 examples updated (`ucpath.searchPerson` etc. are wrong).

## D3 — Client-safe contract split (resolves the bundle-fault-line collapse)
A task is split into:
- **contract** — plain data: id, zod input/output, title, effect, errorCodes, freshness (D8),
  mandatory `example` output. Lives in `temp_src/domain/contracts/<system>/` (bundle-safe, satisfies
  the "descriptors import only zod + domain" guard).
- **impl** — `run` + session needs, lives in the store (`temp_src/stores/<system>/tasks/`), imports
  the typed system-driver API. Raw Playwright imports live only in that store's driver/session
  internals. `defineTask(contract, impl)` binds them; the store is the only impl registry.
Descriptors and the dashboard import contracts only. E2e stubs derive their happy path from
`example` (schema-parsed); failure/cancel/parallel scenarios come from the registered strict
`ScenarioManifest` corpus rather than per-test ad hoc stubs
(examples cannot express them — review 02 #12).

## D4 — System-less work gets service stores
Service stores (`extraction` for file parsing, `normalization` for typed contact/address cleanup,
`roster` for matching, and `ocr` for the provider pipeline) use the same contract; `sessions: []` is legal only for service stores and pure
`workflow:<id>` mini-stores; browser stores stay type-constrained to their own system's sessions.

## D5 — Waits and operator gates are run-state, not task internals
Tasks remain run-to-completion with bounded duration. Long waits (OCR approval, child-signature
watching, external signals) are **gate nodes** declared in the descriptor and owned by doc 02's
run-state machine; doc 03's `gate.opened/resolved` events are their wire form. Kernel policy: a
parked run RELEASES its browser sessions; resume reacquires via the store session provider
(re-login is idempotent). Duo is cleared automatically by Duo Autopilot on EVERY login — production
included (operator directive 2026-07-17, charter §9): there is no phone-approval poll, pause, or
manual-MFA path anywhere in the new design. Login is always unattended and bounded.

## D6 — dryRun lives on the RunEnvelope (kernel-owned), never in workflow input. Doc 02's table is amended.

## D7 — Write-ness is derived, never re-declared (amended by D26)
`TaskStep.write` is deleted. All write gating derives from the contract's closed effect:
`read | prepare | commit`; only `commit` is an external write and it is legal only inside a
transaction node paired with `prepare`. `defineTask` uses effect-specific overloads and the runtime
factory remains the always-on backstop. Dry-run composition removes commit arms rather than asking a
task to branch on a flag.

## D8 — Checkpoint freshness (closes the stale-read→live-write hole, review 02 #2; amended by D34)
Every read contract declares default + validated field-path freshness and provenance. Checkpoints
retain per-field source observations; derived values retain the oldest contributing observation.
At resume, the kernel walks declared DAG dependencies to every commit sink. An over-age contributing
fact refuses loudly—naming checkpoint, field, source age, limit, and consuming commit—and requires a
live rerun or a contract-permitted field-scoped audited override. `Infinity` is explicit policy
metadata with adjacent justification and is illegal for identity/key/proof facts.

## D9 — Resume-model scope (explicit)
Resume covers rows with a real daemon task only (`single`, real `operation-member`). Explicitly
excluded: display-only rows (operation coordinators, i9 display-only members — nothing to resume)
and the OCR per-page pipeline (one task externally; its page pool keeps internal checkpointing,
surfaced as notes). Doc 02 fixes its schema to reality: `tasks.id` is `TEXT`, the logical key is
`(workflow, item_id)`.

## D10 — One event schema (doc 03's union, amended)
Doc 03's discriminated-union event stream is THE wire contract; doc 02 §4 becomes a reference.
Amendments to 03's schema: span identity = `(runId, attempt, spanPath)` using doc 02's readable
path-style span ids; `worker` kind and first-class `discarded`/`interrupted` outcomes kept; in-run
kernel retries = attempt-suffixed task spans, cross-run retries = `retryOf` new run; the legacy
`-N` display suffix stays display-only formatting. **Action spans move to the notes stream** (task/
run/gate spans stay in `spans/`) — preserves per-action attribution via spanPath without exploding
the span stream; timeline folds read spans only. SSE member payloads send ids + deltas, never fully
resolved nested member trees.

## D11 — Completion union re-derived from as-built code
Doc 03 §4 is rewritten against `tracker/dashboard/ocr/approve.ts` + `prepare.ts` as-built, and must
express: intent-derived child shape (operationWorkflow), `deriveItemId`, the per-document target
consuming the per-record target's actually-enqueued itemIds (ordered stages, not flat independent
targets), oath-upload's owner-consumes via a sibling born-at-upload task (`subscribeToApproval`) with
NO coordinator, and i9's prepare-route member enqueue + task-less display-only failed rows. Stay
declarative (typed staged completion program on the descriptor); if a case truly cannot be declared,
the doc says so explicitly rather than mis-modeling it.

## D12 — Lift adapter re-derived from the kernel terminal contract
Mapping enumerated from `tracked-workflow.ts` (plain `done`, `failed`-with-step, `skipped`,
`interrupted`, `superseded`, pseudo-step `<step>:failed:<err>`, approve/ocr-prep failures), not the
OCR happy path. Lift reads the visible-entries layer (deletion tombstones respected). Quarantine
(loud card), NEVER throw — including post-cutover legacy rows and invalid archetypes. No fabricated
`run.claimed`/worker spans for task-less display rows. Gates outside OCR are enumerated per
workflow (EID/identity-approval, standalone-OCR approval with no parentRunId). Pinned by replaying
real `.tracker` days through the lift asserting zero quarantines.

## D13 — The dashboard flip is SCOPED, not wholesale (operator-reviewable)
Parity gate covers queue rows + log panel + session cards + wfCounts only. Workflow modifier,
settings, mobile capture, and AI-assist proxy to the old endpoints until their explicit D58
migration milestones.
One-week legacy-dashboard fallback stays. (Review 03 sized wholesale flip at ~103 endpoints / ~122
components — an unacceptable pre-Phase-2 mega-milestone.)

## D14 — SQLite role (expanded by D21/D45/D50/D51/D59)
SQLite remains system-of-record for claims, checkpoint payloads, dependencies/manifests, commands,
write/artifact outboxes, notifications, ledger heads, and capture handoffs (NOT rebuildable/deletable);
spans/notes JSONL is the display/audit source. Doc 03's "deletable projection" claim is scoped to
projection tables only.

## D15 — Doc 01 compile-level + porting fixes (all accepted from review 01)
Builder accumulates a `Steps` type map so `decorate` can type its hooks; step mappings return
`z.input<In>` while `run` receives `z.output<In>`; `const` type parameter for `errorCodes` + a
type-level test pinning that undeclared codes fail tsc; ONE login signature
(`Promise<"logged-in" | "already-authenticated">`) with the bool adapter named as a wrapper (not
"verbatim"); OnBase exclusivity = cross-process SQLite lease from day one; the UCPath store
selectors file RE-EXPORTS `src/systems/ucpath/selectors.ts` until deletion day (kills dual-
maintenance drift; same pattern offered to other high-churn stores); `onError` hooks: the base
TaskError ALWAYS propagates, hook failures attach as secondary metadata (pinned by test); dry-run
consultation asserted at the mutation primitives (submit helpers), with legitimate no-op
completions (duplicate-hire skip) given defined semantics; `stores/common/` added for shared leaf
code (`src/systems/common/`).

## D16 — Labels and overrides: exactly two layers
Step label = descriptor `step.label`, defaulting to the contract's `title`. The ONLY override layer
is the operator presentation override (serve-time, visible in settings). Precedence stated once, in
doc 02. The worked example task (`ucpath/search-person-org`) is defined once, in doc 01 §9; doc 02
imports it verbatim.

---

## Reconciliation round 2 (2026-07-18) — write-safety skeptic (`reviews/09-review.md`)

The adversarial review of docs 09/10/11 found two blockers in write-safety and several cross-doc
seams. These decisions are binding and override anything contradicting them in 09/10 (and amend the
earlier D8/D14).

- **D17 — Crash recovery is PROBE-THEN-PARK, not always-park (amends D8 + doc 02; negative arm
  further amended by D64).** On a crash
  during a real submit, recovery re-runs the idempotency probe FIRST: `present` → backfill +
  ledger + done (no second submit); `absent` → record a negative observation for D64 settlement;
  `ambiguous`/`unknown`/throw → PARK `needs-operator`. Rationale: always-park does NOT prevent a
  double-file, it only defers everything to manual; probe-then-park recognizes typed positive proof
  and may resolve only an evidence-qualified negative sequence, while fail-closed unknown or
  unsettled evidence still honors "be very sure." D8's "crash-mid-write still parks needs-operator" clause and doc 02 §5.5 / §5.6#2 / OQ2 /
  the line-364 statement are amended to this. In the final three-effect model, doc 02's
  **transaction node** gains a required `probePolicy` (`"always" | "retries-and-recovery-only"`,
  no default — the §b migration
  question); the recovery probe is always-on regardless.
- **D18 — Same-key concurrency fence (BLOCKER fix).** `idempotency_key` gets a **partial UNIQUE /
  mutex among un-committed `write_intents`**, and beat ① MUST consult `write_intents` for an
  in-flight `attempting` row on the same key BEFORE the live-page probe. Two runs deriving the same
  key (or one after a lost lease) can no longer both fence-and-click. This is load-bearing for the
  parallel kernel (doc 05) — without it, exactly-once is false under concurrency.
- **D19 — Recovery backfill is schema-validated (BLOCKER fix).** The recovery `present`-backfill
  MUST run `completion.schema.parse` on the probe-returned receipt; a parse failure → PARK. There
  is NO path to `done` with an unvalidated receipt, recovery included.
- **D20 — Honest scope (amends doc 09 §12).** The double-**file** class is closed by the fence +
  key-mutex. The duplicate-**person** (too-early racy read) class is NOT structurally closed — it
  is mitigated by porting the race-classifiers + live verification + the (conditional, create-path)
  pending-termination sweep, and disclosed as a residual, not claimed "structurally impossible."
- **D21 — Storage owner is doc 03 (D1).** Doc 03 §2.1/§2.3 must actually add: the `ledger/` dir
  (hash-chained append-only JSONL, per-system+day, never pruned) and the `write_intents` SQLite
  table (added to the system-of-record set, amending D14's "claims + checkpoint payloads"). Doc 03
  must also DECIDE the base spans/notes retention (today an open question) so 09's "never-pruned"
  floor sits above a settled number rather than a guessed "30 days."
- **D22 — Contract-shape + guards owner split (terminology amended by D26).** Doc 09 owns the
  **commit** contract's required `writeSafety` shape: `completion` is a UNION (`receipt |
  save-verify | upload-verify`) + `idempotency`. Doc 10's
  `write-safety-contract` guard must walk that union — it must NOT demand a flat `receipt` schema
  from Kuali/OnBase (which use save-verify/upload-verify per charter §13). Doc 10 adds ratchets:
  `unverifiableByPage` requires an allowlist+reason entry, and every `effect:"commit"` impl must
  route its external action through a typed system driver operation that requires doc 12's
  `MutationCapability`; raw task-level `page.click` is impossible. The driver operation may cross
  the fence only through the kernel mutation primitive. Port fix: the "outcome unknown, refusing success" throw is in
  `clickSaveAndSubmit` (`transaction.ts:855-859`), not `waitForTransactionOutcome`.
  Doc 01 amendment (so the attachment isn't orphaned inside doc 09): doc 01 §2.2's
  `CommitTaskContract` carries the **required field** `writeSafety: WriteSafety<In, Out, Proof>`;
  doc 09 owns that shape and doc 10 guards it. There is no optional reference stub and no
  two-effect `MutateTaskContract` in the final model.

---

## Reconciliation round 3 (2026-07-18) — historical, superseded Step-0 spike

Before building the base, a throwaway type-inference PROTOTYPE (master plan §Phase 1, item 1d's
mandated first sub-task) compiled the CONTRACT / IMPL / BUILDER generics under the REAL toolchain
(TS 5.9.3 + zod 4.4.3, `strict` + `verbatimModuleSyntax` + `moduleResolution: bundler`). **Verdict:
the "coupled by contract" typing HOLDS** — all 7 load-bearing properties proven, **zero errors**,
and the green is non-vacuous by construction (each of the four `@ts-expect-error` controls suppresses
a real error — TS errors on an unused one — and every positive check uses an `any`-proof exact-`Equal`
helper). Three minimal shape refinements were required to reach the clean green; they are **binding**
and amend docs 01/02. None is a design compromise — D25 is a *correction* of an ambiguity doc 02 left
open, caught exactly as the spike was meant to.

- **D23 — `defineTaskContract` is TWO per-effect overloads (amends doc 01 §2.2).** It returns the
  EFFECT-SPECIFIC sealed contract (`SealedReadContract` / `SealedMutateContract`), never one signature
  over `ReadTaskContract | MutateTaskContract`. A union return distributes and defeats `defineTask`'s
  per-effect overload routing; the effect-specific return keeps a defined contract's static type
  effect-specific (and reinforces the fill/submit split — a read and a write are distinct types from
  birth). `const Codes` is retained on both overloads. The sealing brand is a pure intersection, so
  all four generics survive it.
- **D24 — `StepEntry` carries the conditional flag as a literal type param (amends doc 02 §3).**
  `StepEntry<C, Cond extends boolean = boolean>` — the default keeps the bare `StepEntry<C>` form
  valid everywhere it is written; the accumulator stores the LITERAL `true`/`false`. The original
  `conditional: boolean` field collapsed the flag, so `OutputsOf` could never add `| undefined` and
  the conditional-skip typing (a `when`-step's output being `T | undefined`) would be dead.
- **D25 — `.step` is a SINGLE signature with a derived `HasWhen<O>`; the two-overload form is
  REJECTED (amends doc 02 §3).** The spike proved the overload route is actively harmful: during
  overload probing TS drops contextual typing on the `bind` arrow, its return literal widens
  (discriminants collapse to `string`), the call mis-resolves to the first overload, and every
  downstream step's `outputs` is silently poisoned with spurious `| undefined`. The single signature
  `step<Id, C, O extends StepOpts<WIn,S,C>>(…): …StepEntry<C, HasWhen<O>>` keeps contextual typing
  intact. **Doc 02 must forbid reintroducing `.step` overloads.**
  - **Disclosed residual (1d must verify).** Making `probePolicy` a COMPILE error when omitted on a
    mutate step (doc 02's earlier claim) needs `StepOpts` conditional on `C`'s effect; that specific
    inference was NOT part of the Step-0 spike. 1d verifies it compiles, else enforcement falls back to
    the factory + `descriptor-coverage` guard (runtime-enforced always — fail-loud holds either way).

**Scope not covered (honest).** The spike is pure types: it did NOT exercise `.build()` runtime
wiring or runtime zod validation of `bind` returns — those get a runtime spike when 1d/1e are built.
At that time `.rebuild-spike/` was retained locally for later promotion. It was deleted in the
2026-07-21 reset because its two-effect linear surface no longer proves the Round-4 graph. Item 1e
now requires a new real-scale three-effect DAG proof rather than promoting this battery.

---

## Reconciliation round 4 (2026-07-21) — external rebuild-plan review

The prior `temp_src` skeleton and `.rebuild-spike/` were deleted. These decisions are binding and
override/amend D2–D3/D5–D8/D12–D15/D17–D25 wherever they conflict.

- **D26 — Three task effects; transaction-scoped fill/commit.** `read` observes external state;
  `prepare` mutates only an ephemeral browser page; `commit` is the sole external-write class.
  Prepare and commit are separate task contracts/spans but one workflow `transaction` node and one
  uninterrupted page/context lease. No checkpoint, park, retry, reset, or `startAt` exists between
  them. Dry-run executes prepare and has no executable commit arm or mutation capability.
- **D27 — The workflow is a typed DAG, not a linear step list.** Foundation vocabulary includes
  read, transaction, output-dependent branch, parallel fork/join, typed child-run, and typed gate
  nodes. Conditions may read declared prior outputs. Verify/onboarding/oath-upload must be expressible
  without handler-side delegation or branching. Dependencies are declared and runtime-audited;
  proxy-walking bind functions is prohibited for freshness decisions.
- **D28 — Descriptor exhaustiveness is concrete.** Doc 02's descriptor includes version/fingerprint,
  full graph, details, actions/runtime policy, presets, match/item identity, presentation, gates with
  subscriptions/resolvers, coordinator/completion-consumption, capabilities, and completion program.
  Completion/child targets retain concrete input schemas; `WorkflowRef<unknown>` and unknown derives
  are forbidden. The explicit projection coverage matrix—not the ≥3-id heuristic—is the proof.
- **D29 — Layer ownership is acyclic.** Domain defines dependency-free contracts only. Stores and
  workflow descriptors depend on domain. `core/workflow-registry.ts` is the composition root that
  imports workflows/stores. Domain never imports workflows. Dashboard consumes a validated generated/
  server projection, never workflow modules. No forward contract stub may precede its owning phase.
- **D30 — Permanent-key write intent.** `(system,idempotency_key)` is the permanent primary key across
  attempting, retryable, committed, and externally-observed-present states. Durable lookup is never
  skipped and satisfied rows are never exempt. A later pristine run reuses validated proof + typed
  output rather than fencing again. A live probe that discovers a pre-existing external transaction
  permanently blocks a click but emits no write ledger entry—the automation did not file it. The
  live prewrite probe policy may only affect a truly unseen/retryable key.
- **D31 — Every completion arm has typed proof.** Receipt, save-verify, and upload-verify each carry
  the same nontrivial `proofSchema` used for normal output and recovery-probe backfill. No optional or
  genuinely-idempotent escape hatch exists for commit contracts. `outputFromProof` also reconstructs
  and parses the full transaction-node output so recovery/preflight-present can satisfy downstream
  typed dependencies without fabricating missing fields.
- **D32 — Atomic commit outbox.** Intent commit, typed transaction-output checkpoint + proof, ledger outbox, terminal-span
  outbox, and run state commit in one SQLite transaction. Recovery reconciles all committed-intent /
  missing-outbox / unprojected permutations. Executors never append the write ledger directly.
- **D33 — Serialized, anchored ledger.** One SQLite-coordinated projector assigns per-file sequence
  and hash, preventing concurrent chain forks. SQLite ledger-head anchors make record-boundary tail
  truncation and missing files detectable. Local DB+file coordinated tampering remains out of scope.
- **D34 — Field provenance, not checkpoint freshness laundering.** Checkpoints retain per-field
  live observed times and operator correction provenance. Editing one field never refreshes untouched
  facts and never asserts current external truth. Read contracts classify output fields as live or
  derived; derived fields carry their input source set and oldest observation, so a transform cannot
  refresh stale facts. A stale corrected fact needs a live rerun or an
  explicit field-scoped, single-resume audit override. Editability is descriptor-allowlisted and
  excludes stable identity, original input, idempotency, write proof, and provenance fields.
- **D35 — Semantic resume compatibility.** Runs/checkpoints stamp descriptor version plus contract
  and implementation fingerprints. Equal output schema alone is insufficient. Resume across a
  fingerprint change requires a checked-in typed checkpoint migration or refuses loudly.
  Raw submitted input and the once-parsed canonical input snapshot are stored separately with the
  input-schema hash; resume uses the parsed snapshot and never re-applies changed defaults/transforms.
  Fingerprints come from deterministic content-hash manifests over canonical relative dependency
  closures + generated schemas/toolchain, never `Function.toString`, mtimes, or absolute paths.
- **D36 — Safe session exclusivity.** UCPath transaction acquisition drains/blocks all sibling reads
  on that PeopleSoft context; read/read sharing remains allowed. OnBase's cross-process identity
  lease covers the authenticated context lifetime and releases only after context close.
- **D37 — Per-run migration authority.** Enqueue stamps engine and cutover generation. New native
  runs can start while an enumerated legacy drain set finishes; late authorized legacy terminals are
  not quarantined. Rollback is another generation. The legacy SPA fallback reads a compatibility API
  projected from unified native/lifted state, so native runs remain visible. Legacy row/log/session
  schemas are versioned rather than frozen; a source-schema change requires version bump, lift adapter,
  and golden fixtures in the same commit, while unstamped historical data is explicit `v0`.
- **D38 — Intake reaches novel and duplicate headers.** Generic header-row candidates do not require
  known aliases. Operator selection resolves uncertainty. Mappings bind normalized header+occurrence
  column ids; duplicate reuse requires confirmation; fingerprint input is canonical structured JSON,
  not a space-joined string.
- **D39 — Guard claims are bounded honestly.** Guard inventory prevents accidental shrink. It cannot
  stop coordinated deletion of guard+inventory; removals require an explicit decision/replacement and
  code review. Before the tree exists, guard plumbing does not claim to scan it; each target family
  activates atomically with its first file and proves a non-empty scan. ESLint CLI and typed config
  coverage land together, unmatched-pattern suppression is banned, the nullish ratchet covers the
  whole non-dashboard tree, and path exemptions use exact normalized roots rather than substring
  matches. The suite also adds transaction pairing, commit capability, sequential dedupe,
  atomic-outbox, projector-concurrency, tail-anchor, provenance, and real-scale graph type fixtures.
- **D40 — Config contracts are executable.** `resolveConfig():Config` returns plain values;
  `resolveConfigWithProvenance()` returns config+source map+fingerprint. Nested schema parents have
  valid defaults and no `.url().default("")`. Production and sparse test endpoints are separate;
  settings/env test overrides cannot silently replace production. Enqueue stamps a complete resolved
  instance/config snapshot; worker-owned browser sessions are keyed by it and tasks never
  re-resolve mutable config.
- **D41 — The old spike is not ratification.** D23–D25 are historical observations about a smaller
  two-effect, three-step prototype. The new Phase-1 proof must cover three effects, transaction
  pairing, output branches, fork/join, typed child runs, typed gates/completion, and realistic graph
  scale before the production workflow builder/descriptor implementation is built.
- **D42 — Workflow mini-stores are headless-only.** D2's closed `SystemId` still owns all browser and
  service stores. Pure workflow-specific read/transform tasks may use
  `workflow:<descriptor-id>/<verb-object>`; composition-root coverage binds that namespace to a real
  descriptor. The headless store type requires `sessions:[]` and exposes no page or mutation
  capability. Every prepare/commit and every browser task remains under its owning system prefix.
- **D43 — Probe before staged-page mutation; fence immediately before commit.** A transaction binds
  and parses commit input only from workflow input plus declared upstream outputs, never prepare
  output. Durable history and any policy-required live probe run first on a separate read lease.
  The exclusive transaction lease then runs prepare; a required migration-justified
  `probeToFenceMaxMs` is checked before the permanent-key CAS fence, followed immediately by commit
  and proof on the retained page. Probe navigation therefore cannot erase staged state; an expired
  probe or lost CAS discards the page without clicking.
- **D44 — Parked writes have typed, generation-locked resolutions.** Generic Done/Retry actions do
  not apply to an unfinished write intent. Confirmed-present proof parses through the same completion
  schema and performs the same atomic intent/checkpoint/outbox/run commit. Confirmed-absent records
  operator/time/evidence and makes the same permanent intent retryable for a later CAS generation.
  `unverifiableByPage` requires a typed operator-attestation proof arm. No action deletes, voids, or
  reopens committed history.
- **D45 — Local artifacts are not hidden read mutations.** Read tasks may create only immutable
  content-addressed artifacts through a declared atomic writer. Mutable files such as i9's retention
  workbook are stable-keyed SQLite outbox projections with serialized, head-hash-checked projectors;
  a blocking sink must acknowledge before the run reports done. This retains the three task effects
  without making task retry duplicate an append.

---

## Reconciliation round 5 (2026-07-22) — whole-plan + legacy-code improvement review

These decisions answer the operator's maintainability/trust/debugging/workflow-authoring brief and
the failure modes found by rereading the old codebase. They are binding and supersede any earlier
statement that leaves these seams implicit.

- **D46 — Runtime schemas are the type authority.** Every external/durable boundary (workflow/task
  input and result, run/checkpoint, command, event/note, SSE, config, intake, artifact, evidence,
  notification, knowledge/fix) has a strict, versioned zod schema; TypeScript types are inferred
  from it. Unknown keys fail. Canonical ids/dates/instants/digests/amounts are branded. Missing,
  optional, nullable, unknown, not-applicable, and redacted are distinct—no empty-string/null/default
  collapse. Open `Record<string,unknown|JsonValue>` cannot carry decision state.
- **D47 — Semantic UI registry + typed drivers are the reusable browser-task store.** Canonical
  `ElementId`, `PageStateId`, `ScreenId`, and `ObservationId` entries own selector strategy,
  meaning, valid page states, verification date, aliases, and scenarios. Tasks receive a typed
  `SystemDriver`, never Page/Locator/selectors. Raw Playwright access is confined to driver/session
  internals. External-commit UI operations additionally require the fenced mutation capability.
  Generated `UI-CATALOG.md` is a safe projection without locator recipes and gives the operator and coding agents one vocabulary; aliases
  are explicit migrations, not duplicate names. The task store reuses business operations; the UI
  registry reuses proven element knowledge; checkpoints/mini-stores reuse typed computed facts.
- **D48 — Fresh subject binding is mandatory before every real write fence.** Prepare and commit
  contracts declare compatible expected subject + semantic observation + matcher. After prepare on
  the exact lease, the kernel re-observes the staged person/file/catalog, records a strict redacted
  `SubjectProof`, and fences only on a fresh match. Mismatch/unknown/missing/stale proof yields zero
  fence/click. The mutation capability is bound to intent generation + subject-proof digest. This
  closes stale-open-record writes; it does not claim upstream business selection is correct.
- **D49 — One command protocol owns enqueue and queue-row operations.** Dashboard, CLI, gates,
  recovery, and editor issue durable idempotent CAS commands. Descriptors choose closed enqueue and
  action policies. Cancel resolves authoritative SQLite dependency targets and fails closed—never
  caller-visible root fallback. Active-run lookup failure cannot degrade to enqueue. Retry preserves
  immutable input/config and creates linked run history; bump changes scheduling only. The UI says
  Hide/Unhide for reversible presentation tombstones. Physical purge is an offline exact-id command
  requiring a verified backup and a purge receipt; workflows own no row mutation handlers.
- **D50 — Delegation is a typed atomic graph contract.** `WorkflowRef` carries strict input and
  successful result schemas. Every child edge declares stable edge/item identity, cardinality,
  await/join, failure, cancellation, child-retry/parent-resume, and visibility policies. Parent,
  children, dependencies, and immutable fan-out manifest commit atomically. Replay reuses the
  manifest; separate edges never join via a broad “all children under parentRunId” query. The
  kernel implements control semantics; workflows only choose policies and bind typed inputs/results.
- **D51 — Non-rebuildable SQLite authority has a recovery contract.** WAL/foreign-key/full-sync
  authority transactions, boot quick-check + invariant queries, checksummed online backups,
  retention, read-only degraded mode, `storage doctor`, exact-backup atomic restore, and an automated
  restore drill are Phase-1 requirements. JSONL rebuilds projection tables only and may never invent
  lost claims/dependencies/checkpoints/write intents/outboxes/commands. Post-backup uncertain writes
  park behind recovery probes.
- **D52 — Trust is a first-class output.** Structured `FailureRecord`s, redacted automatic diagnostic
  bundles, terminal `RunEvidenceReceipt`s, and `cli explain run` link input/config/graph/schema
  fingerprints, node outcomes, provenance, UI actions/page states, screenshots/artifacts, subject
  proofs, exclusions, write proofs, and confidence. `done` requires mandatory evidence and no
  unresolved write/subject/storage condition. Notifications are durable deduped inbox records;
  desktop delivery is best-effort and cannot be the only alert.
- **D53 — Behavioral scenarios are maintained product data.** Task/workflow/UI contracts reference
  checked-in strict `ScenarioManifest`s covering happy, no-match/empty, schema failure, transient/
  permanent failure, branch/gate/delegation/control, subject mismatch, proof/crash, and discovered
  real-world variants as applicable. Examples seed only the minimal happy path. Every production
  bug fix links a regression scenario; orphaned, stale, or referenced-but-unexecuted scenarios fail
  guards. This is how workflows improve as new cases appear without silent catch-all fallbacks.
- **D54 — Chronological lessons are not active architecture authority.** Port only verified current
  rules into scoped, statused, evidence-linked `KnowledgeRecord`s with validity/supersession. Every
  Codex/Claude-assisted fix creates a `FixRecord` linking failure, changed contract/UI ids, scenario,
  verification, and commit. Existing LESSONS/CLAUDE lessons are triaged into active/superseded/
  historical—not bulk-copied—and duplicate active rules are rejected.
- **D55 — Workflow tooling is staged hybrid, not graph-as-code fantasy.** Phase 1 ships a read-only
  Workflow Explorer generated from descriptors/tasks/UI ids/scenarios/evidence, with exact source
  links and run replay/explanation. Phase 2 may add constrained edits for presentation, safe closed
  policies, and typed task-node composition. Source-authored workflows receive patch scaffolds only;
  a workflow converted to DSL-authoring has exactly one versioned strict definition and deterministic
  generated descriptor. Every applicable edit compiles/validates/diffs/version-bumps before restart-
  gated atomic apply/rollback. Arbitrary TypeScript, selectors, driver code, proof rules, and schema
  semantics stay code-reviewed. Generated design-intent briefs remain projections, never hand-edited authority.
- **D56 — Local-only scope is deliberate (amended only by D59).** Native operator dashboard binds loopback only; Phase 1 omits
  accounts/RBAC/teams/remote sync/HA/certificates/external audit signing. Non-loopback bind fails.
  Correctness, redaction, least-retained evidence, safe file permissions, backups, and loopback Origin
  checks remain because the tool controls live HR systems and diagnostic artifacts may be shared.
- **D57 — Intake reruns are manifest-backed.** Mapping/validation produces an immutable
  `IntakePlanManifest` containing source artifact digest, mapping and workflow fingerprints, every
  valid row→stable item/input hash, every correction, rejection, and explicit exclusion. Coordinator,
  members, dependencies, and manifest enqueue atomically. Rerun-with-existing-data references that
  manifest and shows hash/schema diffs; it never silently reparses a changed file or newer mapping.
- **D58 — Old-code closure is capability-inventoried, not workflow-counted.** Migrating all 16
  workflow directories does not prove `src` is deletable. Phase 0 records every legacy service,
  route family, dashboard surface, CLI/ops script, exporter, code generator, and maintenance tool
  with exactly one disposition: native milestone, temporary proxy with removal milestone,
  deliberate replacement, or evidence-backed retirement. A machine-readable inventory guard fails
  on unclassified additions and before deletion on any proxy/undecided entry. This closes the old
  plan's omission of capture, AI-assist, timecard, setup/export/maintenance, and long-tail routes.
- **D59 — Mobile capture is durable intake with one explicit network exception.** The operator
  dashboard/API remains loopback-only. Only while the operator opens a capture session may a
  separately scoped phone ingress/tunnel expose the token-gated capture asset/manifest/status/
  upload/replace/delete/reorder/finalize endpoints—never queue, settings, evidence, files, or commands. Capture sessions,
  photo order/digests, expiry, finalization command, and handoff state are strict SQLite authority;
  restart resumes them. A stable outbox converges bundle publication and one atomic authority
  transaction that records the artifact plus intake/OCR handoff, or records a retryable loud
  failure; it never returns final success then silently loses `onFinalize` work.
- **D60 — AI help is advisory and schema-bounded.** Shared provider/rate-limit infrastructure may
  serve OCR, contact normalization, and optional operator-requested triage/sanity/selector/run
  summaries. Every result is strict-schema, source/provenance-labelled, redacted before third-party
  submission, and explicitly `advisory-produced|unavailable|invalid-response`; it cannot change authority, resolve a gate,
  mark success, choose identity, invent a selector, or authorize a write. Deterministic receipts,
  scenarios, UI catalog, and validators remain authoritative when the pool is absent/exhausted.
- **D61 — Shared timecard logic is split at the right boundary.** Calendar/range/year resolution
  becomes Clock-injected pure domain code. Current/previous-period orchestration uses a semantic
  timecard-driver interface in `stores/common/`, while Old/New Kronos own their page-state/UI
  implementations. Raw `Page`, optional `new Date()` defaults, fixed sleeps, and `null`-as-navigation-
  failure do not port. The date-window and positive period-switch scenarios are shared once.
- **D62 — Parsed input is immutable but still validated on every authority read.** Enqueue applies
  ingress defaults/transforms exactly once, then stores canonical `z.output` plus its hash. Every
  later DB/resume read parses those bytes through a separate strict canonical-input schema that
  performs validation only; it never reapplies ingress defaults/transforms and never trusts a cast.
  Descriptor construction must prove ingress-output → canonical-schema round-trip. Changed
  canonical semantics require an explicit input-snapshot migration or a loud refusal.
- **D63 — Non-browser provider I/O is capability-injected and budgeted.** OCR/model/geocoder and
  other remote service calls may not hide behind imports in a service task. Contracts declare a
  closed provider-capability set; `ServiceTaskCtx` exposes only those injected clients. Calls are
  abortable, timeout/rate/concurrency-budgeted, redacted, and action-evidenced, with strict
  produced/unavailable/invalid outcomes. Direct SDK/network imports outside the registered infra
  adapters fail a guard. Provider budgets participate in scheduler admission even though they use
  no browser page.
- **D64 — A post-fence `absent` is not retry authority by itself.** A recovery probe's negative arm
  carries typed evidence and is accepted only by the commit contract's system-specific recovery-
  absence policy: a bounded propagation window plus the required number/source of consistent
  observations, or `operator-only` when safe negative proof cannot be earned. A bare/single early
  absence becomes `unknown` and parks; it never marks an intent retryable. The enforceable claim is
  **at most one unattended commit attempt per intent generation, with automatic convergence only
  when positive or stabilized negative evidence is valid**—not unconditional distributed
  exactly-once against systems that expose no idempotent API/authoritative negative read.
- **D65 — Every commit fences on a binding proof, including explicitly unscoped writes.** The
  write-bound proof is a strict union: a matched person/artifact subject proof, or an allowlisted
  `unscoped` proof containing the reviewed reason, exact page state, run/attempt/lease/task, and
  observation time. `subject.kind:"none"` does not fabricate expected/observed identities and is
  legal for a commit only when no stronger business subject exists. The mutation capability and
  ledger bind to the resulting `bindingProofDigest`.
- **D66 — Column mappings bind target fields, not canonical concepts.** A saved mapping keys each
  binding by the intake projection's stable target-field id/path and records the canonical field id
  it uses. This permits two target fields with the same canonical concept (for example home and
  mailing city), survives source-column reordering, and makes projection changes fingerprint-
  visible. Keying only by `CanonicalFieldId` is retired.
- **D67 — The command protocol is a family, not a run-action-shaped partial union.** One idempotent
  command envelope has strict target-specific arms for run controls/Edit Data/write resolution,
  typed gate resolution, notification lifecycle, and capture-session mutations. Each arm owns a
  version/CAS token and schema-parsed payload; adding a UI mutation without an arm fails coverage.
  Gate result payloads live in SQLite/checkpoints under their declared result schema; span events
  carry only a validated resolution key plus payload hash/ref, never a free-form string as control
  state.
- **D68 — Runtime dependency coverage is exhaustive, not illustrative.** Phase 1 inventories every
  browser system endpoint map, current secret/credential/provider key, optional feature dependency,
  and legacy env/config name. The config and secret registries cover both directions: every declared
  browser system/provider has the required endpoint/credential/preflight entries, and every runtime
  read is registered or explicitly retired/proxied in D58. Examples in doc 11 are excerpts, never
  permission to omit ServiceNow, SharePoint, Old Kronos, capture tooling, or provider credentials.

## Reconciliation round 7 (2026-07-22) — executable feasibility and real gate baseline

The completed whole-plan reread was followed by repository gates plus disposable compile/runtime/
SQLite spikes under the actual Node 26 + TypeScript 5.9 + Zod 4 toolchain. These decisions bind the
implementation plan to what the tools proved and close the failures the experiments exposed.

- **D69 — Every negative observation counted toward post-write settlement is post-propagation.**
  `now >= fencedAt + minSinceFenceMs` is not enough if an observation in the candidate sequence was
  captured earlier. The recovery scheduler sets the first eligible probe's `not_before` to the end
  of the propagation window; the settlement validator independently rejects every observation with
  `observedAt < fencedAt + minSinceFenceMs`. Only the configured 2–3 post-window, sufficiently
  separated, same-key/same-authoritative-state observations count. Pre-window evidence remains in
  diagnostics but contributes zero votes. This was a real failing adversarial spike, not a prose
  preference.
- **D70 — New-tree gates are zero-debt even while legacy lint debt is explicit and shrink-only.**
  The 2026-07-22 baseline passed typecheck, unit/serial tests, 137 architecture tests, and dashboard
  build, but `npm run lint` had 2 errors + 1 warning and `npm run lint:tests` had 1,325 errors + 2
  warnings. Phase 1 may not pretend those commands were green or weaken rules to make them green.
  Before the first `temp_src` production leaf, the small source-lint baseline is repaired without
  suppressions. New code/tests use non-vacuous `lint:rebuild`/`lint:rebuild-tests` commands with
  zero warnings from their first file. Pre-existing test lint diagnostics enter a reviewed,
  machine-generated shrink-only manifest keyed by file/rule/message/start+end-column/source-line
  hash; a new or replaced diagnostic fails even if the total count is unchanged. Untouched debt may
  remain or shrink through cutover. A touched legacy test file must not retain newly introduced or
  changed diagnostics; the manifest is deleted only in a separately authorized legacy-test
  retirement after it reaches zero.
- **D71 — Phase-0 spikes prove feasibility, not correctness, and must become Phase-1 tests.** The
  disposable experiment compiled a 40-node typed chain plus effect overloads/provider narrowing/
  child-result negatives in 0.68s (`tsc --extendedDiagnostics`, about 212 MB), and runtime-tested
  canonical-input transforms, strict commands, mapping collisions, proof unions, and recovery
  settlement. It also proved permanent SQLite keys, atomic intent+outbox commit, foreign keys, and
  `node:sqlite` online backup/read-only integrity. These results remove obvious toolchain blockers
  but are not shipped code and do not satisfy Phase 1. Each positive and `@ts-expect-error` negative
  becomes a committed test beside the real API before that API lands; the representative real DAG
  remains the acceptance test because a simplified chain cannot prove the final builder.
- **D72 — The authority DB owner preserves native online-backup capability without leaking raw DB
  handles.** The current compatibility wrapper erases the `DatabaseSync` required by
  `node:sqlite.backup`; the rebuild does not copy that limitation. One infra-owned
  `AuthorityDatabase` retains the private native handle and exposes narrow transaction/query/
  `backupToTemp` operations. Consumers never receive `DatabaseSync`. Backup is single-flight and
  async. A singleton `authority_meta` generation increments exactly once in every committed outer
  authority-mutating transaction and not for projection-only work, with table-class coverage tests.
  Verification opens the completed backup read-only and derives its schema version,
  page count, `authority_generation`, and integrity result from the backup itself—not from a racy
  pre/post read of the live DB—before hashing/fsync/rename and writing the manifest. File-copy and
  `VACUUM INTO` fallbacks are forbidden while WAL writers are active.

## Reconciliation round 8 (2026-07-23 → 2026-07-26) — operator ratifications, folded

Answers given by the operator in the 2026-07-23 and 2026-07-24 review sessions (recorded in
`reviews/second-look-2026-07-22.md` §6.5/§6.6) plus the 2026-07-26 migration-order answer. They
had sat in the review file while docs 00/07/09 still specified the world they replaced; this round
records them and the same commit folds each into its owner. **One line each — read the owner.**

| # | Decision | Owner (normative text) |
|---|---|---|
| **D73** | **PAUSE-UNTIL-DONE.** Automation is paused for the rebuild; HR work is manual; `src` is a frozen reference from Phase-1 day one. Go-live/test/delete are operator commands, not calendar machinery. Reverses the charter's "old system keeps working throughout". | charter §Non-negotiables; doc 07 §4 |
| **D74** | **Phase 1 is a SPINE with a live exit test.** Cut to 1a–1f + the span/projection and queue-surface slices; person-lookup runs live as the exit. Trust tails, data services/capture/intake, and the explorer move behind that first live proof. | doc 07 §3 |
| **D75** | **Local-FIRST with multi-user seams** (amends D56). Four seams are load-bearing and never trimmed: actor attribution everywhere, one auth seam, credential-set-keyed sessions, per-actor inbox. RBAC/user-management/networking stay out of scope. | charter §Non-negotiables; doc 12 §7 |
| **D76** | **Build speed is the tie-breaker.** Between two correct, equally safe designs the sooner one wins; never overrides write-safety/identity/fail-loud. | charter §Non-negotiables; doc 07 §3.7 |
| **D77** | **Identity-approval gate = ALWAYS-GATE.** Manual approval on every separation, both separation types, no auto-approve-on-match. Was undesigned and deferred to order 8; now designed in Phase 0. | doc 09 §14 (gate mechanism: doc 02 §4) |
| **D78** | **Kuali `save-verify` RESOLVED — buildable** (live probe 2026-07-23, docs 4444/4453; save is UI-silent so reload read-back is mandatory). **OnBase `upload-verify` gated on the next real upload** — no probe target exists today. | doc 09 §13 |
| **D79** | **Ceremony trims ratified:** DSL graph-authoring mode trimmed; notification lifecycle slimmed to read/unread+snooze (inbox actor-keyed); commands keep version+actor wire fields everywhere but enforce CAS only where races exist; capture crash-proofing slimmed; ledger hash-chain deferred until multi-user (ledger + actor attribution stay); lightweight task tier adopted. | docs 12 §5, 03 §2.4/§2.6, 06 §5.1, 01 §2 |
| **D80** | **Versioning + archive-on-version-bump + version registry.** Version+fingerprint per descriptor, stamped per run with app version; a bump archives all prior-version runs as self-contained data (zero compat code); an app update bumps every workflow; ledger never archived; relaunch = fresh run; a bump cannot archive a non-terminal run. | charter §25; doc 03 |
| **D81** | **One projection owns every count** — Workflow Panel badges, Status Bar, Queue Panel from one server-side projection; a second count path is a guard failure. | charter §26; doc 03; guard doc 10 |
| **D82** | **Receipt acceptance test:** the operator can complete their double-check without opening UCPath (confirmation number + post-submit screenshot + identity observed at commit). | charter §27; docs 09/12 |
| **D83** | **Operator-assigned run display names** — any run is renamable; the label rides the row and the receipt, trace id preserved underneath. | doc 03 |
| **D84** | **Migration order optimizes TOTAL time-to-resume-all**, not per-workflow priority (operator 2026-07-26: every workflow costs real manual time, none dominates). Order is chosen for reuse leverage; onboarding/separations staying last is an explicit accepted trade. | doc 07 §3.3 |
| **D85** | **Testing standard:** scenario corpus as the everyday lane + structural dry-run + a typed `TestTargetRegistry` (test employees/files/sacrificial docs with usage rules) + `cli test workflow <id> --dry-run` through the real kernel + **positive no-write proof from an empty per-run write-intent ledger** (replaces screenshot-absence heuristics). Keepers from the old e2e ritual: "a workaround is a finding", double-entry ground truth, issue ledger — as kernel behavior. | doc 10 §7 |
| **D86** | **Notifications/retention/knowledge/demos:** failed·gate·parked·repeating·storage → Ping, verified-done → Inbox, pings silent; retention notes 30d / spans 30d / ledger forever / artifacts+checkpoints until purge; knowledge audits operator-triggered with a dated audit record; demos = activity report + live dry-run lane (synthetic demo mode removed). | docs 03/12 |

## Reconciliation round 9 (2026-07-30) — worker/session model, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D87** | **ONE ITEM PER WORKER; PARALLELISM IS WORKER COUNT.** Executor lanes, static per-system capacity math, cross-workflow browser pools, and their UI chips are retired. Each workflow-scoped worker owns at most one active run plus its own browser sessions; session reuse is normal and a fresh-session boundary is authored on the exact workflow node that needs it. | doc 05; production UI wiring in doc 13 §§2/5/6.7; operator-feedback review |

## Reconciliation round 10 (2026-07-31) — isolated coexistence, cutover, and testing, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D88** | **ISOLATED LEGACY COEXISTENCE; D73 IS SUPERSEDED.** Existing `src` automation remains live, runnable, maintainable, and production-authoritative throughout the rebuild. The rebuild stays in `temp_src/` with distinct commands, state, ports, locks, and browser profiles/sessions; cross-runtime imports, calls, and state access are forbidden. Verified knowledge is ported with provenance. | charter §Non-negotiables; docs 03 §5, 07 §4, 10 §3.13, 13 §0 |
| **D89** | **ONE ALL-AT-ONCE CUTOVER.** Workflow migrations prove `temp_src` capabilities but never flip production individually. At full readiness: stop legacy enqueues, drain/park/reconcile active and uncertain runs, back up both worlds, run only explicit versioned one-time imports, then atomically switch the normal launcher. Preserve `src` and legacy commands/tests as rollback code; later retirement/deletion requires separate operator authorization and capability proof. After native writes, rollback requires reconciliation/dedupe; both engines never share production authority. | charter §Migration strategy; doc 07 §§3–6; doc 13 §0 |
| **D90** | **LEGACY CHANGE ACCOUNTING, NOT A FREEZE.** Production fixes and matching legacy tests remain allowed. A Phase-1 manifest fingerprints the legacy baseline and maps every maintenance change to affected capabilities/rebuild evidence. Untouched test-lint debt may remain or shrink; new or changed diagnostics in new/touched legacy test files fail. `temp_src` source/tests are zero-debt from their first file. Legacy source/tests/projects are retained through initial cutover. | docs 07 §3.6/§4; 10 §§1.1/3.13; testing-system plan §6 |
| **D91** | **TESTING POLICY RATIFIED.** Lines/statements/functions gate at 60% globally and 80% for safety-critical rebuild code. Branches report through Phase 1 and gate at 50%/70% at Phase-2 exit. Suite size is a soft report plus phase-exit review. Legacy tests remain until a separately authorized retirement. | docs 07 Phase gates; 10 §3.14; testing-system plan §§3–8 |
| **D92** | **LIVE PROBES ARE MANDATORY AT THEIR NAMED LATER GATES, NOT PHASE-1 BLOCKERS.** UCPath receipt proof precedes the Phase-2 controlled commit that uses it; ServiceNow receipt proof and OnBase upload verification precede their order-7 migration/cutover evidence. | doc 07 §§3.8 and Phase 2; doc 09 owns proof contracts |

## Reconciliation round 11 (2026-07-31) — standalone rebuild repository, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D93** | **STANDALONE REBUILD REPOSITORY; THE IN-TREE HALF OF D88 IS SUPERSEDED; D89/D90 MECHANICS AMENDED.** The rebuild leaves `temp_src/` for its own repository (`hr-automation-rebuild`, fresh history seeded from the `feature/rebuild-phase1b` tip, which stays in the legacy repo as the pre-split record): rebuild code at plain `src/`, tests at `tests/`, config at `config/`, plan docs still at `docs/rebuild/`, and the plain `typecheck`/`lint`/`test`/`test:architecture` gate family — the `*:rebuild` script names and the "present-but-empty `temp_src` fails" semantics retire. Isolation becomes physical, so the D88 bidirectional-ban guard family and the preservation manifest's same-tree strict-normal-form scanning of changed legacy files are RETIRED; distinct state/artifact roots, ports, process locks, and browser profiles/sessions remain REQUIRED (one machine). The legacy repo stays sole production authority, live-runnable and maintainable, and is preserved wholesale as the rollback asset. D90 accounting survives cross-repo in the rebuild repo's `config/legacy-change-accounting.json`, keyed by legacy-repo commit hashes; porting stays copy-with-provenance (legacy commit hash + path). The single cutover is unchanged in substance — mechanically, the normal production launcher is repointed at the rebuild repo. Phase definitions, gates, coverage floors (D91), and probe gates (D92) are unchanged; only the ADDRESS of the rebuild moves. | charter §Non-negotiables/§Migration strategy; doc 07 §4 (primary); docs 03 §5, 10 §§1/2/3.13/5, 13 §0 |

## Reconciliation round 12 (2026-07-31) — accounting closure, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D94** | **D93 ACCOUNTING IS COMMIT-CENTRED AND FAIL-CLOSED.** F1–F4 are ratified: the guard lane resolves the legacy checkout explicitly and fails loud; mixed-root inventories use `legacy:`; the Phase-0 file set comes from `git ls-tree`; and records name affected, not merely owning, capabilities. Every ordered legacy `src`/`tests` commit/path carries parent/commit blob hashes, impact rationale, and closed rebuild-recheck evidence; exact coverage, ancestry, reviewed impact floors, and a clean legacy `src`/`tests` worktree are mandatory. Commit legacy maintenance first, then account that commit. Deletion remains forbidden through initial cutover. | docs 10 §3.13 (primary), 07 §4; doc 11 §6 cross-reference |

## Reconciliation round 13 (2026-07-31) — command-family ambiguity closure, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D95** | **RUN PRIORITY AND VERSION/ARCHIVE NEVER SHARE A `bump` ARM.** Run `bump` remains priority/claim-order only; version work is a reviewable `plan-version-bump` followed by `apply-version-bump`. Run `rename` is added with one strict bounded display-name payload, and the exhaustive start/intake/worker-browser/settings/version-archive/run/gate/notification/capture target families are ratified before routes exist. | doc 03 §§2.4/10.2–10.3 (primary); doc 07 item 1c/§7.2 |

## Reconciliation round 14 (2026-08-01) — Phase 1d seam closure, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D96** | **ONE SESSION-NEED SHAPE.** Browser tasks declare system, read/transaction access, reuse/fresh policy, and optional download/exclusive flags; effect/access mismatches fail, and OnBase alone is identity-exclusive. | docs 01/05 |
| **D97** | **ARTIFACT UUID IDENTITY IS DISTINCT FROM SHA-256 CONTENT IDENTITY.** Byte-identical puts are idempotent under the private content-addressed root; public contracts expose no path. | docs 01/03 |
| **D98** | **RUNTIME UI FACTS REQUIRE FIXTURE AND LIVE-READ-ONLY EVIDENCE.** Candidate inventory rows have neither and cannot enter runtime/catalog; singular `verified` is retired. | doc 12; guard contract doc 10 |
| **D99** | **UI VERIFICATION SCENARIOS ARE UI-OWNED.** A small strict corpus reuses canonical `ScenarioId` grammar, is globally unique with trust scenarios, and resolves registry refs without distorting Phase-1e `ScenarioManifest`. | doc 12; guard contract doc 10 |
| **D100** | **PHASE-1D PROVIDERS ARE INTERFACES + DETERMINISTIC FAKES ONLY.** Admission/budgets land in 1f; production pools/consumers land in 2h. | doc 01; guard contract doc 10 |
| **D101** | **CLOSED IDS ARE IMPORTED, NEVER REDECLARED.** Task/store/UI seams reuse existing browser-system, provider-capability, task, element, screen, state, and observation identities. | docs 01/12 |

## Reconciliation round 15 (2026-08-01) — Phase 1e delegation-vocabulary closure, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D102** | **ONE DELEGATION POLICY VOCABULARY, END TO END.** Doc 02 §3.2's `onChildFailed: fail-parent\|block-parent\|allow-partial`, `cascadeCancel: cascade\|independent`, `afterChildRetry: resume-parent\|manual-parent-resume`, and `visibility: inline\|linked\|hidden-unless-failed` are the ratified names, and the SAME shape is what the durable dependency row and fan-out manifest store — builder → manifest → dependency row → UI read one vocabulary. The shape 1c landed in `src/domain/dependencies.ts` (`failure: fail-parent\|collect\|ignore`, `retry: retry-child\|replace-child\|parent-only`, `visibility: member\|linked\|delegated`) appeared in NO owning doc and carried no arm for `block-parent`; it is REPLACED, not mapped, because a lossy translation at the enqueue boundary would silently drop a policy the operator can select. The policy is a JSON payload validated by zod rather than a SQL enum, so no authority migration version is consumed. The vocabulary lives in one leaf module (`src/domain/workflow/delegation-policy.ts`) that both the bundle-safe graph and the durable records import. | doc 02 §§1.1/3.2 (primary); doc 03 durable dependency/manifest records |

## Reconciliation round 16 (2026-08-01) — Phase 1e descriptor closure, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D103** | **A DESCRIPTOR DECLARES A MATCH KEY, NOT AN ITEM ID.** §1.1's `identity.deriveItemId` is removed: a bundle-safe descriptor cannot hash, and two independent derivations of one identity are a drift surface by construction. The kernel mints `ItemId` from `(workflowId, matchKey)` at enqueue. Fan-out `deriveItemId` (doc 03 §4.1) is unaffected — completion derives are server-side — and now returns `ItemId` on both stage kinds. | doc 02 §1.1 (primary); doc 03 §4.1 |
| **D104** | **BRANCH AND PARALLEL TARGETS ARE FORWARD REFERENCES, VALIDATED AT `build()`.** Typed `keyof S`, a case could name only a node already accumulated — i.e. upstream — so a branch could not select what runs next and the graph it described was cyclic. Targets are plain node ids; `build()` requires each to be declared and strictly downstream of its controller. | doc 02 §§1.4/3 |
| **D105** | **THE DELEGATION MANIFEST RECORDS ITS POLICY, ALL FOUR JOINS, AND A POSSIBLY-EMPTY CHILD LIST.** The 1c shape could not express what the 1e planner writes: no `policy` (so the replay authority was not the durable home of the operator's selection), no `one`/`none` join (so an awaited one-child edge and an un-awaited fan-out were unwritable), and `children.min(1)` (so doc 02 §3.2's explicit zero-child satisfied join had no record). A zod payload, so no migration version is consumed. | doc 03 §4 as-built (primary); doc 02 §3.2 |
| **D106** | **THE BUNDLE-SAFE ROOT SET IS ZOD + `src/domain/**` + THE AUDITED `src/base/**`.** The builders a descriptor calls (`flow`, `defineWorkflowDescriptor`) live in `base`, which is itself proven to import only zod + `src/domain/**`; `descriptor-coverage` walks both halves of the closure. Descriptor meta rides the spec rather than a `.meta()` builder link, which would re-open the transform surface 1e's type proof pins. | doc 02 §§1.1/1.4 |
| **D107** | **AN UNBOUND CONTRACT IS TRACKED, NEVER IMPLICIT.** Task impls bind with the workers in 1f; until then every contract a registered descriptor uses is listed in `config/pending-impl-bindings.json`, and `descriptor-coverage` fails in both directions — an unlisted unbound contract, and a listed contract a store has since bound. A missing impl is a legitimate mid-program state; an untracked one is the drift a boot-time throw would only find in production. | doc 02 §1.4 #3 (primary); doc 07 item 1f |

## Reconciliation round 17 (2026-08-02) — Phase 1f Person Lookup read fidelity

| # | Decision | Owner (normative text) |
|---|---|---|
| **D108** | **CRM PERSON LOOKUP READS STAY SOURCE-SEMANTIC AND EID-BOUND.** The record retains raw Process Stage and does not invent `updatedAt` or an unverified normalization; invitation/completion dates come from exact Onboarding History transitions, First Day of Service owns the start date, and Date Signed is not completion. Found and absent reads carry typed bindings, and requested/bound/output EIDs must agree through declared `subject-mismatch` failures. | doc 01 §9.1.1 (primary); doc 02 §8 |

## Reconciliation round 18 (2026-08-02) — Phase 1f runtime/authority closure, folded

| # | Decision | Owner (normative text) |
|---|---|---|
| **D109** | **START PLANS BIND EXACT RAW + CANONICAL INGRESS AND ARE CONSUMED ATOMICALLY WITH ENQUEUE.** | docs 02 §Phase-1f ingress; 03 §Phase-1f authority/§2.4 |
| **D110** | **PHASE 1F PERSISTS THE MINIMAL STRICT `FailureRecord` WITH DESCRIPTOR-RESOLVED EXECUTION IDENTITY AND DURABLE PRE-TERMINAL AUTHORIZATION; PHASE 2G ADDS RICH BUNDLES, RECEIPTS, EXPLAIN/SEARCH, AND PROJECTIONS OVER IT.** | docs 12 §2.1 (primary); 03 §Phase-1f authority; 07 items 1f/2g |
| **D111** | **BEAT ⑦ IS ONE CLAIM/INTENT-VALIDATED TRANSACTION INCLUDING INTENT+ATTEMPT, TRANSACTION CHECKPOINT, OUTBOXES, AND RUN TRANSITION.** | doc 09 §Phase-1f ratification/§3 (primary); doc 03 §Phase-1f authority |
| **D112** | **PHASE 1F OWNS THE GENERIC PROVIDER-ADMISSION/BUDGET CORE; PHASE 2H OWNS PRODUCTION POOLS, ADAPTERS, AND CONSUMERS.** | docs 01 §Phase-1f executor; 05 §3.1; 10 §Phase-1f guards; 07 items 1f/2h |
| **D113** | **ONE EXHAUSTIVE COMMAND KERNEL EXECUTES PHASE-1 ARMS; LATER ARMS REMAIN SCHEMA-RECOGNIZED AND RETURN TYPED `capability-unavailable` WITH ZERO SIDE EFFECTS.** | doc 03 §Phase-1f authority/§2.4 (primary); doc 10 §3.9; doc 07 item 1f |
| **D114** | **A SUCCESSFUL WORKFLOW FACTORY-DERIVES AND SEALS ONE SCHEMA-BOUND TERMINAL RESULT FROM EXACT STORED DEPENDENCIES, THEN PERSISTS IT WITH PRE-TERMINAL AUTHORIZATION, OUTBOX, AND TERMINAL TRANSITION; CHILDREN READ THAT AUTHORITY.** | doc 02 §Phase-1f ingress/§5.7 (primary); doc 03 §Phase-1f authority |
| **D115** | **THE EXECUTOR SUPPLIES A REQUIRED, NON-NO-OP TASK PROVENANCE COLLECTOR AND REFUSES DURABLE OUTPUT WHEN DECLARED PROVENANCE IS INCOMPLETE.** | doc 01 §Phase-1f executor (primary); doc 10 §Phase-1f guards |
| **D116** | **WORKER-SESSION REUSE IDENTITY INCLUDES `configFingerprint` WITH WORKER, SYSTEM, AND RESOLVED INSTANCE.** | doc 11 §4 (primary); doc 05 §Phase-1f runtime |
| **D117** | **A STANDALONE READ OWNS NAVIGATION FROM VERIFIED NEUTRAL STATE; ONLY EXPLICIT `session:"fresh"` REQUIRES A NEW CONTEXT.** | doc 02 §3.1 (primary); doc 05 §4 |
| **D118** | **AN EXPIRED CLAIM WITH AN UNFINISHED WRITE INTENT ENTERS RECOVERY BEFORE ANY ORDINARY REQUEUE.** | doc 05 §3 (primary); doc 09 §4 |

**2026-08-03 implementation-review correction (no new D-series decision):** D110/D114's durable
authorization table is added by immutable migration v8, never by amending released v7. The
authorization is cross-bound to the exact terminal version, retained claim generation, lifecycle
arm/identity, and authorization-derived timestamps in replay and recovery. Owners: docs 02
§Phase-1f ingress/§5.7 and 03 §Phase-1f authority. The follow-up guard pins the complete released
v1–v8 migration history by literal per-version digests; D112 subsequently appends v9 without
changing those bytes, and later schema work must append v10.

## Reconciliation round 19 (2026-08-03) — D112 provider budget windows

| # | Decision | Owner (normative text) |
|---|---|---|
| **D119** | **PROVIDER RATE USES FIXED UTC-MINUTE WINDOWS; DAILY REQUEST AND COST CAPS USE FIXED UTC-DAY WINDOWS; A ZERO COST CAP ADMITS ONLY AN EXACT ZERO MAXIMUM ESTIMATE AND NEVER MEANS UNLIMITED.** | doc 11 §3 (primary); docs 01 §Phase-1f executor; 05 §3.1 |

## Reconciliation round 20 (2026-08-03) — authentication proof

| # | Decision | Owner (normative text) |
|---|---|---|
| **D120** | **A BROWSER SESSION'S AUTHENTICATION IS PROVEN BY TWO INDEPENDENT CONTENT-LEVEL FACTS (A SERVER-ISSUED SESSION ARTIFACT AND THE ABSENCE OF EVERY SIGN-IN FORM), NEVER BY A URL; THE SAME VERIFIER RUNS ON EVERY LOGIN RETURN PATH AND ON THE NEUTRAL RESET.** | doc 05 §4.1 (primary); doc 10 §5 guard `authentication-proof-not-url` |

## Reconciliation round 21 (2026-08-04) — browser-bundle purity

| # | Decision | Owner (normative text) |
|---|---|---|
| **D121** | **NO MODULE THE DASHBOARD ENTRY CAN VALUE-REACH MAY STATICALLY IMPORT A NODE BUILT-IN; A CONFIG LEAF WHOSE DEFAULT ONLY EXISTS AT RUNTIME IS REQUIRED IN THE SHARED SCHEMA AND SUPPLIED BY THE SERVER RESOLVER, NEVER STUBBED OR POLYFILLED FOR THE BROWSER.** | doc 13 §8.13 (primary); doc 11 §Phase-1i-spine config-path delta; doc 10 guard `dashboard-wire-boundary` |

## Reconciliation round 22 (2026-08-04) — the Phase-2 transaction proof, dry-run half

| # | Decision | Owner (normative text) |
|---|---|---|
| **D122** | **THE PHASE-2 TRANSACTION PROOF IS THE KUALI RRSS TIMEKEEPER ANNOTATION, WHOSE COMPLETION ARM IS A RELOAD READ-BACK AND WHOSE POST-FENCE ABSENCE IS `operator-only` UNTIL A CONTROLLED COMMIT MEASURES A REAL PROPAGATION WINDOW; THE MUTATION-CAPABILITY REGISTRY LIVES IN `src/base/mutation-capability.ts` WITH ONE PERMITTED MINTING CALLER, AND A `commit` IMPLEMENTATION IS LEGAL ONLY IN A STORE DRIVER OWNER THAT VALIDATES ITS CAPABILITY BEFORE CLICKING. AN `actionId` IS NOT STABLE ACROSS WORKFLOW STEPS, SO A RUN CARRIES THE DOCUMENT NUMBER AND THE DRIVER PROVES IT FROM THE PAGE.** | doc 09 §Phase-2 transaction-proof as-built (primary); doc 07 §3.8; doc 10 guards `task-driver-boundary`, `subject-before-fence` |

## Reconciliation round 23 (2026-08-04) — the live-run presentation and liveness defects

| # | Decision | Owner (normative text) |
|---|---|---|
| **D123** | **`skipped` IS ITS OWN TIMELINE STATE, NEVER A FLAVOUR OF `cancelled`, AND A SKIPPED STEP CARRIES THE SAME CLOSED `not-run` REASON THE DURABLE RESULT RECORDS — STAMPED ON THE SPAN BY THE EXECUTOR, FOLDED VERBATIM, AND EXPLICITLY ABSENT WHEN NONE WAS RECORDED.** | doc 03 §Phase-1g/1i as-built presentation deltas (primary); docs 02 §5.5; 13 §4 |
| **D124** | **A QUEUE ROW SERVES `endedAt` IN ITS OWN RIGHT; A TERMINAL ROW DISPLAYS `endedAt − startedAt`, AN IN-FLIGHT ROW MAY NOT CARRY A TERMINAL INSTANT AT ALL, AND A TERMINAL ROW WITHOUT ONE RENDERS AN EXPLICIT UNKNOWN RATHER THAN FALLING BACK TO `now`.** | doc 03 §Phase-1g/1i as-built presentation deltas (primary); doc 13 §4 |
| **D125** | **BROWSER-SESSION ACQUISITION (OPEN + LOGIN) IS BOUNDED BY ITS OWN CONFIG LEAF `timeouts.sessionAcquireMs`, DISTINCT FROM AND MUCH SHORTER THAN `timeouts.taskMs`; EXPIRY FAILS THE LEASE LOUDLY AND NEVER RETRIES, AND A SESSION THAT LANDS AFTER THE BOUND IS POISON-CLOSED RATHER THAN REUSED.** | doc 05 §Session acquisition is bounded separately from the task (primary); doc 11 §3 config schema |

## Reconciliation round 24 (2026-08-04) — the accessible name is its own channel

| # | Decision | Owner (normative text) |
|---|---|---|
| **D126** | **TWO STATUSES MAY SHARE A VISIBLE WORD ONLY IF A NON-TEXTUAL VISIBLE CHANNEL SEPARATES THEM *AND* THEY CARRY DISTINCT ACCESSIBLE NAMES; `verifiedDone`/`doneWarnings` ARE SEPARATED BY ICON + COLOUR ON SCREEN AND BY `accessibleLabel` OFF IT, AND THE FIX IS NEVER TO LENGTHEN THE DRAWN LABEL.** This amends doc 03 **row-model D22**, whose original ground ("the sibling deliberately did not shorten"; "the word remains") was superseded by a later operator direction. | doc 03 §9 row-model D22 as amended + §Phase-1g/1i as-built presentation deltas (primary); doc 07 §Phase 1 exit criteria; doc 13 §7.1 parity corpus |

## Reconciliation round 25 (2026-08-04) — the identity-gate scope for the transaction proof

| # | Decision | Owner (normative text) |
|---|---|---|
| **D127** | **`kuali-timekeeper-annotation` TAKES NO IDENTITY-APPROVAL GATE: ITS WRONG-PERSON SAFETY IS THE MACHINE-VERIFIED SUBJECT BINDING (ZERO FENCE, ZERO CLICK ON MISMATCH / UNREADABLE / CHANGED-AFTER-PREPARE). SCOPED TO THIS WORKFLOW ONLY — NOT A WAIVER OF D77, WHICH STILL BINDS EVERY SEPARATION-CLASS WORKFLOW AND EVERY COMMIT THAT CONSUMES AN OPERATOR-APPROVED SUBJECT. THE EXEMPTION REQUIRES BOTH: THE RUN RESOLVES NO PERSON, AND THE WRITE IS NOT SEPARATION CLASS.** | doc 09 §14.8 (primary); doc 09 §14 D77 status + §Phase-2 transaction-proof as-built |

## Reconciliation round 26 (2026-08-04) — the controlled commit, and what the target taught

| # | Decision | Owner (normative text) |
|---|---|---|
| **D128** | **A FIELD BEING RENDERED AND EDITABLE IS NOT EVIDENCE THAT THE CURRENT WORKFLOW STEP CAN WRITE IT: KUALI'S SAVE SERIALIZES ONLY ITS OWN STEP'S SECTION, ANSWERS `200` WITH A `Form saved` STATUS NODE, AND PERSISTS NOTHING OF A FOREIGN-STEP FIELD. THE 2026-08-04 CONTROLLED COMMIT ON DOCS 4489/4490 THEREFORE FENCED, CLICKED, READ `absent`, AND PARKED — CORRECTLY. PHASE 2's WRITE HALF IS BLOCKED ON A TARGET AT A STEP THAT OWNS THE FIELD; `recoveryAbsence` STAYS `operator-only` BECAUSE A WRITE THAT NEVER LANDS MEASURES NO PROPAGATION WINDOW.** | doc 09 §Phase-2 controlled-commit as-built (primary); doc 07 §Phase 2 hard exit criteria; `src/stores/kuali/CLAUDE.md` |
| **D129** | **A REAL EXTERNAL WRITE IS REFUSED ON THE RUN'S OWN IMMUTABLE `envelope.dryRun`, NOT ON THE CALLER'S CLAIM ABOUT IT, AND NO NODE `dryRun` POLICY MAKES ONE LEGAL. A CLIENT-RENDERED PAGE FACT IS PROVED BY A BOUNDED WAIT FOR THAT SAME FACT, NEVER BY ONE SAMPLE AND NEVER BY WIDENING THE LOCATOR — KUALI'S DOCUMENT RECIPE IS INSTEAD NARROWED TO EXACTLY ONE LEVEL-1 HEADING WHOSE ACCESSIBLE NAME IS A DOCUMENT NUMBER.** | doc 09 §Phase-2 controlled-commit as-built (primary); doc 10 §guard arms; `src/stores/kuali/CLAUDE.md` |

## Reconciliation round 27 (2026-08-04) — the UCPath receipt probe

| # | Decision | Owner (normative text) |
|---|---|---|
| **D130** | **A UCPath `T…` TRANSACTION NUMBER IS NOT PROOF THAT THE TRANSACTION SUCCEEDED — A DENIED TRANSACTION CARRIES A WELL-FORMED ONE — SO THE `receipt` COMPLETION ARM IS THE PAIR `(transactionNumber, approvalStatus)`, READ TOGETHER OR NOT AT ALL. THE RECEIPT LIVES ON SS SMART HR'S TRANSACTION DETAIL, ADDRESSED BY THE KEYED DEEP LINK `?Action=U&UC_TRANSACT_ID=T…` (RELOAD-STABLE; THE BARE COMPONENT URL IS NOT, AND THE URL IS NEVER STATE EVIDENCE), ANCHORED ON PEOPLESOFT `RECORD_FIELD` IDS BECAUSE NO ROLE+LABEL ANCHOR EXISTS, AND READ AT PAGE SCOPE BECAUSE THAT ROUTE HAS NO CONTENT FRAME. AN UNKNOWN ID RENDERS THE ORDINARY SEARCH FORM WITH NO ERROR, SO THE READER MUST PROVE THE FIELD RESOLVED *AND* EQUALS THE REQUESTED ID. SETTLED READ-ONLY: AN ALREADY-FAILED TRANSACTION IS A BETTER WITNESS THAN A FRESH SUBMIT, SO THE AUTHORIZED WRITE WAS NOT SPENT.** | doc 09 §13.6 (primary); doc 09 §2.2 UCPath `proofSchema` + §3 UCPath completion-signal row as amended; doc 07 §3.8; `src/stores/ucpath/CLAUDE.md` |

## Reconciliation round 28 (2026-08-04) — the parity lane that could not fail

| # | Decision | Owner (normative text) |
|---|---|---|
| **D132** | **A VERIFICATION LANE THAT CANNOT FAIL IS WORSE THAN NONE, BECAUSE IT READS AS COVERAGE. THE DOC 13 §7 PARITY LANE HAD TWO SUCH HOLES: `.a11y.yml`/`.meta.json` REFERENCES WERE REWRITTEN UNCONDITIONALLY WHILE ONLY THE `.png` WAS ASSERTED (AN ACCESSIBILITY-ONLY CHANGE REWROTE 56 REFERENCES, CHANGED ZERO SCREENSHOTS, AND STAYED GREEN), AND THE LANE SERVED A PRE-BUILT `dist/dashboard` IT NEVER REBUILT. BOTH HALVES OF A REFERENCE PAIR ARE NOW **COMPARED**, A MISMATCH FAILS WITH A DIFF NAMING THE REFERENCE AND LEAVES THE STORED BYTES UNTOUCHED, A MISSING REFERENCE FAILS RATHER THAN BEING MINTED, AND ONE SWITCH (`PARITY_UPDATE=1`, i.e. `npm run test:parity:update`) DRIVES THE PIXEL AND SEMANTIC HALVES TOGETHER SO NEITHER CAN RE-FREEZE ALONE. THE LANE BUILDS THE BUNDLE ITSELF AND STAMPS IT WITH THE WORKING-TREE INPUT DIGEST AND THE EMITTED OUTPUT DIGEST; EVERY PARITY SERVER ASSERTS THAT STAMP BEFORE BINDING A PORT AND MUST DECLARE `proof: "working-tree"` OR AN EXPLICITLY REASONED `proof: "unverified"` FOR AN API-ONLY PROBE. BOTH ARMS ARE PROVEN BY NEGATIVE CONTROL AGAINST VIOLATING FIXTURES AND THROUGH THE LANE'S OWN ENTRY POINTS.** | doc 13 §7.1 (primary); doc 10 §5 item 9; `tests/unit/architecture/parity-reference-authority.test.ts` |

## Reconciliation round 29 (2026-08-04) — the config leaf that bricked every existing database

| # | Decision | Owner (normative text) |
|---|---|---|
| **D133** | **A DURABLE `config_snapshots` ROW IS EVIDENCE OF THE CONFIGURATION ONE RUN EXECUTED UNDER, SO IT IS NEVER REWRITTEN AND ITS ABSENT LEAVES ARE NEVER BACK-FILLED. THE CONFIG SCHEMA CARRIES ITS OWN APPEND-ONLY, SHA-256-PINNED GENERATION LINE (`CONFIG_SNAPSHOT_GENERATIONS`), SEPARATE FROM THE SQLITE MIGRATION CHAIN, BECAUSE ADDING A REQUIRED LEAF CHANGES NO TABLE — IT CHANGES WHAT A STORED ROW MUST CONTAIN. AN OLDER SNAPSHOT IS READ FORWARD: EXACTLY THE REGISTERED POST-BASELINE LEAVES MAY BE ABSENT, `configSnapshotAbsentLeaves` REPORTS WHICH, AND NO VALUE IS SUBSTITUTED — "THIS LEAF DID NOT EXIST AT CAPTURE" IS A DIFFERENT FACT FROM "THIS LEAF WAS SET TO 60000", AND ONLY THE FORMER IS TRUE OF A PRE-D125 RUN. READING A STORED CONFIG APPLIES NO GROUP DEFAULT AT ALL, SO A MISSING GROUP FAILS LOUD INSTEAD OF SILENTLY READING BACK AS TODAY'S POLICY; MINTING A SNAPSHOT WITH ANY CURRENT-GENERATION LEAF MISSING IS REFUSED.** | doc 11 §4.1 (primary); doc 10 §5 item 10; `tests/unit/architecture/config-snapshot-generations.test.ts` |

## Reconciliation round 30 (2026-08-04) — the Kuali write lands; the "step cannot write it" finding was wrong

| # | Decision | Owner (normative text) |
|---|---|---|
| **D135** | **THE KUALI TIMEKEEPER WRITE LANDS ON THE OPERATOR'S OWN DOCUMENTS, AND D128's "THE CURRENT STEP DOES NOT OWN THE FIELD" IS WITHDRAWN — KUALI'S OWN `ActionPage` QUERY REPORTS THAT STEP'S `sectionSettings` AS `edit` FOR THE SECTION HOLDING THE FIELD, AND THE CHECKBOX BESIDE IT BINDS INSTANTLY. TWO DEFECTS IN THIS TREE'S DRIVER HID THE WRITE. FIRST, A KUALI BUILD TEXT GADGET IS A CONTROLLED INPUT OVER LOCAL STATE THAT **DEBOUNCES** INTO THE DOCUMENT MODEL, AND ONLY THE MODEL IS SERIALIZED BY `submitDocumentV2`: MEASURED 0/8 CARRIED AT ≤600ms AND 8/8 AT ≥700ms, INDEPENDENT OF BLUR, `Tab`, OR `fill()`-VERSUS-KEYSTROKES. A SLEEP IS NOT THE BARRIER — STAGING WAITS FOR THE COMMIT ITSELF, THE ONE OBSERVABLE THE PAGE OFFERS (THE CONTROL'S REACT PROPS OBJECT IDENTITY IS REPLACED AT +723ms WHILE EVERY ATTRIBUTE, CLASS AND THE SECTION MARKUP STAY BYTE-IDENTICAL). SECOND, `commit` RETURNED AT **REQUEST** TIME, SO BEAT ⑥'s `page.reload()` CANCELLED THE IN-FLIGHT SAVE; IT NOW WAITS FOR THE **RESPONSE**. THE CLICK IS THEN PROVED ON THE WIRE — `variables.actionId` MUST BE THE STAGED ACTION AND `variables.data["QGJ63YrCom"]` (THE `formKey`, **NOT** THE DOM ID `BWmkKqx40`) MUST EQUAL THE STAGED VALUE — PLUS A PURELY NEGATIVE REFUSAL CHECK, BECAUSE GRAPHQL ANSWERS `200` FOR REFUSALS AND THE MUTATION THAT DROPPED THE FIELD ALSO ANSWERED `{"status":"Ok","validations":null}`. LANDING PROOF REMAINS THE RELOAD READ-BACK AND NOTHING MAY SUBSTITUTE FOR IT. WITH FOUR AUTHORIZED WRITE/RESTORE CYCLES MEASURED (CLICK→RESPONSE 2 459–3 036ms; SERVER AGREES ON THE FIRST ~270ms SAMPLE; RELOAD AGREES WITHIN ~3s), `recoveryAbsence` MOVES FROM `operator-only` TO `stabilized` AT `minSinceFenceMs: 30_000` / 2 READS / 5 000ms APART. A CONSEQUENCE RECORDED WITH IT: A PARKED WRITE IS UNRESOLVABLE ONCE ANY FILE IN ITS DESCRIPTOR'S 31-FILE CONTRACT CLOSURE CHANGES, SO PARKED WRITES MUST BE RESOLVED BEFORE A CONTRACT CLOSURE IS TOUCHED.** | doc 09 §Phase-2 controlled-commit as-built (primary); doc 09 §Kuali `recoveryAbsence`; doc 07 §3.8 target status; `src/stores/kuali/CLAUDE.md` |

## Reconciliation round 30 (2026-08-04) — the 2g event/trust foundation

| # | Decision | Owner (normative text) |
|---|---|---|
| **D134** | **THE ORDERED, ACTOR-ATTRIBUTED LEDGER PROJECTOR IS BUILT, AND ITS FIVE DURABLE FACTS ARE ORDERED SO EVERY CRASH WINDOW IS REPAIRABLE: LEASE `(system,date)` → RECONCILE → ASSIGN `seq` + LINE DIGEST → APPEND + `fsync` → MARK APPENDED/PROJECTED. THE SEQUENCE IS ASSIGNED BEFORE THE APPEND SO A LOST APPEND RE-DERIVES *THE SAME BYTES* FROM THE STORED OUTBOX PAYLOAD AND ITS STORED `seq` RATHER THAN COMPOSING A REPLACEMENT; A LOST MARK RE-MARKS WITHOUT RE-APPENDING. THE PARTITION COMES FROM THE ENTRY'S OWN `confirmedAt` IN UTC, NEVER FROM WALL-CLOCK NOW. DUPLICATE, GAP, OUT-OF-ORDER, MALFORMED-TAIL, DIGEST-MISMATCH, AND UNRECORDED-LINE EACH STOP THAT PARTITION WITH A CLOSED REASON AND PROJECT NOTHING FURTHER — INCLUDING VALID WAITING ENTRIES — BECAUSE CONTINUING PAST LEDGER CORRUPTION IS HOW HISTORY GETS QUIETLY RENUMBERED. `ledger/` IS NEVER PRUNED STRUCTURALLY: `pruneEventStreams` CAN ONLY SEE `spans`/`notes`, AND A RATCHET FAILS ANY MODULE THAT BOTH NAMES `ledger/` AND CALLS A DELETION PRIMITIVE. SCHEMA **v10** LANDS THE WHOLE 2g TABLE SET IN ONE RELEASED MIGRATION (DIAGNOSTIC BUNDLES + ATTACHMENTS, EVIDENCE RECEIPTS, KNOWLEDGE AND FIX RECORDS, LEDGER PARTITIONS AND PROJECTIONS, A SEARCHABLE FAILURE FINGERPRINT) SO NO LATER SLICE EDITS THE CHAIN. A DURABLE NOTIFICATION IS THE ONE AUTHORITY ROW THAT IS **UPDATED**: A REPEATED TRIGGER FOLDS INTO ITS `(actor, dedupeFingerprint)` ROW'S `count`/`lastSeenAt` BECAUSE THE FOLDED FIRINGS LEAVE NO ROWS TO DERIVE THEM FROM — AND THAT IS NOT A WEAKENED LEDGER: LEDGER ROWS CARRY ABORT-ON-DELETE TRIGGERS, A SINGLE `assigned → appended` TRANSITION, AND AN IMMUTABLE `seq`/DIGEST/PARTITION.** | doc 09 §6.1 (primary); doc 12 §Phase-2g as-built + §6.1; doc 03 §2.6; doc 10 `ledger-projector`; `tests/unit/architecture/ledger-projector.test.ts` |

## Reconciliation round 31 (2026-08-04) — a parked write must outlive an unrelated refactor

| # | Decision | Owner (normative text) |
|---|---|---|
| **D136** | **A PARKED WRITE'S RESOLVABILITY BINDS TO THE SEMANTIC SURFACE A RESOLUTION CONSUMES, NOT TO THE DESCRIPTOR'S WHOLE SOURCE CLOSURE. A PARK IS THE ONE STATE BUILT TO SURVIVE *ACROSS* TIME AND CODE CHANGE — IT WAITS FOR A HUMAN — SO EXPIRING IT ON ANY EDIT ANYWHERE IN A 31-FILE CONTRACT CLOSURE IS NOT A RECOVERY PATH; ONE UNRELATED EDIT TO `src/domain/ids.ts` PERMANENTLY STRANDED A REAL PARKED KUALI INTENT. BYTE IDENTITY OF THE CLOSURE IS *SUFFICIENT* PROOF THAT NOTHING SEMANTIC MOVED AND NOWHERE NEAR NECESSARY, SO RECOVERY (§4) AND BOTH §4.1 ARMS NOW STATE THE NECESSARY CONDITION DIRECTLY, ONE NAMED CHECK AT A TIME: `workflow-identity`, `descriptor-version`, `transaction-node`, `canonical-input`, `permanent-key-identity`, `binding-proof-identity`. THE LOAD-BEARING ONE RE-RUNS `commit.bind`, THE COMMIT CONTRACT'S `input` SCHEMA AND `idempotency.key` OVER THE EXACT DURABLE INPUT AND DEMANDS THE EXACT FENCED KEY AND DIGEST BACK — A KEY THAT RE-DERIVES DIFFERENTLY NAMES A **DIFFERENT EXTERNAL TRANSACTION**, THE ONLY DRIFT THAT COULD MAKE A RESOLUTION ACT ON THE WRONG THING. A REFUSAL PRINTS THE WHOLE CHECK TABLE — HELD ROWS INCLUDED — WITH BOTH FINGERPRINTS, THE REFUSED ARM, AND THE MOVED VALUES; `[held]`/`[MOVED]`/`[skip]` STAY DISTINCT AND AN UNEVALUATED CHECK IS NEVER REPORTED AS HELD. THERE IS **NO WAIVER, OVERRIDE, OR FORCE ARM**: WHEN A CHECK MOVES THE HONEST REPAIR IS TO RESTORE THE SEMANTICS OR RE-PLAN. A RESOLUTION RELEASES THE WRITE AND NEVER RE-PLANS THE RUN, SO DOC 02 §5.3's REPLAY BINDING AND `executeClaimedRun`'s DESCRIPTOR↔RUN CHECK ARE UNCHANGED AND JUST AS STRICT.** | doc 09 §4.1 (primary); doc 09 §Phase-2 controlled-commit as-built; `src/core/write-resolution-binding.ts`; `tests/unit/write-resolution-binding.test.ts` |

## Reconciliation round 32 (2026-08-04) — tail 2g: capture, the inbox, and knowledge records

| # | Decision | Owner (normative text) |
|---|---|---|
| **D137** | **A DIAGNOSTIC BUNDLE IS CAPTURED AT ONE OF DOC 12 §2.2's FIVE CLOSED TRIGGERS, REDACTED **AT CAPTURE** BY THE SCHEMA-OWNED POLICY THAT *DROPS* EVERY UNCLASSIFIED FIELD, AND BOUND TO ITS FAILURE ATOMICALLY. THE ORDERING IS FORCED BY THE SCHEMA, NOT CHOSEN: `diagnostic_bundles.failure_id` REFERENCES THE FAILURE ROW WHILE `FailureRecord.diagnosticBundleId` IS A FORWARD REFERENCE THE FAILURE MUST ALREADY CARRY, SO CAPTURE IS TWO PHASES — `prepare` REDACTS AND WRITES ATTACHMENTS TO THE CONTENT-ADDRESSED STORE WITH NOTHING DURABLE MOVED, THEN THE INTERPRETER TERMINALIZES THE FAILURE CARRYING THE PREPARED `bundleId` AND PERSISTS THE BUNDLE INSIDE THE SAME AUTHORITY TRANSACTION AS THE TERMINAL CAS. A SECOND LOCK REFUSES ANY BUNDLE IN WHICH A NEVER-EXPORTABLE KEY SURVIVED AS AN `allowed` VALUE, AND ONLY A SCREENSHOT MAY STAY `restricted`. RETENTION IS A BOUNDED DELETE: `purgeAfter` COMES FROM THE BUNDLE'S OWN CAPTURE INSTANT PLUS THE D86 FLOOR, THE SWEEP READS THE `(retention_kind, purge_after)` INDEX SO A PIN IS STRUCTURALLY UNREACHABLE, PURGING A PIN OR AN UNEXPIRED BUNDLE THROWS, AND ATTACHMENT ROWS GO WITH THE BUNDLE. CONTENT-ADDRESSED ARTIFACT BYTES ARE **NOT** DELETED — THEY ARE SHARED BY DIGEST — SO THE SWEEP REPORTS THE UNREFERENCED IDS AND RECLAMATION AWAITS A REFERENCE COUNT THE STORE DOES NOT KEEP. PAGE ATTACHMENTS ARRIVE THROUGH A NAMED DRIVER SEAM; ABSENT IT THE BUNDLE CARRIES STRUCTURED EVIDENCE ONLY, NEVER A FABRICATED SCREENSHOT.** | doc 12 §Phase-2g as-built D137 (primary); doc 12 §2.2; `src/services/trust/diagnostic-capture.ts`; `tests/unit/diagnostic-capture.test.ts` |
| **D138** | **A NOTIFICATION IS A DURABLE RECORD FIRST AND A DESKTOP DELIVERY SECOND, AND THAT IS AN ORDER: `publish` SETTLES CREATE-OR-FOLD IN ONE AUTHORITY TRANSACTION AND ONLY THEN ATTEMPTS OS DELIVERY, OVER A ROW AUTHORITY CAN ALREADY READ. A DELIVERY THAT THROWS IS REPORTED AND **NEVER WRITTEN BACK** — STATUS, `count`, AND `version` ARE UNTOUCHED, SO THE OPERATOR WHO MISSED THE TOAST STILL FINDS AN UNREAD ITEM — AND NO PER-ATTEMPT DELIVERY STATE IS STORED AT ALL. A MISSING CHANNEL REPORTS `no-channel`, NEVER SUCCESS. DOC 03 §2.6's EVENT LIST ROUTES ONTO D79b's SIX KEYS (FAILURE AND SUBJECT MISMATCH → `failed`; GATE → `gate-waiting`; UNKNOWN WRITE OUTCOME → `write-parked`; THRESHOLD → `repeating`; STORAGE/STALLED OUTBOX/FAILED BACKUP → `storage`; RECEIPT → `verified-done`, INBOX-ONLY). A NOTIFICATION CARRIES **NO FREE TEXT**: EVERY TRIGGER ARM IS IDS, CLOSED CODES, AND COUNTS, SO CAPTURED FORM CONTENTS HAVE NOWHERE TO ENTER. THE DEDUPE FINGERPRINT EXCLUDES THE OCCURRENCE, SO A REPEAT FOLDS INSTEAD OF SPAMMING; SNOOZE SUPPRESSES DELIVERY ONLY AND NEVER FLIPS STATUS IN EITHER DIRECTION.** | doc 03 §2.6 (primary); doc 12 §Phase-2g as-built D138 + §6; doc 10 `notification-durability`; `tests/unit/architecture/notification-durability.test.ts` |
| **D139** | **KNOWLEDGE AND FIX ADMISSION IS AUDITED *INSIDE* THE INSERT TRANSACTION, BECAUSE AN INSERT-ONLY TABLE CANNOT RETRACT A DUPLICATE. TWO ACTIVE RECORDS MAY NOT CLAIM THE SAME SCOPED RULE — IDENTICAL SCOPE PLUS THE SAME NORMALIZED TITLE OR A SHARED REGRESSION SCENARIO — UNLESS THE SUCCESSOR EXPLICITLY SUPERSEDES THE PREDECESSOR; UNKNOWN SUPERSESSION, SELF-REFERENCE, AND A DUPLICATE ID ARE EACH REFUSED WITH THE CONFLICT NAMED. **SUPERSESSION IS EXPRESSED FORWARD** AND THE ACTIVE VIEW SUBTRACTS IT, SO STALE GUIDANCE LEAVES THE GENERATED GUIDE WITHOUT ANY RECORD MUTATING AND WITHOUT THE `version` FIELD §4.3's AUDIT WOULD NEED — THAT AUDIT STILL AWAITS ITS SCHEMA DECISION AND IS NOT GUESSED HERE. THE GENERATED PER-SYSTEM `KNOWLEDGE.md` IS THE ACTIVE VIEW ALONE AND SAYS SO IN ITS HEADER. A VERIFIED `FixRecord` REQUIRES A COMMIT PLUS NON-EMPTY EVIDENCE PLUS A REGRESSION SCENARIO, A DRAFT MAY CLAIM NEITHER, AND A VERIFIED FIX MAY NOT LINK MISSING OR UNVERIFIED KNOWLEDGE. A RAW APPENDED LESSON IS NOT AUTHORITY: `triageLesson` HAS EXACTLY ONE ARM AND IT RETURNS THE OBLIGATIONS STILL OWED.** | doc 12 §Phase-2g as-built D139 (primary); doc 12 §4 + §9; doc 10 `knowledge-fix-integrity`; `tests/unit/architecture/knowledge-fix-integrity.test.ts` |

## Reconciliation round 33 (2026-08-04) — D82: the receipt completes the double-check

| # | Decision | Owner (normative text) |
|---|---|---|
| **D140** | **EVIDENCE REDACTION IS DECLARED PER FIELD, AND AN UNDECLARED LEAF FAILS LOUD RATHER THAN DROPPING.** A RECEIPT'S LEAVES COME FROM SCHEMAS THIS REPOSITORY OWNS, SO AN UNCLASSIFIED LEAF IS A MISSING DECLARATION — NOT A FREE-FORM PAYLOAD TO DISCARD WITH A WARNING. THE LEAF RULE IS THE PROVENANCE COLLECTOR'S (AN ARRAY IS A LEAF), SO EVERY FACT SHARES ONE PATH VOCABULARY WITH THE `FactProvenance` ROW THAT DATES IT. THE (CLASSIFICATION, TRANSFORM) PAIRING IS REFUSED AT DECLARATION TIME BY THE SAME TABLE THE DIAGNOSTIC WRITER USES. BUSINESS VALUES ARE `safe-diagnostic`, PERSON IDENTIFIERS ARE `direct-identifier`/`last4`, AND A LIST OF PEOPLE IS `sensitive-hr`/`count`. CROSS-SOURCE OBLIGATIONS ARE LIKEWISE DECLARED: THE RECEIPT CARRIES THE SERVER'S VERDICT AND THE FACTS IT COMPARED, SO THE OPERATOR NEVER EYEBALLS TWO REDACTED IDENTIFIERS, AND AN ABSENT SOURCE IS REPORTED ABSENT RATHER THAN SHRINKING THE COMPARISON TO ONE SIDE. | doc 12 §Phase-2g as-built (primary); doc 11 §6; `src/domain/trust/evidence-classification.ts`; `src/domain/trust/evidence-obligations.ts`; `tests/unit/architecture/evidence-receipt.test.ts` |
| **D141** | **THE RECEIPT IS A PURE FUNCTION OF AUTHORITY, DERIVED ON DEMAND AND PINNED ON FIRST DERIVATION — NOT MINTED INSIDE THE TERMINAL TRANSACTION.** AUTHORITY MUST NEVER DEPEND ON A PROJECTION TO TERMINALIZE, AND THE TWO RUNS THIS PROGRAM ALREADY PRODUCED WOULD OTHERWISE BE PERMANENTLY RECEIPT-LESS. EVERY IDENTITY FOLDS FROM THE RUN IDENTITY AND `generatedAt` IS THE TERMINAL SETTLEMENT INSTANT, SO RE-DERIVING ONE RUN YIELDS THE SAME BYTES AND THE IMMUTABLE INSERT REFUSES A DIVERGENT REBUILD BY NAME. A CONDITIONAL NODE THAT DID NOT RUN CARRIES ITS CLOSED REASON AND AN `absent`, NON-MANDATORY OBLIGATION: AN ABSENCE THE DESCRIPTOR AUTHORED AND D114 CLOSED IS A CORRECT OUTCOME, NOT AN UNRESOLVED ONE. | doc 12 §Phase-2g as-built (primary); doc 12 §2.3; `src/core/evidence-receipt.ts`; `tests/unit/evidence-receipt-d82.test.ts` |
| **D142** | **THE RUN-DETAIL FAILURE AND RECEIPT SECTIONS SERVE CONTENT, AND THE FAILURE WIRE IS A WHITELIST SCHEMA.** NAMING EVERY PROJECTED FIELD MAKES "UNCLASSIFIED FIELDS DROP" STRUCTURAL: A FIELD ADDED TO THE DURABLE `FailureRecord` LATER REACHES NO SURFACE UNTIL SOMEONE CLASSIFIES IT. THE RECEIPT SECTION SERVES THE WHOLE `RunEvidenceReceipt`, BECAUSE §2.2 PUTS REDACTION AT CAPTURE TIME AND A SECOND PROJECTION COULD ONLY LOSE THE CLASSIFICATIONS THAT MAKE A VALUE READABLE. `src/domain/redaction.ts` CONSEQUENTLY BECOMES BROWSER-REACHABLE AND DROPS ITS NODE BUILT-INS. | doc 12 §Phase-2g as-built (primary); doc 03 §D18/§D19; `src/domain/dashboard/run-detail.ts`; `src/server/dashboard/queries/run-detail.ts` |
| **D143** | **`explain run` AND THE DASHBOARD RECEIPT ARE ONE DERIVATION, AND EVERY SECTION WITHOUT A BACKING SERVICE SAYS SO.** A TERMINAL EXPLANATION READS THE SAME RECEIPT THE PANEL SERVES, SO THE TWO CANNOT DISAGREE. A SECTION AN OPERATOR COULD MISREAD AS "NOTHING HAPPENED" NAMES ITS REASON INSTEAD, AND `--bundle` REFUSES RATHER THAN EXPORTING A PACKAGE MISSING THE CAPTURE EVIDENCE ITS MANIFEST WOULD CLAIM. | doc 12 §2.5 (primary); `src/server/explain/`; `tests/unit/explain-run.test.ts` |

## Reconciliation round 34 (2026-08-04) — a transaction node is terminal evidence

| # | Decision | Owner (normative text) |
|---|---|---|
| **D144** | **A TRANSACTION NODE'S CHECKPOINT IS BOUND TO THE DURABLE `TransactionOutcome`'s SCHEMA HASH, AND THAT IS THE ONLY TRUTHFUL BINDING — SO THE TERMINAL SIDE MOVES, NOT THE SEQUENCER.** BEAT ⑦ STORES THE WHOLE OUTCOME ENVELOPE AS THE ROW'S `output.value`, SO `output.schemaHash` MUST BE THE HASH OF THE SCHEMA THOSE BYTES WERE PARSED WITH; STAMPING THE COMMIT CONTRACT'S BARE OUTPUT HASH THERE WOULD DESCRIBE A VALUE NO ROW HOLDS AND WOULD DEMAND A CHECKPOINT THE SEQUENCER NEVER WROTE, WHICH D110/D114's "EXACT STORED DEPENDENCIES" FORBIDS. THE COMMIT CONTRACT'S IDENTITY IS NOT LOST — IT LIVES ONE LEVEL DOWN AS `outcome.output.schemaHash` BESIDE `outcome.proof.schemaHash`, AND **BOTH ARE VERIFIED BEFORE THE STORED VALUE IS PARSED**, WHICH IS STRICTLY STRONGER THAN EITHER HASH ALONE AND IS WHY NO COMPOSITE IS MINTED. TERMINAL `build` THEN **PROJECTS** THE ENVELOPE ONTO `TypedTransactionOutcome<C>` — THE SHAPE DOC 02 §1.1 ALREADY SAYS A TRANSACTION NODE YIELDS AND EVERY DESCRIPTOR IS AUTHORED AGAINST — SO `derive` AND A DOWNSTREAM `bind` SEE THE SAME SHAPE; "WHICH SCHEMA OWNS THIS NODE'S FIELD PATHS" STAYS THE COMMIT OUTPUT AND IS A DIFFERENT QUESTION. THE INTERPRETER REGISTERS THE ROW IT DID NOT WRITE: IT READS BEAT ⑦'s EXACT `run_checkpoints` ROW BACK AND REFUSES IF IT IS ABSENT OR DOES NOT PROJECT TO THE SETTLEMENT JUST REPORTED, NEVER MINTING ONE FROM THE VALUE IT WAS HANDED. NO IDENTITY CHECK AND NO SEALED-DERIVE PATH IS RELAXED. `kuali-timekeeper-annotation` CONSEQUENTLY REACHES TERMINAL `done` AND ITS CONTROLLED COMMIT HAS AN EVIDENCE RECEIPT. | doc 09 §3.1 (primary); doc 02 §5.7 checkpoint identity rules; doc 12 §Named gap (closed); `src/domain/workflow/graph.ts`; `tests/unit/transaction-terminal-dependency.test.ts` |
| **D145** | **A GUARD'S THRESHOLD IS PART OF WHAT IT CLAIMS, AND AN UNCALIBRATED ALLOWANCE DISABLES ITS OWN REPAIR.** THE DOC 13 §7 PARITY LANE'S PIXEL HALF CARRIED `maxDiffPixelRatio: 0.001` (786 px AT 1024×768) DECLARED TO BE "FOR ANTIALIASING NONDETERMINISM ONLY, NEVER FOR CONTENT DRIFT" — A NUMBER CHOSEN, NOT MEASURED, AND WIDE ENOUGH TO SWALLOW A VISIBLE STALE `wf <descriptorHash>` STAMP AT 112 COUNTED PIXELS. BECAUSE `updateSnapshots: "changed"` DECIDES WHAT TO REWRITE WITH **THE SAME COMPARISON**, IT ALSO BLOCKED THE DELIBERATE `test:parity:update` FROM REPAIRING WHAT IT COULD NOT FAIL: COMMIT `6a8d467` REFRESHED EIGHT `.a11y.yml` FILES AND LEFT THEIR `.png` SIBLINGS STALE, SHIPPING EIGHT SELF-CONTRADICTORY PAIRS AND BREAKING D132's "THE TWO HALVES CAN NEVER BE REFRESHED INDEPENDENTLY" FROM UNDERNEATH. THE PIXEL COUNT ALLOWANCE IS NOW **ZERO** (`maxDiffPixels: 0`) AND THE PER-PIXEL COLOUR TOLERANCE IS PINNED EXPLICITLY AS THE LANE'S ONLY NONDETERMINISM BUDGET, CALIBRATED AGAINST A RECORDED MEASUREMENT — 46 REFERENCES × 2 INDEPENDENT FULL LANE RUNS, **0 COUNTED DIFFERING PIXELS BOTH TIMES**, WORST PER-PIXEL YIQ DELTA 0.0682 vs THE PINNED 0.2. THE OWNING DOC STATES EXACTLY WHAT THE PIXEL HALF CATCHES AND THE ONE THING IT DOES NOT (A SUB-TOLERANCE COLOUR SHIFT, COVERED BY `frontend-tailwind-compliance` AND THE a11y HALF), THE GUARD ASSERTS THE CONFIG'S **RESOLVED** COMPARISON RATHER THAN ITS TEXT, AND NO PARITY SPEC OR HELPER MAY SET A PER-CALL ALLOWANCE. | doc 13 §7.1 (primary); doc 10 §5 item 9; `playwright.parity.config.ts`; `tests/unit/architecture/parity-reference-authority.test.ts` |

## Reconciliation round 35 (2026-08-05) — Phase-2h foundation: the canonical field vocabulary

| # | Decision | Owner (normative text) |
|---|---|---|
| **D146** | **THE CANONICAL FIELD REGISTRY FREEZES AGAINST A RECORDED SCAN, CHECKED IN BOTH DIRECTIONS — AND A TIGHT SCHEMA NEEDS EVIDENCE.** DOC 06 §1's D58/D68 SCAN IS THE ARTIFACT `config/canonical-field-inventory.json`, NOT AN IMPLIED PROCESS: EVERY LEGACY WORKFLOW INPUT SCHEMA, ROSTER HEADER RULE, OCR FORM FIELD AND EDIT-DATA FIELD AT LEGACY COMMIT `4deabc5a` CARRIES EXACTLY ONE DISPOSITION — A CANONICAL ID, OR WORKFLOW-LOCAL WITH A REASON FROM A DECLARED, FULLY-USED SET. THE GUARD FAILS BOTH WAYS (AN UNEVIDENCED CANONICAL FIELD; A SCANNED FIELD WITH NO DISPOSITION) AND RE-READS EACH NAMED LEGACY FILE, SO THE FROZEN LEGACY TREE IS THE DRIFT DETECTOR — WHICH IMMEDIATELY CAUGHT FOUR FIELDS RECORDED AGAINST THE WRONG FILE. **A SCHEMA IS TIGHTENED ONLY ON EVIDENCE**: `eid` FROM §9.1, DATES AS ISO `DateOnly` (THE DRIVER OWNS `MM/DD/YYYY`), `ssn`/`postalCode`/`state`/PHONES FROM VERIFIED LEGACY VALIDATORS; EVERY OTHER FIELD CARRIES CONSERVATIVE TEXT PLUS `evidence:"audit-at-migration"` AND A REQUIRED `auditNote`, BECAUSE A SCHEMA WRONG IN THE **TIGHT** DIRECTION REJECTS REAL OPERATOR DATA AND `/^\d{4,6}$/` FOR `deptId` WOULD BE THE UNVERIFIED CONSTANT THIS TREE BANS. `ppsEid` IS A SEPARATELY BRANDED FIELD WITH **NO** DECLARED CONVERSION TO `Eid`. REDACTION IS DECLARED PER FIELD AND REFUSED AT DEFINITION TIME BY DOC 11's OWN TABLE, SO THE DURABLE MANIFEST HOLDS A REDACTED CELL WHILE THE LIVE GRID SHOWS THE OPERATOR THE REAL ONE FROM THE CONTENT-ADDRESSED SOURCE — `ssn`/`dob` USE `digest`, SINCE THE LAST FOUR OF AN SSN IS ITSELF AN IDENTIFIER. TWO STRUCTURAL LOCKS: `defineCanonicalField` REFUSES ANY `example` ITS OWN COERCE+PARSE REJECTS, AND NO NORMALIZED HEADER ALIAS MAY CLAIM TWO FIELDS — AN AMBIGUOUS ALIAS MAKES THE §2.5 SCORER'S TOP HIT ARBITRARY, WHICH IS §7 VECTOR #1 IN DISGUISE. `IntakeManifestId` IS THE ONE MANIFEST IDENTITY; §5's `IntakePlanId` IS THE SAME THING UNDER AN EARLIER NAME. | doc 06 §1.1 (primary); doc 06 §9.1; `src/domain/fields/`; `config/canonical-field-inventory.json`; `tests/unit/architecture/intake-canonical-field-registry.test.ts`; `tests/unit/canonical-fields.test.ts` |
| **D147** | **THE SUGGESTION SCORER CANNOT REACH A BINDING, AND MAPPING REUSE RESOLVES BY HEADER IDENTITY OR NOT AT ALL.** DOC 06 §2.5's "SUGGESTIONS ONLY" IS NOW A TYPE FACT: A `ColumnBinding` REQUIRES `confirmedAt`, A `Suggestion` HAS NO SUCH FIELD AND NO WAY TO ACQUIRE ONE, AND `confirmBinding` IS THE SINGLE MINT — SO NO CODE PATH RUNS FROM THE SCORER TO A POPULATED `bindings` ARRAY (§7 #1). THE SCORER GAINS ONE SIGNAL LEGACY'S REGEXES NEVER HAD — THE COLUMN'S REAL SAMPLES TRIED THROUGH THE CANONICAL FIELD'S OWN COERCE+SCHEMA — AND A HEADER THAT MATCHES WHILE **NO** SAMPLE PARSES SCORES **ZERO**, BECAUSE THAT COMBINATION IS A MIS-MAP RATHER THAN A WEAK MATCH; A `CellCoercionError` THERE IS THE MEASUREMENT AND ANYTHING ELSE PROPAGATES. CANDIDATES WITHIN 0.05 ARE `ambiguous` AND NEVER PRESELECT. `defineIntakeProjection` PROVES §1's INVARIANT BY **OBJECT IDENTITY** — A BYTE-IDENTICAL SCHEMA COPY IS REFUSED, SINCE TWO IDENTICAL SCHEMAS DRIFT APART INVISIBLY AND LEGACY ALREADY SHIPPED THAT EXACT DEFECT (§7 #6) — UNWRAPS OPTIONAL/DEFAULT/CATCH (BUT NOT `nullable`) TO DECIDE REQUIRED-NESS, AND FOLDS EACH TARGET'S SCHEMA HASH INTO `intakeProjectionFingerprint` SO A MAPPING BUILT AGAINST A LOOSER CANONICAL SCHEMA CANNOT SURVIVE ITS TIGHTENING. REUSE REFUSES OUTRIGHT ON WORKFLOW/PROJECTION/LAYOUT MISMATCH (§2.3's "A NEAR-MISS LAYOUT CAN NEVER PARTIALLY REUSE"), THEN RESOLVES EACH BINDING BY NORMALIZED HEADER PLUS OCCURRENCE INTO `held` / `confirmation-required` / `unbound`; **THE STORED INDEX NEVER BINDS** (§7 #3) AND EXISTS ONLY TO REPORT THAT A COLUMN MOVED. `SourceColumnId` USES CANONICAL JSON RATHER THAN DELIMITER CONCATENATION BECAUSE A HEADER MAY CONTAIN THE DELIMITER. THE WHOLE `src/domain/intake` TREE STAYS FREE OF NODE BUILT-INS — THE MAPPING GRID IS A BROWSER SURFACE (DOC 13 §8.13). | doc 06 §2.6 (primary); doc 06 §2.1–§2.5 + §7; `src/domain/intake/`; `src/validation/schema-path.ts`; `tests/unit/architecture/intake-mapping-boundary.test.ts`; `tests/unit/intake-mapping.test.ts` |
| **D148** | **THE INTAKE MANIFEST STORES CURRENT DISPOSITION AND DERIVES EVERY TOTAL FROM IT, AND A REJECT ID IS DERIVED SO REVALIDATION IS IDEMPOTENT.** `rejectedRows` IS IMMUTABLE HISTORY — A CORRECTED ROW KEEPS ITS REJECTION EVENT AND LOSES ONLY ITS **CURRENT** REJECT IDS — SO TOTALS CANNOT BE ACCUMULATED BESIDE THE TRUTH; THEY ARE COMPUTED FROM EXACTLY ONE DISPOSITION PER SOURCE ROW AND THE SCHEMA REFUSES ANY MANIFEST WHERE THE TWO DISAGREE, WHICH IS §7 #12 MADE MECHANICAL. A REJECT ID FOLDS `(SOURCE DIGEST, ROW, KIND, SUBJECT)`, SO A SECOND VALIDATION PASS OVER A CORRECTED FILE PRODUCES THE SAME IDS INSTEAD OF A DUPLICATE EVENT PER PASS, AND `buildIntakeManifest` THROWS RATHER THAN EMITTING A MANIFEST IN WHICH A ROW IS NEITHER VALID, REJECTED NOR EXCLUDED. VALIDATION IS **FORMAT-AGNOSTIC** (A PARSED CELL MATRIX IN, DISPOSITIONS OUT), SO ITS INVARIANTS ARE PROVABLE WITHOUT A FILE. `attemptCoercion` RETURNS A DISCRIMINATED VALUE — THE `catch` CLASSIFIES AND RETURNS, SETS NO FLAG AND SUPPLIES NO DEFAULT — SO A REFUSED CELL BECOMES A DURABLE LOCATED REJECTION WHILE A FAULT IN A COERCER STILL REACHES THE TOP. A BLANK **OPTIONAL** CELL IS GENUINE ABSENCE; A ROOT-LEVEL SCHEMA ISSUE IS `cross-field` NAMING EVERY BOUND TARGET (TRUTHFUL, WHERE INVENTING THE SPECIFIC PAIR ZOD NEVER REPORTED WOULD BE A GUESS); `duplicate-identity` REJECTS **BOTH** COLLIDING ROWS, SINCE PICKING A WINNER SILENTLY DROPS A PERSON THE OPERATOR LISTED. TWO REFINEMENTS ON §5's TEXT: THE MANIFEST PINS `canonicalInputSchemaHash` ONCE SO A READER PROVES WHICH SCHEMA PRODUCED `parsedInput` RATHER THAN INFERRING IT (D62/D110), AND `enqueueReadiness` SEPARATES `unresolved-rejections` FROM `no-valid-rows` SO A VALID ZERO-ROW INTAKE STAYS BLOCKED AND INSPECTABLE INSTEAD OF REPORTING A NO-OP SUCCESS. | doc 06 §5.0 (primary); doc 06 §5 + §7 #11/#12; `src/domain/intake/manifest.ts`; `src/domain/intake/validate.ts`; `tests/unit/intake-validation.test.ts` |
| **D149** | **THE EXTRACTION STORE'S ID FOLLOWS DOC 01's VERB GRAMMAR, ITS PARSERS WERE CHOSEN AS A SAFETY DECISION, AND A CELL IS CANONICALIZED TO TEXT AT EXACTLY ONE EDGE.** DOC 06 §3's ILLUSTRATIVE `extraction/parse-csv` DOES NOT SATISFY DOC 01's READ VERBS (`read|search|list|extract|match|verify`) AND DOC 01 §3.4 ALREADY WRITES `extraction/extract-pdf-fields`, SO THE ID IS CORRECTED TO **`extraction/extract-spreadsheet`** RATHER THAN THE GRAMMAR BEING WIDENED; ONE TASK COVERS `.csv` AND `.xlsx` SO NO CALLER BRANCHES ON A FILE EXTENSION. `read-excel-file@9.3.5` + `csv-parse@7.0.2` (BOTH MIT, ACTIVELY MAINTAINED, FOUR AND **ZERO** RUNTIME DEPENDENCIES; csv-parse IS STRICT BY DEFAULT SO A RAGGED ROW THROWS RATHER THAN BEING PADDED). **`xlsx` (SHEETJS CE) IS REFUSED**: ABANDONED ON npm AT 0.18.5 WITH TWO UNFIXED HIGH-SEVERITY ADVISORIES INCLUDING PROTOTYPE POLLUTION ON A CRAFTED FILE (CVE-2023-30533), AND THIS PROCESS PARSES OPERATOR-SUPPLIED FILES WHILE DRIVING REAL UCPATH/KUALI WRITES. ALSO REFUSED: `node-xlsx` (RESOLVES SHEETJS THROUGH A `cdn.sheetjs.com` TARBALL URL, INVISIBLE TO `npm audit`), `exceljs` (WHAT LEGACY USES; UNMAINTAINED SINCE 2023, NINE RUNTIME DEPS), `@office-kit/xlsx` (BEST-DESIGNED BUT PRE-1.0 ALPHA WITH A DECLARED-UNSTABLE API). A DATE-**FORMATTED** CELL BECOMES ISO `YYYY-MM-DD` FROM ITS UTC COMPONENTS AT THIS EDGE AND NOWHERE ELSE, SO `parseUsOrIsoDate` CAN REFUSE A BARE EXCEL SERIAL AS A LOUD PER-CELL REJECTION INSTEAD OF A 1900-EPOCH GUESS; AN UNDOCUMENTED CELL TYPE THROWS RATHER THAN BECOMING `[object Object]`. HEADER DISCOVERY IS **ALIAS-INDEPENDENT** (STRUCTURE DECIDES; ALIASES ADD AT MOST 0.15) AND PRESELECTS ONLY ON BOTH A FLOOR AND A MARGIN, SO INDISTINGUISHABLE ROWS RETURN A CHOICE — PICKING WRONG SHIFTS EVERY COLUMN BY ONE AND SURFACES AS FORTY UNRELATED BAD CELLS. WRITING ITS TESTS FOUND A REAL RANKING DEFECT: `MM/DD/YYYY` DID NOT COUNT AS DATA-SHAPED, PUTTING EVERY ORDINARY EXPORT INTO "AMBIGUOUS". **`scenario-coverage` NOW COLLECTS REFERENCES FROM THE TASK STORE REGISTRY AS WELL AS DESCRIPTORS**, BECAUSE A STORE CONTRACT MAY LAND BEFORE ITS CONSUMING DESCRIPTOR — THE MIRROR IMAGE OF D107's `pending-impl-bindings.json` — AND A REGISTERED CONTRACT IS PRODUCTION SURFACE EITHER WAY. | doc 06 §3.1 (primary); doc 01 §3.4 id grammar; `src/domain/intake/header-discovery.ts`; `src/domain/contracts/extraction/`; `src/stores/extraction/`; `tests/scenario/intake-extraction.scenario.test.ts`; `tests/unit/intake-header-discovery.test.ts` |

## Reconciliation round 36 (2026-08-05) — the two repositories stop touching each other

| # | Decision | Owner (normative text) |
|---|---|---|
| **D150** | **LEGACY CHANGE ACCOUNTING IS RETIRED; THE TWO REPOSITORIES TOUCH EACH OTHER IN NEITHER DIRECTION.** OPERATOR DECISION: EVERY WORKFLOW IS REBUILT HERE ANYWAY, SO THERE IS NO ONGOING LEDGER TO RECONCILE — AND D94's GUARD REQUIRED LEGACY's `src`/`tests` WORKTREE TO BE **CLEAN**, WHICH MADE AN UNRELATED IN-FLIGHT EDIT IN THE **PRODUCTION** REPO A RED GATE IN THE REBUILD. THAT IS THE WRONG COUPLING: THE REBUILD MUST NEVER BLOCK ON WHAT PRODUCTION IS DOING TODAY. **WHERE THE INVARIANT WENT:** THE RISK WAS A PORTED SELECTOR OR PAGE-STATE FACT GOING STALE AFTER LEGACY FIXED IT, AND THAT MOVES TO **LIVE RE-VERIFICATION AT EACH WORKFLOW's MIGRATION** — ALREADY MANDATORY AND PRE-AUTHORIZED, AND STRICTLY STRONGER, SINCE A SELECTOR CHECKED AGAINST THE LIVE SYSTEM BEATS ONE DIFFED AGAINST LEGACY's COPY OF IT. ONLY 23 OF 406 PINNED KEYS ARE `ported` TODAY, AND EACH IS LIVE-VERIFIED AT ITS MIGRATION REGARDLESS. `legacy-selector-port-provenance` IS UNAFFECTED BECAUSE IT READS A **FIXED** COMMIT's BLOBS RATHER THAN THE WORKING TREE; THE CAPABILITY/TEST DISPOSITION INVENTORIES LIKEWISE READ LEGACY AS ONE-TIME PLAN COVERAGE AND NEVER BLOCK ON ITS STATE. `config/legacy-change-accounting.json` IS KEPT AS A **FROZEN** HISTORICAL RECORD AND IS READ BY NOTHING. A SIDE DEFECT FELL OUT: `guard-manifest` ASSERTED `retiredBy === "D93"`, A LITERAL THAT COULD ONLY HOLD UNTIL THE SECOND RETIREMENT; IT NOW ASSERTS THE RULE (`/^D\d+$/`). | doc 10 §3.13 (primary); CLAUDE.md cross-repo rules; `docs/rebuild/guard-inventory.json` (retired entry) |
| **D151** | **AN OCR EXTRACTION IS ADMITTED BY ONE GATE THAT DOES NOT BRANCH ON WHO PRODUCED IT, AND EVERY DECLARED FIELD MUST BE ANSWERED.** OPERATOR REQUIREMENT: A PAGE MAY BE READ BY THE PROVIDER PIPELINE, BY AN AI THE OPERATOR RUNS IN THEIR OWN TERMINAL, OR BY THE OPERATOR — AND ALL THREE MUST YIELD THE SAME RECORD WITH NOBODY SKIPPING ANYTHING. `ExtractionSource` IS A CLOSED UNION RECORDED AS **PROVENANCE, NEVER PERMISSION**; `admitOcrExtraction` CONTAINS NO BRANCH ON IT, SO A ROUTE CANNOT EARN A WEAKER RULE BY BEING MORE CONVENIENT, AND A CANONICAL-BOUND VALUE RUNS THE **SAME** COERCE+SCHEMA AN INTAKE COLUMN RUNS (A MODEL RETURNING `10-4567` FOR AN EID IS REFUSED EXACTLY AS A SPREADSHEET CELL IS). THE INSTRUCTION EVERY ROUTE RECEIVES IS **GENERATED** FROM THE FORM REGISTRY, SO ADDING A FIELD REACHES ALL THREE ROUTES ON THE NEXT RUN AND NO ROUTE CAN SILENTLY STOP ASKING. COMPLETENESS IS MECHANICAL: EVERY DECLARED PATH MUST APPEAR, AN UNDECLARED PATH IS REFUSED, AND THERE IS NO `.optional()` IN THE ANSWER SHAPE — AN OPTIONAL FIELD IS PRECISELY ONE A PRODUCER CAN SKIP IN SILENCE. THE THREE ABSENCES ARE **NOT** INTERCHANGEABLE (`not-on-form` / `blank` / `illegible`); LEGACY COLLAPSED ALL THREE INTO `null` AND REBUILT THE DIFFERENCE BY DIFFING SNAPSHOTS. A READ VALUE ITS FIELD REFUSES BECOMES `unreadable` **WITH ITS RAW TEXT** RATHER THAN VOIDING THE RECORD, SINCE A HUMAN RESOLVES IT AND MUST SEE WHAT THE PRODUCER SAW. `answersFingerprint` DIGESTS WHAT WAS READ WHILE EXCLUDING WHO READ IT, WHEN, AND ITS SELF-REPORTED CONFIDENCE, SO CROSS-ROUTE AGREEMENT IS CHECKABLE RATHER THAN ASSERTED. THE PROVIDER ADAPTER AND THE OPERATOR CLI ARE TRANSPORTS OVER THIS GATE AND MAY ADD NO RULE OF THEIR OWN. | doc 06 §4.3 (primary); doc 01 §3.4 service stores; `src/domain/ocr/`; `tests/unit/ocr-extraction-admission.test.ts` |
| **D152** | **DOC 06 §3's `parse-pdf-fields` DESCRIBED A CAPABILITY THAT DOES NOT EXIST; THE REAL INTAKE NEED IS RASTERIZATION.** §3 CLAIMED "SAME SHAPE FOR A FIELDED PDF (ONBOARDING's EXTRACTION STEP PORTS HERE)", BUT LEGACY's ONBOARDING `extract.ts` IS PLAYWRIGHT SCRAPING LABELLED FIELDS OFF A **CRM PAGE**, AND **NO LEGACY CODE READS AN ACROFORM ANYWHERE** — LEGACY's ACTUAL PDF USES ARE RASTERIZING PAGES FOR OCR, SPLITTING A PAGE FOR ONBASE, AND TEXT-EXTRACTING KRONOS REPORTS. BUILDING AN ACROFORM READER FOR A FORM NOBODY SUBMITS WOULD BE IMPLEMENTING A MISREMEMBERED REQUIREMENT, SO `extraction/extract-pdf-pages` LANDS INSTEAD: ONE CONTENT-ADDRESSED PDF → ONE CONTENT-ADDRESSED PNG PER PAGE, WHICH IS EXACTLY WHAT `ocr/extract-form-page` CONSUMES. A PAGE WINDOW PAST THE END IS **REFUSED, NEVER CLAMPED** (AN OPERATOR ASKING FOR PAGES 40–50 OF A 44-PAGE SCAN HAS MISCOUNTED, AND RETURNING FIVE WOULD MISNUMBER EVERY DOWNSTREAM `sourcePage`), AND `pageCount` REPORTS THE **DOCUMENT's** COUNT SO A REVIEWER CAN TELL A TWO-PAGE SCAN FROM PAGES 2–3 OF A LONGER ONE. **`pdf-to-img` CHOSEN** (MIT, MAINTAINED 2026-06, ONE DEPENDENCY, WRAPS MOZILLA's `pdfjs-dist` — THE ENGINE LEGACY ALREADY RENDERS WITH); REFUSED: `pdf-lib` (LEGACY's SPLITTER, LAST PUBLISHED 2022-05 AND CANNOT RASTERIZE — NO PDF **WRITER** IS NEEDED ON THIS PATH), `pdfjs-dist` DIRECTLY (HAND-WIRED CANVAS/WORKER PLUMBING), `mupdf` (AGPL-3.0), `pdf-parse`/`unpdf` (TEXT EXTRACTORS; A SCANNED FORM HAS NO TEXT LAYER). TWO FINDINGS FROM A REAL 44-PAGE OPERATOR SCAN ARE ENCODED: THE **JBIG2 WASM DECODER MUST BE WIRED** (XEROX EMITS JBIG2; WITHOUT `wasmUrl` PDFJS FALLS BACK TO ITS JS DECODER AND TAKES ~60% LONGER — 736 ms vs 462 ms FOR FIVE PAGES — AND THE URL IS RESOLVED FROM THE **INSTALLED** `pdfjs-dist` SO IT CANNOT NAME A STALE COPY), AND **PDFJS TRANSFERS ITS INPUT BUFFER**, SO EVERY CALL GETS A FRESH COPY OR A SECOND RENDER THROWS `DataCloneError` ON A DETACHED BUFFER. THE SCENARIO FIXTURE IS A PDF BUILT BY HAND FROM LITERAL PDF OBJECTS, BECAUSE A FIXTURE FROM A PDF **WRITER** WOULD ONLY PROVE THE READER AGREES WITH THAT WRITER. | doc 06 §3.2 (primary); doc 01 §3.4; `src/domain/contracts/extraction/extract-pdf-pages.ts`; `src/stores/extraction/tasks/extract-pdf-pages.ts`; `tests/scenario/intake-pdf-pages.scenario.test.ts` |
| **D153** | **THE OCR FORMS ARE LEGACY's, AND PORTING THEM FOUND TWO STRUCTURAL GAPS IN D151's FIRST SHAPE.** OPERATOR CONFIRMATION: THE REBUILD HANDLES THE SAME FORMS, SO THE FIELD SETS ARE PORTED RATHER THAN REDESIGNED — AND READING LEGACY's ACTUAL PROMPTS EXPOSED TWO KINDS OF SKIPPING THE FIRST GATE COULD NOT SEE. **(1) A PAGE CAN CARRY SEVERAL PEOPLE.** AN OATH SIGN-IN SHEET IS A TABLE; A GATE ACCEPTING ONE RECORD PER PAGE WOULD SILENTLY DROP ELEVEN PEOPLE FROM A TWELVE-ROW SHEET AND NO PER-FIELD CHECK WOULD NOTICE. A SUBMISSION NOW CARRIES `records: [{ rowIndex, answers }]`, `recordsPerPage` DECLARES `one` OR `many`, EACH RECORD KEEPS ITS OWN `answersFingerprint`, AND THE PAGE GETS A `pageFingerprint` OVER ALL OF THEM. **(2) A SCANNED STACK IS MIXED.** LEGACY's OWN PROMPTS CLASSIFY EVERY PAGE, BECAUSE OPERATORS FEED IT PILES OF PAPER; WITHOUT IT A PRODUCER HANDED AN EMERGENCY-CONTACT PAGE DURING AN OATH RUN MUST EITHER **INVENT** OATH ANSWERS OR **FAIL** THE PAGE, AND NEITHER IS TRUE. A SUBMISSION DECLARES `pageKind` BEFORE ANY FIELD IS READ, AND A PAGE THAT IS NOT THE EXPECTED FORM CARRIES NO RECORDS AND IS **ADMITTED**. LEGACY's HARD-WON PROMPT KNOWLEDGE MOVES ONTO THE **FORM** AS `extractionNotes` — THE OBSERVED DIGIT TRANSPOSITIONS (`10843962` FOR `10002337`; 8↔9 AND 3↔8), THE OBSERVED LETTER DROPS (`Sharaf` NOT `Shaaf`), "SCAN THE TOP MARGIN BECAUSE ON UPAY585 A STANDALONE EIGHT-DIGIT NUMBER ABOVE THE HEADER IS USUALLY THE REAL ID", "NEVER SKIP THE CONTACT's ADDRESS BECAUSE IT RESEMBLES THE EMPLOYEE's" — AND THE GUARD ASSERTS EVERY NOTE REACHES THE GENERATED BRIEF **VERBATIM**, SO IT CANNOT LAND IN ONE ROUTE's PROMPT STRING AND MISS THE OTHERS. LEGACY's `originallyMissing`, RECONSTRUCTED AFTERWARDS BY DIFFING SNAPSHOTS, IS SUPERSEDED BY THE TYPED ABSENCES RECORDED AT READING TIME BY THE PRODUCER THAT READ THEM. | doc 06 §4.4 (primary); doc 06 §4.3; `src/domain/ocr/form-registry.ts`; `src/domain/ocr/extraction.ts`; `tests/unit/architecture/ocr-producer-parity.test.ts` |
| **D154** | **THE OCR FORM MODEL IS MEASURED AGAINST THE REAL DOCUMENT CORPUS, AND IT CORRECTED D153 TWICE.** OPERATOR, 2026-08-06: THE MULTI-ROW SIGN-IN SHEET IS **USED BY NO WORKFLOW**, AND `hr-automation/data/documents` CONFIRMS IT — EVERY OATH IN THE CORPUS IS A UPAY 586 WITH ONE NAME. SO `recordsPerPage` IS REMOVED AND `record` IS A SINGLE NULLABLE VALUE: AN ARRAY OF AT MOST ONE IS GENERALITY WITH NO USER, AND THIS TREE DOES NOT KEEP THAT. THE CORPUS ALSO CORRECTED THE FIELD KNOWLEDGE — THE **EMPLOYEE ID BOX IS FREQUENTLY BLANK** ON A REAL OATH (NORMAL, AND THE DEPARTMENT NUMBER PRINTED BESIDE IT MUST NOT BE SUBSTITUTED), AND A **SIGNED-BUT-UNWITNESSED** OATH IS COMMON AND MEANINGFUL RATHER THAN AN OCR FAILURE. **THE PAGE-KIND VOCABULARY IS DERIVED, NOT GUESSED:** `i9.pdf` PAGE 1 IS A SECTION 2 FOR ONE PERSON AND PAGE 2 A SECTION 1 FOR A **DIFFERENT** ONE — LOOSE, OUT OF ORDER — AND BOTH READ "PAGE 7/8 OF 9", SO **SEVEN OF EVERY NINE PAGES IN AN I-9 PACKET CARRY NO DATA**. HENCE `oath` · `emergency-contact` · `i9-section1` · `i9-section2` · `boilerplate` · `unrelated` · `blank`, WITH THE LAST THREE KEPT APART BECAUSE ONLY `unrelated` MEANS SOMETHING IS IN THE STACK THAT DOES NOT BELONG AND ONLY `blank` MIGHT MEAN THE SCANNER DOUBLE-FED. `pageFingerprint` FOLDS THE **CLASSIFICATION** AS WELL AS THE ANSWERS, SO TWO PRODUCERS THAT BOTH READ "NO DATA" WHILE DISAGREEING ABOUT WHY HAVE NOT AGREED. **RECOMMENDED NEXT SLICE:** PAIRING AN I-9 §1 WITH ITS §2 IS A **GROUPING** PROBLEM ABOVE THIS GATE THAT THE CORPUS PROVES CANNOT BE POSITIONAL — THREE STAGES (CLASSIFY THE STACK → GROUP PAGES INTO SUBJECTS BY THE NAME READ OFF EACH, WITH AN EXPLICIT `orphan-section2` OUTCOME → EXTRACT PER SUBJECT), WHERE `ocr/extract-form-page` IS STAGE 3 AND ALREADY ASSUMES ITS CALLER KNOWS THE FORM TYPE. | doc 06 §4.5 (primary); doc 06 §4.3–§4.4; `src/domain/ocr/form-registry.ts`; `src/domain/ocr/extraction.ts`; `tests/unit/ocr-extraction-admission.test.ts` |
| **D155** | **A TWO-DIGIT YEAR IS RESOLVED AGAINST THE OBSERVATION INSTANT, NOT REFUSED — AND THE FIRST LIVE OCR RUN IS WHAT FORCED IT.** READING `detect-test.pdf` THROUGH ROUTE 2 REPORTED THE STACK CORRECTLY (4 EMERGENCY-CONTACT PAGES FLAGGED **NOT THIS WORKFLOW**, 3 OATH PAGES EXTRACTED, 0 REFUSED) AND EXPOSED ONE DEFECT: PAGE 5 IS DATED `11/3/21` AND `single-oath.pdf` IS DATED `4-23-26` — TWO-DIGIT YEARS, ONE DASH-SEPARATED, AND BOTH ARE THE NORMAL WAY THESE FORMS ARE FILLED IN. THE COERCER REFUSED BOTH **WHILE THE GENERATED BRIEF WAS TELLING EVERY PRODUCER THAT `M/D/YY` AND `M-D-YY` ARE EXPECTED**: THE INSTRUCTION AND THE VALIDATOR CONTRADICTING EACH OTHER, WITH EVERY REAL OATH DATE LANDING `unreadable` ON THE FIRST BATCH. `parseUsOrIsoDate` NOW ACCEPTS `-` AS WELL AS `/` AND TAKES THE 2000s READING UNLESS IT LANDS MORE THAN A YEAR AHEAD OF THE OBSERVATION, OTHERWISE THE 1900s (`21`→2021, `26`→2026, `98`→1998). THAT IS A **DOCUMENTED RULE, NOT A GUESS**, AND IT IS SOUND FOR WHAT THIS SYSTEM READS — A SIGNATURE, HIRE, BIRTH OR SEPARATION DATE IS PAST OR AT MOST AN APPOINTMENT WITHIN THE YEAR, NEVER SEVENTY YEARS EARLY. THE REFERENCE IS THE **OBSERVATION INSTANT, NOT `now`**, CARRIED ON `CellLocation.readAt` RATHER THAN READ FROM A CLOCK INSIDE THE COERCER: THE INTAKE PIPELINE PASSES THE RUN's INSTANT AND THE OCR GATE PASSES THE SUBMISSION's OWN `readAt`, SO RE-ADMITTING A STORED SUBMISSION YEARS LATER RESOLVES ITS DATES EXACTLY AS THE FIRST ADMISSION DID — A CENTURY THAT MOVED UNDER REPLAY WOULD BE THE SILENT WRONG VALUE THIS RULE EXISTS TO AVOID. | doc 06 §4.6 (primary); doc 06 §2.4; `src/domain/fields/cell-coercion.ts`; `tests/unit/canonical-fields.test.ts` |
| **D156** | **D150's DECOUPLING EXTENDS TO THE ENVIRONMENT INVENTORY — THE LAST GUARD THAT MADE LEGACY WORK A REBUILD GATE.** `runtime-environment-coverage` SCANNED **BOTH** REPOSITORIES, SO A NEW ENVIRONMENT KEY ADDED TO THE **PRODUCTION** REPO (`SHRED_AUDIT_WORKERS`, WHILE THIS SESSION WAS RUNNING) TURNED A REBUILD GATE RED FOR WORK THAT HAS NOTHING TO DO WITH THE REBUILD — EXACTLY THE COUPLING D150 REMOVED FROM CHANGE ACCOUNTING. THE SCAN IS NOW THIS REPO ONLY, AND THE OWNERSHIP AND COMPUTED-READER CHECKS FILTER `legacy:` REGISTRATIONS OUT RATHER THAN REPORTING DRIFT ON EVERY ONE OF THEM AGAINST A SCAN THAT NEVER LOOKS THERE. **THE CLAIM NARROWS HONESTLY WITH THE SCAN:** THE GUARD NOW SAYS "EVERY ENVIRONMENT READ IN THE REBUILD IS REGISTERED, OWNED AND CLASSIFIED", WHICH IS THE PART THAT GOVERNS WHAT THIS RUNTIME DOES. THE REMAINING `legacy:` ENTRIES ARE A HISTORICAL RECORD; NOTHING VERIFIES THEM AND NOTHING SHOULD EXTEND THEM. | doc 10 §3.13 (primary); D150; `tests/unit/architecture/runtime-environment-coverage.test.ts` |
| **D157** | **GROUPING MATCHES BY NAME ACROSS THE WHOLE STACK; ADJACENCY IS NOT A RULE — TWO RAW SCANS PROVE IT.** THE OPEN QUESTION WAS WHETHER A PERSON's PAGES ARRIVE TOGETHER. PROVENANCE FIRST: `detect-test.pdf` IS `/Creator (VersaLink B7035)` AND `Xerox Scan_08052026141856.pdf` IS `/Creator (VersaLink C7020)` — BOTH **RAW XEROX MFP OUTPUT** — WHILE `multiple-oath.pdf` IS `/Producer (macOS Version 26.1)` AND IS THE ASSEMBLED ONE, SO THE SCANS ARE GROUND TRUTH AND THE TIDY FILE IS NOT. THE TWO SCANS DISAGREE: IN `detect-test.pdf` A PERSON's PAGES **ARE** ADJACENT (ONE ORPHAN EC, THEN THREE EC→OATH PAIRS), WHILE THE 44-PAGE I-9 SCAN's FIRST FOUR PAGES ARE FOUR **DIFFERENT** PEOPLE WITH ALTERNATING SECTIONS — §2 CASEY · §1 CHO · §2 CISNEROS · §1 CHAN — NOT ALPHABETICAL, NOT PAIRED, NO TWO CONSECUTIVE PAGES ONE PERSON's. **ADJACENCY IS THEREFORE A PROPERTY OF HOW A PILE WAS ASSEMBLED, NOT OF SCANNING**, AND GROUPING MUST MATCH BY THE NAME READ OFF EACH PAGE ACROSS THE WHOLE STACK, USING ADJACENCY ONLY AS A TIEBREAKER BETWEEN EQUALLY GOOD MATCHES. A NEIGHBOUR-PAIRING DESIGN WOULD HAVE ATTACHED CASEY's SECTION 1 FROM CHO's PAGE — A REAL I-9 VERIFICATION BOUND TO THE WRONG PERSON. TWO CORPUS PROPERTIES MAKE THE NAME MATCH WORKABLE: AN I-9 §2 CARRIES "EMPLOYEE LAST NAME, FIRST NAME AND MIDDLE INITIAL **FROM SECTION 1**" SO BOTH PAGES NAME THE PERSON INDEPENDENTLY, AND A PAGE WHOSE OWN NAME IS UNREADABLE (`detect-test.pdf` PAGE 2 HAS A STICKY NOTE OVER IT) CAN STILL BE GROUPED FROM ITS PARTNER. AN UNMATCHED §2 IS **FLAGGED, NOT BLOCKED** (OPERATOR, 2026-08-06), AS LEGACY's `orphanSection2` WAS. | doc 06 §4.7 (primary); doc 06 §4.5; D151/D154 |
| **D158** | **STAGES 1 AND 2 OF THE SCANNER PIPELINE LAND, AND EVERY PAGE IS ACCOUNTED FOR.** `src/domain/ocr/stack.ts` CONSUMES A CLASSIFIED STACK AND GROUPS IT INTO SUBJECTS; `rebuild:cli ocr stack <file> <form-type>` IS THE OPERATOR SURFACE AND ANSWERS "WHICH PAGES DO NOT BELONG IN THIS RUN". **EVERY PAGE LANDS IN EXACTLY ONE BUCKET** — SUBJECT, `unidentified`, `otherForms`, `dataless` — AND `pagesAccounted` MUST EQUAL `pagesClassified`, BECAUSE A PAGE IN NO BUCKET IS A PAGE NOBODY KNOWS WAS SKIPPED. `personMatchKey` IS **EXACT AND NARROW**: LOWERCASED ALPHABETIC TOKENS, SORTED (SO AN I-9 §2 HEADER `Clauldia, Drona A.` MATCHES A §1's SEPARATE BOXES), SINGLE LETTERS DROPPED (A MIDDLE INITIAL IS WRITTEN INCONSISTENTLY AND ITS ABSENCE MUST NOT SPLIT ONE PERSON IN TWO), AND **null BELOW TWO TOKENS** — A SURNAME ALONE WOULD GROUP SIBLINGS — WITH SUCH A PAGE REPORTED `unidentified` RATHER THAN GUESSED AT. THERE IS NO FUZZY SCORING: THAT IS PRECISELY WHERE THIS WOULD START INVENTING PEOPLE. VERIFIED ON BOTH REAL STACKS. **THE SECTIONED-SUBJECT CASE AND ITS ORPHAN OUTCOME ARE DELIBERATELY NOT WRITTEN**: EVERY FORM THAT EXISTS TODAY IS ONE PAGE PER PERSON, SO THAT ARM WOULD BE UNREACHABLE AND UNTESTED, AND IT LANDS WITH THE `i9` FORM UNDER D157's FLAG-NEVER-BLOCK RULE. | doc 06 §4.8 (primary); D157; `src/domain/ocr/stack.ts`; `tests/unit/ocr-stack.test.ts` |
| **D159** | **AUTHORITY SCHEMA v11 — INTAKE MANIFESTS AND ADMITTED OCR EXTRACTIONS BECOME DURABLE.** EVERYTHING THE 2h PIPELINES PRODUCED WAS IN-MEMORY: A MANIFEST AND AN EXTRACTION SURVIVED EXACTLY AS LONG AS THE PROCESS DID. BOTH TABLES CARRY THEIR IDENTIFYING FACTS AS **COLUMNS** BESIDE THE RECORD JSON, FOR THE REASON v10 GAVE `failures` A SEARCHABLE FINGERPRINT — "HAS THIS FILE BEEN RUN BEFORE" AND "HAS THIS PAGE ALREADY BEEN READ" ARE CONSTANT OPERATOR QUESTIONS AND A SCAN OVER PARSED JSON IS NOT AN ANSWER. `intake_manifests` IS **IMMUTABLE AND UNDELETABLE BY TRIGGER**: A MANIFEST IS THE RERUN AUTHORITY PROVING WHICH FILE AND MAPPING PRODUCED WHICH ITEMS, AND A RUN HAS ALREADY FANNED OUT AGAINST IT, SO A REWRITE WOULD REWRITE HISTORY SOMEBODY ACTED ON — A RERUN CREATES A NEW MANIFEST AND §5's `rerunDiff` SHOWS THE DIFFERENCE. `ocr_extractions` IS **UNIQUE ON `(source_sha256, source_page, form_type)`** — ONE PAGE, READ ONCE, FOR ONE FORM — SO A SECOND PRODUCER READING THE SAME PAGE WITH A DIFFERENT RESULT IS REFUSED BY NAME RATHER THAN BECOMING A SECOND ROW THAT SILENTLY DOUBLES A PERSON IN THE FAN-OUT; A BYTE-IDENTICAL RE-READ IS IDEMPOTENT SO REPLAY IS SAFE. THE RELEASED v1 TABLE ORDER IS UNTOUCHED (BOTH TABLES JOIN `POST_V1_TABLE_ORDER`), AND v11's LITERAL DIGEST IS APPENDED TO THE PINNED MIGRATION HISTORY. | doc 06 §4.9 (primary); doc 03 §D14; `src/infra/sqlite/migrations.ts`; `src/infra/sqlite/authority-database.ts` |

## Reconciliation round 37 (2026-08-07) — the i9 form: sectioned pages, one uniform record

| # | Decision | Owner (normative text) |
|---|---|---|
| **D160** | **THE i9 IS ONE FORM ACROSS TWO LOOSE SECTIONS, AND THE SECTIONED ARMS D158 DEFERRED LAND WITH IT.** A FORM NOW DECLARES ITS DATA-BEARING PAGE KINDS (`OcrFormSpec.pageKinds`) — `formType === pageKind` WAS A COINCIDENCE OF THE ONE-PAGE FORMS — AND `i9` ITSELF IS DELIBERATELY **NOT** A PAGE KIND: A PHYSICAL PAGE IS A SECTION 1 OR A SECTION 2, NEVER "AN I-9", AND A REGISTRY SEAL REFUSES A PAGE KIND CLAIMED BY TWO FORMS. THE RECORD IS **UNIFORM ACROSS BOTH SECTIONS** (LEGACY's OWN PROMPT RULE, MADE STRUCTURAL): EVERY SUBMISSION ANSWERS ALL SIX FIELDS, A FIELD WHOSE BOX LIVES ON THE OTHER SECTION (`OcrFieldSpec.onPageKinds`) IS ANSWERED `not-on-form` — THE ABSENCE REASON BUILT FOR EXACTLY THIS — AND THE GATE **REFUSES** ANYTHING ELSE THERE: A `dateOfBirth` "READ" OFF A SECTION 2 PAGE IS A VALUE FROM NOWHERE, AND `blank`/`illegible` BOTH CLAIM THE BOX EXISTS. MANDATORY BLOCKING IS PER-SECTION. THE FIELD SET AND PROMPT KNOWLEDGE ARE PORTED FROM `legacy:src/services/ocr/forms/i9.ts` AT `4deabc5a` WITH THE ACCURACY RULE's PROVENANCE (LIVE 2026-07-13: A DEGRADED SCAN YIELDED A CONFIDENT FABRICATED SSN+DOB AND A FALSE "NOT FOUND"); NOT PORTED, EACH ON AN EXISTING DECISION: THE `"i9 ssn"` UCRS-419 SHEET (D154 — NO CORPUS EVIDENCE; IT CLASSIFIES `unrelated`, SURFACED BY NAME), THE "NEVER ROUND A 2-DIGIT YEAR" NOTE (D155 RESOLVES THE CENTURY BY DOCUMENTED RULE), AND THE FUZZY LEVENSHTEIN PAIRING (D158 — EXACT MATCH OR A HUMAN). GROUPING GAINS THE SECTIONED SUBJECT: `incomplete` WITH `missingKinds`, **FLAGGED AND NEVER BLOCKED** (D157) — THE ORPHAN §2 IS THIS ARM AS `missingKinds: ["i9-section1"]`, LEGACY's `orphanSection2` MADE GENERAL — AND `duplicate` MEANS A DUPLICATED **KIND**, CARRYING `missingKinds` ORTHOGONALLY SO ONE ARM CANNOT HIDE THE OTHER FACT. §1↔§2 FIELD CORROBORATION NEEDS BOTH EXTRACTIONS IN HAND AND IS DOC 12 EVIDENCE WORK ABOVE THIS LAYER. | doc 06 §4.10 (primary); doc 06 §4.7/§4.8; `src/domain/ocr/form-registry.ts`; `src/domain/ocr/extraction.ts`; `src/domain/ocr/stack.ts`; `config/canonical-field-inventory.json` |
| **D161** | **ROUTE 1's PRODUCTION ADAPTER IS TRANSPORT PLUS PROVENANCE — THE FIRST REAL `ocr.extract` ADAPTER LANDS, AND IT ADDS NO RULE.** `src/infra/providers/gemini-ocr-extract.ts` (GEMINI, LEGACY's PRIORITY-1 OCR PROVIDER) SENDS THE REGISTRY-GENERATED INSTRUCTION WITH THE PAGE BYTES INLINE AS BASE64 AND RUNS EVERYTHING IT GETS BACK THROUGH THE ONE GATE. IT OWNS EXACTLY TWO THINGS: **TRANSPORT** — THE KEY RIDES THE `x-goog-api-key` HEADER, NEVER THE URL, SO NO MESSAGE OR EVIDENCE LINE CAN CARRY IT; 429 MAPS TO RETRYABLE `rate-exhausted` (THE PROVIDER's OWN `Retry-After`, ELSE THE NEXT FIXED UTC MINUTE — D112's WINDOW SEMANTICS); 401/403 → `adapter-unavailable`; ANYTHING ELSE THROWS SO ADMISSION RECORDS A DURABLE INTERRUPTION; A NON-JSON ANSWER IS `invalid-response` REPORTING SHAPE ONLY, NEVER AN EXCERPT — AND **PROVENANCE** — `formType`/`source`/`readAt`/`sourceSha256`/`sourcePage` ARE STAMPED FROM FACTS THE ADAPTER KNOWS, WHILE `pageKind`/`record` PASS THROUGH VERBATIM AND AN OMITTED KEY STAYS OMITTED SO THE GATE NAMES THE GAP. THE REQUEST ENVELOPE NOW CARRIES THE WHOLE `ArtifactRef` (AN id+sha PAIR NAMED BYTES `open()` COULD NOT RESOLVE); `providerModelChain` JOINED `src/domain/secrets.ts` AS THE MODELS-ENV READER; USAGE COST IS 0 BY DECLARATION UNDER THE FREE-TIER FAMILY AND `ocrExtract`'s ZERO COST CAP. **PROVED LIVE 2026-08-08:** THE REAL MODEL ON THE REAL SCAN's PAGE 13 PRODUCED IN 14.2 s AN ADMITTED `i9-section1` RECORD WHOSE `answersFingerprint` IS **BYTE-IDENTICAL** TO A HUMAN's INDEPENDENT ROUTE-2 READING OF THE SAME PAGE. EXECUTOR/WORKER WIRING (`ctx.providers`/`ctx.artifacts`) IS THE DELIBERATE REMAINDER; THE GUARD ARMS CONFINING `createAdmittedProviderClient` RELAX ONLY WHEN THAT CONSUMER LANDS. | doc 06 §4.11 (primary); doc 01 §3.4; `src/infra/providers/gemini-ocr-extract.ts`; `tests/unit/gemini-ocr-extract-adapter.test.ts`; `tests/unit/architecture/provider-capability-boundary.test.ts` |

## Reconciliation round 38 (2026-08-08) — the executor becomes the provider consumer

| # | Decision | Owner (normative text) |
|---|---|---|
| **D162** | **THE RUN EXECUTOR IS THE ADMISSION KERNEL'S ONE PRODUCTION CONSUMER — `ctx.providers`/`ctx.artifacts` ARE WIRED, AND THE GUARD ARMS RELAX TO EXACTLY THAT.** `RunExecutorDependencies` GAINS TWO OPTIONAL SEAMS — `providers` (`RunProviderWiring`: ADAPTER REGISTRY, `providerAdmissions` REPOSITORY, `configSnapshots` REPOSITORY, ADMISSION ID FACTORY) AND `artifacts` (THE KERNEL WRITER). `executeTaskNode` REFUSES A DECLARING CONTRACT WITH A STRUCTURED NODE FAILURE WHEN ITS SEAM IS ABSENT, OR WHEN THE RUN's RETAINED `configSnapshotId` RESOLVES TO NO STORED ROW — THE SNAPSHOT IS READ FROM AUTHORITY BY THE ENVELOPE's OWN ID, NEVER RE-RESOLVED FROM CURRENT CONFIG (D116's IDENTITY, APPLIED TO ADMISSION). `invokeTask` MINTS ONE ADMITTED CLIENT PER DECLARED CAPABILITY PER INVOCATION, BOUND TO THAT EXACT SNAPSHOT AND THE INVOCATION's DEADLINE-BOUNDED SIGNAL; `ctx.artifacts` ATTACHES ONLY WHEN DECLARED. THE WORKER LOOP FORWARDS BOTH SEAMS VERBATIM; `composeWorkerRuntime` COMPOSES THE WRITER UNDER THE ISOLATION-PINNED ARTIFACT ROOT PLUS ONE GEMINI `ocr.extract` ADAPTER OVER ONE KEY AND ONE MODEL (`OCR_GEMINI_MODEL_ID` WITH PROVENANCE, FRONT-RUNNABLE BY `OCR_GEMINI_MODELS`); NO KEY COMPOSES AN **EMPTY** REGISTRY WITH A LOGGED WARNING, SO A DECLARING RUN IS DENIED `adapter-unavailable` BY ADMISSION — LOUD AND DURABLE, NEVER A GUESSED CLIENT. THE `provider-capability-boundary` ARMS RELAX TO EXPLICIT ALLOWLISTS (MINT+TYPE: KERNEL AND EXECUTOR; IMPORT: EXECUTOR AND COMPOSITION ROOT); EVERY OTHER MODULE STAYS CONFINED, AND THE POOL REMAINS 2h-D. | doc 06 §4.11 (primary); doc 01 §3.4; `src/core/run-executor.ts`; `src/core/worker-loop.ts`; `src/server/worker/compose.ts`; `tests/unit/run-executor-capability-wiring.test.ts`; `tests/unit/architecture/provider-capability-boundary.test.ts` |
| **D163** | **THE ROSTER STORE LANDS WITH THE PORT SPLIT DOC 06 §4 DEMANDED — TIERS VERBATIM, SCORING REDESIGNED AND FLAGGED.** `roster/match-spreadsheet` MATCHES CALLER SUBJECTS AGAINST AN OPERATOR-MAPPED ROSTER: THE CONFIDENCE→TIER BUCKETING PORTS **VERBATIM** (`legacy:src/dashboard/components/ocr/shared/match-confidence.ts` AT `0fd181c2`) INTO THE ONE DOMAIN MODULE THE TASK AND THE FUTURE BADGE SHARE; THE NAME PRIMITIVES PORT WITH PROVENANCE (`match.ts` AT `ab9ab5ab`, `levenshtein.ts` AT `c5caad80`); THE COMPOSITION IS **REDESIGNED, NOT CLAIMED LIVE-VERIFIED** — RE-VERIFY AT THE ROSTER MIGRATION. FAIL-CLOSED VERDICTS: `name-eid-conflict` REPORTS CONFIDENCE 0, A CLAIMED EID IS NEVER OVERRIDDEN BY A NAME-MATCHED DIFFERENT ONE, A TOP-SCORE TIE BETWEEN DISTINCT EIDs IS `ambiguous`, AND A SUB-FLOOR BEST REPORTS ITS HONEST NEAR-MISS SCORE UNDER `no-match` — `matchedEid` IS NULLABLE AND NEVER FABRICATED. THE LLM DISAMBIGUATION ARM AND `correctNameSpelling` DID NOT PORT. AS-BUILT DEVIATIONS FROM THE SKETCH: `subjectId` = `ItemId | StableRecordId` (THE SKETCHED `StableItemIdSchema` WAS NEVER BUILT), OUTPUT WRAPPED AS `{ matches }`, `readAt` + OPTIONAL `sheet` JOIN THE INPUT, AND `mapping-mismatch`/`no-eid-column` JOIN THE ERROR CODES. THE MAPPING IS APPLIED FAIL-CLOSED (RE-DETECTED COLUMNS MUST REPRODUCE ITS OWN HEADER FINGERPRINT), PARSING GOES THROUGH THE ONE SHARED GRID EDGE LIFTED FROM `extract-spreadsheet` (`src/stores/common/spreadsheet-grid.ts`), AND A CELL FAILING CANONICAL COERCION NULLS THAT FACT ON THAT ROW — COUNTED, NEVER SWALLOWED. | doc 06 §4 (primary); `src/domain/matching/`; `src/domain/contracts/roster/match-spreadsheet.ts`; `src/stores/roster/`; `tests/unit/roster-match.test.ts`; `tests/scenario/roster-match.scenario.test.ts` |
