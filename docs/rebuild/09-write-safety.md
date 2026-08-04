# 09 — Write-Safety: Fenced, Fail-Closed Real HR Mutations

Status: **Phase 1c write-safety authority shell completed 2026-08-01; revised 2026-07-22 after the
whole-plan/legacy-code review; amended 2026-07-26
(Round 8), 2026-07-31 (Round 10 — ordered actor-attributed ledger now; hash/tail tamper evidence
deferred by D79), and 2026-07-31 (Round 11 — standalone rebuild repo, D93: every path below is
inside the rebuild repo, so rebuild code sits at plain `src/` and the fence/authority database is
the rebuild repo's own `state.db`), and 2026-08-02 (Round 18 — the complete Phase-1f beat-⑦
transaction and recovery-before-requeue ordering are ratified).** Round-8 amendments: **§13 OQ1 is RESOLVED** — the 2026-07-23 live probe proved Kuali
`save-verify` is buildable and produced four binding constraints on it — **OQ2 (OnBase) is restated
as blocked on a real upload target**, and **§14 designs the identity-approval gate** (D77
ALWAYS-GATE), the control that guards the wrong-**person** class this doc's fence explicitly cannot.
The write sequence includes
a fresh expected↔observed binding proof on the staged page before the fence, and crash recovery now
requires stabilized typed negative evidence before another generation may submit. The guarantee is
stated at the boundary the UI targets can actually support; this doc does not claim unconditional
distributed exactly-once from a browser probe.

This is the highest-stakes doc in the rebuild. It governs whether a real, sometimes irreversible HR
transaction (a UCPath termination, a ServiceNow ticket, a Kuali save, an OnBase filing) is protected
from duplicate unattended attempts and reported **done only when we are sure it landed**. The operator's non-negotiable
(charter §13, 2026-07-18): *"you have to be very sure they were completed"* — completion is
**FAIL-CLOSED everywhere**: an unknown or unverifiable result is **never** treated as done.

## Ownership (D1 — this doc owns / this doc references)

| This doc **owns** (siblings reference, never redefine) |
|---|
| The **write-safety contract** — the required `WriteSafety` field on a commit task, typed proof schema for every completion kind, idempotency probe/key, and fail-closed verdict protocol |
| The **kernel write sequence** — resolve/probe → prepare → subject bind → fence → external commit → proof → durable commit, and its ordering invariant |
| Fresh write-binding enforcement at the write seam and the subject-match/unscoped proof retained with the intent/ledger |
| The **crash-window fence** (`write_intents` SQLite table) and the **crash-recovery replay** (positive proof or stabilized negative-proof branching) |
| Typed, intent-generation-locked operator resolution for parked writes (confirmed present/absent; no generic Done/Retry) |
| **Double-submit prevention** — idempotency key derivation + the per-workflow probe-policy knob (§b) |
| The **immutable receipt/transaction ledger** — schema, location, ordered actor-attributed projection, never-pruned guarantee, what one entry records; hash-chain/tail-anchor is deferred by D79 |
| The **identity-approval gate** (§14) — the operator-confirmed subject selection that guards the wrong-**person** class, its resolver payload, staleness rule, and composition with the subject proof. *(Gate NODE mechanics — park/resume, subscriptions, command arm — are doc 02/03's; this doc owns what this particular gate asks and what its answer authorizes.)* |

| This doc **references** (owner) |
|---|
| `PrepareTaskContract`/`CommitTaskContract`, transaction-scoped dry-run composition, `MutationCapability`, error taxonomy, freshness, stores → **doc 01** |
| Transaction nodes, gates + `PARKED(needs-operator)`, checkpoint provenance/fingerprints, declared dependency DAG, `RunEnvelope` → **doc 02** |
| Span/note wire schema, isolated `.tracker-rebuild/` layout, SQLite system-of-record vs projection split (D14), completion fan-out union → **doc 03** |
| The injectable Clock (all timestamps), per-run test/prod instance selection, the config/secrets domain → **doc 11 (clock/config/secrets)** |
| The fill↔submit pairing guard + dry-run composition guard → **doc 10 (guard-architecture)** |
| Subject declarations, semantic `ObservationId`, driver evidence/bundles → **docs 01 and 12** |

Amendments at sibling seams (each is a one-owner-per-concept addition, not a redefinition):
- **Doc 01 §2.2** — `CommitTaskContract` requires `writeSafety`; its shape is owned here.
- **Doc 01 §6.2** — the mutation primitive requires both `CommitTaskCtx.mutation` and an open fence.
- **Doc 02 §5.6 #2 / §OQ2 (per D17 — doc 02 OWNS and adds these).** "Crash-mid-write always parks"
  becomes **probe-then-park**, and the transaction node gains required `probePolicy` and
  `probeToFenceMaxMs` fields.
  Doc 02 owns those fields; this doc owns only the recovery-probe *mechanism* they invoke.
- **Doc 03 §2.1 / §2.3 (per D21 — doc 03 OWNS and adds these).** The `ledger/` dir (never-pruned
  retention floor) and the `write_intents` **system-of-record** table live in doc 03's storage
  layout; this doc owns their *shape/semantics*, not their placement in the rebuild state tree.

---

## Phase 1c Stage A as-built contract delta (2026-07-31)

`src/domain/write-safety.ts` now implements the dependency-free strict shell described below:
evidence-qualified `ProbeVerdict`, stabilized versus operator-only negative-settlement policy, a
Clock-injected pure evaluator, the closed `SubjectProof | UnscopedBindingProof` union, reviewed
unscoped-reason registry, and permanent intent/attempt record schemas. A bare `absent`, an early or
single negative, an ambiguous/unknown/present verdict, a different key/query/source/state, or an
operator-only policy cannot produce `safe-to-retry`.

`src/domain/ledger.ts` and `src/domain/outbox.ts` add strict schema-hash-bound ledger payloads and
the two closed atomic beat-⑦ payload arms (`ledger-entry` and `write-committed-span`). They are
durable shapes only. Stage A includes no browser commit task, mutation capability, fence store,
sequencer, projector, recovery service, or external HR call, and therefore does not claim the write
sequence is implemented. Phase 1c remains in progress.

---

## Phase 1c Stage D as-built authority-write delta (2026-08-01)

Stage D implements the storage-level write-safety invariants item 1c owns. Natural idempotency keys
are strict, system-scoped values; their SHA-256 digest is derived with a versioned domain separator
and is revalidated anywhere an intent, ledger payload, or terminal span crosses a schema boundary.
Binding-proof digests are derived from canonical parsed proof JSON and revalidated on both intent
and attempt. The native authority adapter serializes unseen-key fencing with `BEGIN IMMEDIATE` and
the durable `(system,idempotency_key)` uniqueness constraint, so later sequential starters and
independently opened competing connections observe the original intent across `attempting`,
`committed`, and `observed-present` states. A live `observed-present` record creates no attempt and
no write ledger/span outbox.

The Clock-injected negative-settlement evaluator now counts only distinct, schema-valid
observations at or after `fencedAt + minSinceFenceMs`, separated by at least
`minBetweenReadsMs`, and bound to the exact fenced digest, authoritative query, observation source,
and source state. Early or single observations have zero retry authority. Duplicate, future,
out-of-order, wrong-boundary, present, ambiguous, unknown, malformed, or operator-only evidence
cannot become `safe-to-retry`; inconsistent evidence parks and malformed boundary input fails loud.

The strict generic `TransactionOutcome` and atomic-commit contracts bind the accepted completion
proof to both durable outbox arms and require the ledger and terminal-span arms to carry one trace
identity. At commit, subject-scoped ledger evidence must exactly equal the fenced proof's expected
subject; an explicitly unscoped proof requires an explicitly absent ledger subject. One native
transaction updates the current intent and attempt and inserts the ledger and terminal-span outboxes. Failure injected after each storage step proves
all-or-none rollback with no generation advance. The active `permanent-key-dedupe`,
`recovery-negative-proof-settlement`, and `atomic-write-outbox` guards pin these properties over
real temporary SQLite databases and manual-Clock boundaries.

This completes **Phase 1c's type and authority-storage shell only**. No commit task, mutation
capability, browser click, live probe, positive-recovery service, parked-intent command, worker,
sequencer/projector, route, UI, or external HR transaction exists yet. The complete kernel write
sequence remains item 1f; ordered ledger/span projection remains 1g-spine; controlled external-write
proof remains Phase 2. Phase 1d is next, and Phase 1 is not complete.

## Phase 1f write-sequencer ratification (2026-08-02)

Phase 1f may reuse Phase 1c's narrow `commitWriteAttempt` storage primitive, but that four-row
primitive is not itself the kernel's beat ⑦. The write sequencer enters one outer authority
transaction, revalidates the current run claim generation and intent/attempt generation, invokes
the primitive, writes the schema-valid `TransactionOutcome` checkpoint, inserts every required
ledger and same-trace terminal-span/generic-outcome outbox, attaches a real evidence-receipt ref
when the 2g receipt service is active, and transitions the run. The transaction commits once or
not at all. A missing pre-2g receipt ref is represented as absent and never fabricated; after 2g
activates its terminal-receipt invariant, a terminal transition requiring that receipt cannot
commit without it. Crash injection after every substep must leave either the entire accepted
bundle or the prior `attempting` state with no checkpoint/run/outbox advance.

Recovery has scheduling priority over claim expiry. A dead/expired worker claim whose run owns an
unfinished `attempting` intent is routed to the probe/settlement state machine below before any
generic interrupted→queued transition. Until recovery produces validated present proof, validated
safe-to-retry/confirmed-absent authority, or a parked operator state, ordinary workers cannot claim
that run. Failure to read or reconcile intent authority is a loud park/refusal, never evidence that
no write is unfinished.

---

## Phase 2 transaction-proof as-built — the DRY-RUN half (2026-08-04, D122)

The first `effect:"commit"` contract in this tree exists, and its whole
fail-closed spine is proved end to end WITHOUT a real external write.

**The target.** `kuali/save-timekeeper-annotation` writes the `Timekeeper Name:*`
field of a Kuali RRSS Separation Request Form, reached by its
`…/build/space/<space>/actions/<actionId>` deep link. It is the smallest
genuinely reversible target the docs authorize: a benign annotation the legacy
flow already fills on drafts, restorable by writing the previous value back
(prepare captures and returns it), and the exact field the operator authorized
for the 2026-07-23 write round-trip on doc 4444 (D78). Its workflow —
`kuali-timekeeper-annotation`, one transaction node — is deliberately NOT
separation-class: it files nothing, so §14's ALWAYS-GATE does not attach, and
claiming it would misdescribe what the graph does. The identity control is the
kernel's own beat-③ binding against the document's displayed EID. **The operator
ratified that scope on 2026-08-04 (D127): this workflow takes NO identity-approval
gate, and §14.8 records the two facts the exemption rests on plus the boundary at
which it expires.** It is scoped to this graph and is not a general waiver of D77.

**The completion arm can only be `save-verify`.** Kuali's save is UI-silent, so
`kuali/verify-timekeeper-annotation` RELOADS the document and reads the field
back; every verdict but `present` parks (§7 row 6). The commit's own output
carries the exact staged state it clicked Save on — a claim, never proof — and
nothing in the kernel promotes it. `verify` is a distinct contract from the
`idempotency.probe` on purpose: a verifier that was the probe would never
reload.

**`recoveryAbsence` is `operator-only`, and that is a measurement gap, not a
judgement about Kuali.** Kuali's negative read is the same deterministic field
read its positive uses. What is missing is a MEASURED propagation window, and
measuring one requires the controlled commit that has not been authorized.
Inventing `minSinceFenceMs` would be exactly the plausible-but-unverified
constant this program bans, so every post-fence absence parks. When the
controlled commit lands and supplies real numbers, this may become `stabilized`
— that is the one contract field the commit is expected to change.

**The mutation-capability registry moved to `src/base/mutation-capability.ts`.**
Beat ⑤ requires the external-write helper to throw BEFORE the click, and that
helper is a `stores/**` driver, which the layer matrix forbids importing `core`;
minting also needs a type assertion, which no `src/domain/**` boundary source
may contain. `src/base/` is the one place both hold. `src/core/write-sequencer.ts`
remains the sole permitted CALLER of `mintMutationCapability`, now enforced
mechanically: `task-driver-boundary` fails if any other module names it, and
that same guard's blanket "no commit implementations" rule became its real
condition — a `commit` implementation is legal only inside a store driver owner
that validates its capability.

**What the dry-run half proves, durably.** `tests/scenario/kuali-timekeeper-annotation.scenario.test.ts`
and `tests/unit/kuali-transaction-proof.test.ts` drive the REAL sequencer over a
REAL temporary authority database and a deterministic Kuali document. A dry run
opens the document, stages the value, observes the subject — and leaves
`write_intents`, `run_checkpoints`, and `durable_outbox` empty, with no minted
capability and no commit span. A subject that changes AFTER prepare (the pooled-
page case §2.1 names) produces zero fence and zero click on a page that WAS
staged; so does an unreadable EID, at beat ③ and at beat ①. An expired
probe→fence budget discards the staged page. A UI-silent save that did not
persist reads `absent` and parks with the fence durable; a post-fence throw and
a failed read-back both park `unknown`; a parked key refuses every later fence.
Permanent-key dedupe and byte-exact checkpoint replay both prove zero second
clicks.

**What the dry-run half does NOT prove, and must not claim.** No external HR
write has occurred. The crash-injection matrix across a REAL commit, the
ledger/span projections of a real fenced attempt, `stabilized` negative
settlement with measured numbers, and context cleanup after a real submit all
belong to the controlled commit. So does the interpreter's dry-run PREVIEW
outcome arm: `executeDryRun` exists and is proved, but `run-executor` still
refuses a dry run at a transaction node rather than terminating the run at it,
because "a dry run ends the run at the node" (doc 01 §6.2) has no durable
run-lifecycle arm yet — inventing one would touch doc 03's operator status
vocabulary, which is 2i's to change. Recorded as an open item rather than
guessed.

---

## Phase 2 controlled-commit as-built — the WRITE half is BLOCKED (2026-08-04, D128)

The operator authorized ONE controlled real commit on named sacrificial Kuali
RRSS documents **4489** and **4490**. It was attempted. **It fenced, it clicked
Save, and it could not land** — and the reason is a property of the target, not
of this kernel.

### What the documents are (confirmed read-only before any write)

| | 4489 | 4490 |
|---|---|---|
| action id | `6a712bf32ff7fb799788a79e` | `6a712d29ca464caf7bd9e633` |
| title | `Form - RRSS Separation Request Form - Kuali` | same |
| H1 / displayed EID | `4489` / `10001828` | `4490` / `10631689` |
| workflow step | `Task 1 - Kristina & TES` | same |
| `Timekeeper Name:*` BEFORE | `""` | `""` |
| `Save` / `Send Back` / `Mark Complete` | exactly 1 each | exactly 1 each |

### The finding: a FIELD's writability is a property of the workflow STEP

The commit clicked `Save`. Kuali answered `200` on its `submitDocumentV2`
mutation and rendered a **`Form saved`** status node. The reload read-back read
`absent`, and an independent read minutes later confirmed the field was still
empty. Capturing the mutation body settled why:

```
{"operationName":"submitDocumentV2","variables":{"documentId":"…","data":{
   "-QcO_b5Pil":{…},"9nJKKhG2wT":{…},"ER1WhBzjcm":…,"NYHPLZtn0g":{…},
   "cEPl6poKIz":"…EID…","fRD9muFvzN":"…name…","oEcp1xtQkj":…,
   "uEYp9lpmFg":{…},"zxtLoFSehG":"ECEC"},
 "actionId":"…","status":"saved","timeZone":"America/Los_Angeles"}}
```

The timekeeper control is DOM id `BWmkKqx40`. **It is absent from `data`.** The
save carries only the fields belonging to the CURRENT workflow step's section.
This was verified not to be a staging artefact: the control is neither
`disabled` nor `readOnly`, and React's own `memoizedProps.value` held
`PROBE-DELETE-ME` under BOTH `fill()` and real key events
(`clear()` + `pressSequentially`) — the value was in application state and was
still not submitted.

This generalizes the store's existing "an `actionId` names a workflow STEP, not
a document" lesson one level deeper: **a field being rendered and editable is
not evidence that the current step can write it.** The 2026-07-23 probe (D78)
succeeded on doc 4444 because that document was at a step that owned the field.
Docs 4489/4490 are not, so they are not a valid target for this write, and the
authorization forbids substituting a different document.

### Measured numbers (the propagation window, as far as it can be measured)

Doc 4490, raw-driver instrument, two save cycles:

| Observation | Cycle 1 (write) | Cycle 2 (restore) |
|---|---|---|
| first non-GET `kualibuild` POST after click | +241 ms | +254 ms |
| last save-related POST | +3 655 ms | +3 455 ms |
| `networkidle` | +4 157 ms | +3 957 ms |
| `Form saved` status node | present | present |
| reload read-backs | 6 reads, +6 857 → +18 759 ms, ALL `absent` | value (empty) observed at +6 519 ms |
| full document open (cold / warm) | ~6 s / ~2.1 s | |
| dry run, whole beat ② + ③, warm session | 8.3 s | |
| TritON SSO + Duo Autopilot, cold profile | ~90 s to the Kuali space | |

**`recoveryAbsence` therefore STAYS `operator-only`.** The controlled commit was
supposed to be what earned `stabilized`; it could not, because a write that
never lands measures no propagation window at all. Writing a `minSinceFenceMs`
from these numbers would be the plausible-but-unverified constant this program
bans. The contract field is unchanged and the reason text still holds.

### What the kernel did, and the durable rows it left

Exactly right, and they are still in `.tracker-rebuild/state.db`:

- `write_intents` — ONE row, key
  `kuali:4489|6a712bf32ff7fb799788a79e|timekeeper-name|10001828|PROBE-DELETE-ME`,
  intent `9545fdf9-ae3a-4d9a-b2dd-109e07e5a575`, generation 1, `fencedAt`
  `2026-08-04T15:13:25.191Z`, **status `parked`, code `unknown`**, carrying the
  full `subject-match` binding proof (EID suffix `5513`, digest
  `d77e42b6…`, page state `kuali.rrss-document.timekeeper-staged`).
- `write_attempts` — ONE row, generation 1, outcome `{state:"parked"}`.
- `run_checkpoints`, `durable_outbox` — **ZERO rows.** No transaction-output
  checkpoint, no ledger entry, no terminal span: an unverified save is never
  done, so none of the beat-⑦ bundle was written.
- the run is `parked-write` on that intent.

**The intent is deliberately LEFT PARKED.** A human decision is genuinely
required (the target is not writable at this step), so `confirmed-absent` — which
would mint retry authority — would be the wrong answer, and `confirmed-present`
would be a lie. A later fresh run on the same permanent key was executed live and
refused in **1 ms, with zero browser sessions**: *"…is parked (unknown: …); only
the typed operator resolutions may release it."* That is the honest live form of
the permanent-key dedupe criterion.

### Exit-criteria status

| Doc 07 Phase-2 write criterion | Status |
|---|---|
| dry run: staged preview + subject observation, zero intent/fence/commit/click | **MET live** on doc 4489 (`prepare` returned `previousTimekeeperName:""`, `stagedTimekeeperName:"PROBE-DELETE-ME"`; subject `match` on EID suffix `5513`; zero durable rows) |
| forced mismatch: no intent, no click | **MET live** — refused at beat ② with `subject-mismatch`, *"refusing to leave a staged value on another person's document"*, zero durable rows |
| ONE external transaction → committed intent + typed checkpoint + validated proof + ledger entry + terminal span | **NOT MET.** One external transaction occurred; it produced no landing proof, so the kernel produced none of the five rows. Blocked on a writable target, not on the kernel |
| permanent-key dedupe: a later fresh run performs no second click | **MET live in its parked form** (see above); the committed-key form stays fixture-proven |
| measured propagation window → `stabilized` | **NOT MET** — unmeasurable without a landing write; `operator-only` stands |
| restore the original value | **N/A and verified** — the original value was `""` on both documents and still is. Doc 4489's whole form was re-dumped and is semantically identical field-for-field (only Kuali's per-render element ids differ) |
| crash matrix, recovery arms, context cleanup, multi-worker exclusive lease | **MET in repeatable fixtures** over the real Kuali store + a real authority database (`tests/unit/kuali-transaction-proof.test.ts`) |
| ledger projector concurrency / tail-loss | **NOT BUILDABLE YET** — beat ⑦ writes the ledger `durable_outbox` row (schema and atomicity landed in 1c), but the serialized ordered JSONL projector is a 2g tail and does not exist. There is nothing to test concurrency or tail-loss against, and no fixture may pretend otherwise |

### Two defects this lane found outside the write path (D129 · D133)

1. **Kuali Build is client-rendered, and two probes sampled it once.** The login
   recipe's positive fact and `openDocument`'s heading read both counted a node
   the instant the URL settled. Measured: the space paints zero `[role]` nodes at
   `domcontentloaded` and its menubar ~1 s later; the document route shows
   `["", "Action", "Action List"]` at ~1.5 s and `["4489", …]` at ~3.0 s. Both are
   fixed as BOUNDED WAITS FOR THE SAME FACT — the heading recipe additionally
   NARROWED to a level-1 heading whose accessible name is a bare document number,
   requiring exactly one.
2. **A required config leaf bricked every pre-existing authority database.**
   `timeouts.sessionAcquireMs` (D125) was added to the config schema with a
   default for FRESH configs but no path for already-durable `config_snapshots`
   rows, and those parse strictly at database OPEN. Every rebuild runtime command
   on a pre-D125 `state.db` now fails to start. The Phase-1 exit database was
   preserved unmodified at `.tracker-rebuild/phase1-exit-state.db*` and this lane
   ran on a fresh one. **Open, doc 11's to own:** back-filling the default would
   fabricate a bound the old runs never had (the D109 precedent invalidates such
   rows rather than inventing values), and failing at OPEN denies access to every
   unrelated row including the ledger. Neither half is decided here.

### What is required before this criterion can be met

A target document at a workflow step that OWNS the field being written, named by
the operator. The kernel, the contract, the store, the driver, the fence, the
binding proof and the fail-closed completion arm are all proven; what is missing
is a write that can land. Until then Phase 2's write half is **BLOCKED**, and
doc 07's rule stands: write-heavy workflow migration may not begin.

---

## 0. Grounding — what exists today (the port inventory, real code)

Every row below is live-verified leaf knowledge the charter forbids re-deriving. It ports, wrapped.

| System | Confirmation today | Grounding (file:line) | Verdict |
|---|---|---|---|
| **UCPath** | Strong. `waitForTransactionOutcome` polls {error banner} vs {success marker}, error wins ties, and **RETURNS `"timeout"`** when neither appears; its caller **`clickSaveAndSubmit` then throws** *"…PeopleSoft's outcome is unknown, refusing to report success."* (`transaction.ts:855-859` — the throw is the caller's, not the poller's). T-number scraped by a second nav that re-finds the row **by EID (Person ID), not name**, and parses `Transaction ID: T…`; readback failure returns `""` which callers MUST treat as "couldn't read back," never "no transaction." **Amended 2026-08-04 (D130): "Strong" overstated it — the readback is STATUS-BLIND.** The live probe proved a Denied transaction carries a well-formed `T…`, so parsing the number says only that a submit happened; the port must read the approval status alongside it (§13.6). The body-text scrape's last regex arm (`\b(T\d{6,})\b`, `transaction.ts:1319-1328`) is also unanchored — it takes whichever number appears first, and the detail page carries a second one in its approval strip. | `ucpath/transaction.ts:42-66, 835-861, 919-985, 1310-1328`; oath sibling `oath-signature/enter.ts:281-284` | Ports → `receipt` capture |
| **ServiceNow** | Medium. Only truly-positive receipt: `waitForURL` for a changed URL containing `number=`, parse `/^HRC\d{6,}$/`; **throws** *"no number= param in post-submit URL"* if absent. | `oath-upload/fill-form.ts:140-173` | Ports → `receipt` capture |
| **Kuali** | **NONE.** `clickSave` = click + `networkidle(15s)` + 2s sleep + `log.success`. Error detection was **deliberately removed** as false-positive-prone (matched benign DOM). Weakest of all. | `kuali/navigate.ts:634-652`; `kuali/CLAUDE.md` gotchas + 2026-04-10 lesson | **Must EARN a `save-verify` read-back** |
| **OnBase** | **NONE (negative only).** Success = the import postback landed on a page that is *not* a recognized ASP.NET error (`authenticated` OR `unknown` both pass). No positive "filed" signal. One-app-session-per-identity: never two logins at once. | `onbase/handler.ts:208-217`; `onbase/page-state.ts:149`; `onbase/LESSONS.md:137-176` | **Must EARN an `upload-verify` read-back, or allowlist unverifiable→always-park** |
| **Idempotency** | No keys, live-page probes, biased **fail-open→SUBMIT**. Onboarding `findExistingHireTransaction` (by name, hires have no EID) skips only on a high-confidence HIR/REH+effdt match; *"a false skip would silently never hire the real person, which is worse than the probe-guarded double-submit."* Separations `findExistingTerminationTransaction` (EID+effdt+"Terminatn"); the REAL guard is the **date-agnostic** `deletePendingTransaction` sweep that clears ALL in-progress Terminat rows for the EID. | onboarding `workflow.ts:488-521`; separations `steps/ucpath-transaction.ts:83-104`, `transaction.ts:1167`; `control/CLAUDE.md:36` ("no idempotency cache") | Ports → probes, **verdict widened to 3-valued** |
| **Crash window** | **oath-upload ONLY.** `submitAttempted:"true"` marker stamped **before** the POST (durable via the next `step=submit` emit); `hasUnverifiedPriorSubmit` refuses+escalates on recovery; `findPriorTicketForSession` (recorded ticket wins). SQLite fast-path + JSONL fallback so a retry's own rows can't mask a prior crash. | `oath-upload/handler.ts:249,273,309,388-454` | **Generalized into the kernel fence + recovery probe** |

**The two incidents this layer exists to make impossible:**
- **Duplicate person** (`ucpath/LESSONS.md:209-216`, 2026-07-01): a single dialog probe read too
  early classified a rehire as a new hire ⇒ onboarding created a duplicate person.
- **Wrong-person termination `T002173685`** (`separations/CLAUDE.md`, 2026-06-29): a name-search
  override date-matched a *different* career employee and filed a real termination against him —
  still needing manual reversal. **Honest scope:** that was a *wrong-data* error, not a duplicate.
  Idempotency prevents **double-filing**. Two distinct wrong-person paths now have distinct guards:
  upstream source/selection ambiguity is blocked by doc 02 freshness + the identity-approval gate;
  stale browser state showing a different person after correct selection is blocked here by a fresh
  subject observation on the exact staged page before fencing. The immutable ledger then makes any
  residual wrong-data filing attributable and reversible instead of burying it in row snapshots.

---

## 1. The one-sentence thesis + the fail-closed guarantee boundary

> **Every `effect:"commit"` task declares typed proof-of-landing (a receipt, saved-state proof, or
> uploaded-artifact proof)
> and an idempotency probe; the kernel drives a fixed resolve/probe → prepare → **binding proof** →
> fence → external commit → proof → durable-commit
> sequence around it; and every "is it done / is it already there?" question is answered by a
> FOUR-state verdict where both positive and negative claims carry evidence and `unknown` blocks —
> never a boolean that lets uncertainty read as success.**

The single mechanism that makes fail-closed structural is the **`ProbeVerdict`**: a probe or verify
read cannot return `true/false`. It returns `present | absent | ambiguous | unknown`. `present`
requires landing proof; `absent` requires typed observation evidence. `unknown` and `ambiguous`
route to `PARKED(needs-operator)` — never to a submit and never to a "done." After a fence, even an
evidenced `absent` must satisfy §4's propagation/consistency policy before retry authority exists. This
directly dissolves today's fail-open dichotomy (onboarding: *"skip and never hire" vs "blind
double-submit"*): the third answer is **park and let the operator decide**, which is strictly safer
than both.

**Guarantee boundary (D64).** The permanent key/CAS guarantees at most one unattended commit
attempt per intent generation. The kernel automatically converges to done from valid positive proof
or to a new generation from contract-valid stabilized negative proof. If the external UI cannot
authoritatively prove absence after its propagation window, recovery parks for operator resolution.
That is enforceable. “Exactly once against every remote UI regardless of consistency” is not.

---

## 2. The write-safety contract

### 2.1 The `WriteSafety` field (owned here; attached to doc 01's `CommitTaskContract`)

```ts
// src/domain/contracts/write-safety.ts — bundle-safe: imports zod + TaskId ONLY (D3 guard)
import { z } from "zod";
import type { TaskId } from "./base.js";

/** Fail-closed verdict factory. `present` cannot exist without proof of the exact schema
 * required by the commit's completion arm; `absent` cannot exist without typed evidence of the
 * exact key/query/state observed. There is deliberately no untyped/boolean form. */
export const AbsentEvidenceSchema = z.strictObject({
  idempotencyKeyDigest: Sha256Schema,
  source: ObservationIdSchema,
  sourceState: PageStateIdSchema,
  observedAt: IsoInstantSchema,
  queryDigest: Sha256Schema,
  evidenceRef: EvidenceRefSchema,
});
export function probeVerdictSchema<Proof extends z.ZodType>(proofSchema: Proof) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), proof: proofSchema }),
    z.strictObject({ state: z.literal("absent"), evidence: AbsentEvidenceSchema }),
    z.strictObject({ state: z.literal("ambiguous"), matches: z.number().int().min(2) }),
    z.strictObject({ state: z.literal("unknown"), reason: z.string().min(1) }),
  ]);
}
export type ProbeVerdict<Proof extends z.ZodType> =
  z.output<ReturnType<typeof probeVerdictSchema<Proof>>>;

interface ProofCheck<Out extends z.ZodType, Proof extends z.ZodType> {
  /** The same parser validates normal commit output and recovery-probe backfill. */
  proofSchema: CanonicalJsonSchema<Proof>;
  proofFromOutput: (output: z.output<Out>) => z.input<Proof>;
  proofFromPresentProbe: (
    verdict: Extract<ProbeVerdict<Proof>, { state:"present" }>,
  ) => z.input<Proof>;
  /** Recovery/preflight-present must reconstruct the transaction node's full typed output; proof
   * alone is not a substitute for fields downstream nodes consume. Both schemas are parsed. */
  outputFromProof: (proof: z.output<Proof>) => z.input<Out>;
}

/** UCPath / CRM / ServiceNow — irreversible submits capture a verifiable receipt. */
export interface ReceiptCheck<Out extends z.ZodType, Proof extends z.ZodType>
  extends ProofCheck<Out, Proof> {
  kind: "receipt";
}
/** Kuali — typed saved-state proof, not merely a boolean/present verdict. */
export interface SaveVerifyCheck<Out extends z.ZodType, Proof extends z.ZodType>
  extends ProofCheck<Out, Proof> {
  kind: "save-verify"; verify: TaskId;
}
/** OnBase — typed artifact proof from a positive read-back. */
export interface UploadVerifyCheck<Out extends z.ZodType, Proof extends z.ZodType>
  extends ProofCheck<Out, Proof> {
  kind: "upload-verify"; verify: TaskId;
  /** Escape hatch (allowlisted + argued in doc 10): the page genuinely cannot prove landing. Then the
   *  submit ALWAYS parks needs-operator for manual confirmation — it never auto-reports done. */
  unverifiableByPage?: {
    reason: string;
    /** Must parse through proofSchema and exercise its operator-attestation discriminant. The
     * runtime replaces example values with the authenticated operator/Clock/evidence form. */
    operatorAttestationExample: z.input<Proof>;
  };
}
export type CompletionCheck<Out extends z.ZodType, Proof extends z.ZodType> =
  | ReceiptCheck<Out, Proof>
  | SaveVerifyCheck<Out, Proof>
  | UploadVerifyCheck<Out, Proof>;

export interface Idempotency<In extends z.ZodType> {
  /** A read task answering "is THIS exact transaction already present?" → ProbeVerdict. Runs
   *  pre-write AND on crash recovery. Declared with zero-age freshness (always live, never a stale
   *  checkpoint). Must resolve to a real effect:"read" task in the SAME store (guard §8). */
  probe: TaskId;
  /** The natural idempotency KEY — derived from STABLE business identity, NEVER row/position/index
   *  (the doc1/doc2 fix, §5). e.g. `${eid}|termination|${effectiveDate}`. Pure. */
  key: (input: z.output<In>) => string;
  /** What may turn a post-fence absence into retry authority (D64). Waiting is scheduler requeue,
   * never a sleeping task/worker. `operator-only` is mandatory when the target has no trustworthy
   * negative read or bounded propagation behavior. */
  recoveryAbsence:
    | { kind: "stabilized"; minSinceFenceMs: number;
        consistentReads: 2 | 3; minBetweenReadsMs: number;
        requireSameSourceState: true }
    | { kind: "operator-only"; reason: string };
}

export interface WriteSafety<
  In extends z.ZodType,
  Out extends z.ZodType,
  Proof extends z.ZodType,
> {
  completion: CompletionCheck<Out, Proof>;
  idempotency: Idempotency<In>;
}
```

`CommitTaskContract<Id, In, Out, Proof, Codes>` requires
**`writeSafety: WriteSafety<In, Out, Proof>`**. There is
no optional escape hatch: even a naturally idempotent external write must declare its key, proof,
and probe. All three completion arms carry a nontrivial `proofSchema`; recovery and normal commit
use the same parser, and `outputFromProof` must reconstruct a value accepted by the commit output
schema for preflight-present/recovery paths. The kernel then wraps it in doc 02's discriminated
`TransactionOutcome`, so downstream code sees whether this run committed or found prior work.
Probe/verify tasks are separate reads in the same store. An
`unverifiableByPage` proof schema is a discriminated union with an `operator-attestation` arm
containing operator, confirmedAt, exact artifact/business identity, and a non-empty evidence note;
its example is guard-parsed. It may never be a bare boolean or generic “mark done.”

Every prepare/commit pair must also carry compatible doc 01 `SubjectBindingSpec`s. The kernel
materializes the following strict proof; raw sensitive identifiers are not duplicated into event
or ledger files—the normalized comparison happens in memory and evidence keeps a digest plus the
minimum display-safe suffix/name needed to diagnose a mismatch.

```ts
export const SubjectProofSchema = z.strictObject({
  kind: z.literal("subject-match"),
  version: z.literal(1),
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  leaseId: LeaseIdSchema,
  taskId: TaskIdSchema,
  observationId: ObservationIdSchema,
  pageStateId: PageStateIdSchema,
  expected: SubjectEvidenceSchema,
  observed: SubjectEvidenceSchema,
  match: z.literal("match"),
  observedAt: IsoInstantSchema,
  afterPrepareSpanPath: SpanPathSchema,
});
export type SubjectProof = z.output<typeof SubjectProofSchema>;

/** D65: a commit with an explicitly reviewed `subject.kind:"none"` does not fabricate a subject
 * match. It still proves the exact staged page/lease and reviewed contract reason. */
export const UnscopedBindingProofSchema = z.strictObject({
  kind: z.literal("unscoped"),
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  leaseId: LeaseIdSchema,
  taskId: TaskIdSchema,
  pageStateId: PageStateIdSchema,
  reviewedReasonId: UnscopedCommitReasonIdSchema,
  observedAt: IsoInstantSchema,
  afterPrepareSpanPath: SpanPathSchema,
});
export const WriteBindingProofSchema = z.discriminatedUnion("kind", [
  SubjectProofSchema,
  UnscopedBindingProofSchema,
]);
export type WriteBindingProof = z.output<typeof WriteBindingProofSchema>;
```

The proof is valid only for the same run, attempt, lease, task, and prepared page state, and only
until the configured probe-to-fence budget. It cannot be reused after navigation, page reset,
retry, or lease transfer. A file write binds the artifact digest/document id; a person write binds
the system's displayed EID or another contract-declared strong identifier; a catalog/global write
must explicitly declare `subject.kind:"none"` with a reviewed, allowlisted reason and produces the
unscoped arm above. Name-only identity is not a
strong write binding unless that system truly exposes no stronger value, in which case the task
requires an operator gate and a dedicated scenario.

### 2.2 Per-system instantiation (three shapes, one mechanism)

```ts
// UCPath termination — receipt-bearing (ports transaction.ts:919-985 into ucpath/read-transaction-number)
writeSafety: {
  completion: { kind: "receipt",
    proofFromOutput: (o) => o.receipt,
    proofFromPresentProbe: (v) => v.proof,
    outputFromProof: (p) => ({ receipt: p }),
    // The PAIR, never the number alone — settled by the 2026-08-04 live probe (§13.6).
    // A Denied UCPath transaction carries a perfectly well-formed `T…`, so the
    // earlier number-only schema accepted a REFUSED write as proof of landing.
    proofSchema: z.strictObject({
      transactionNumber: z.string().regex(/^T\d{6,}$/),
      approvalStatus: z.enum([
        "Approved", "Denied", "Error", "Manually Processed", "Pending", "Pushed Back",
      ]) }) },
  idempotency: {
    probe: "ucpath/find-existing-termination",                 // by EID + effdt + "Terminatn"
    key:   (i) => `${i.emplId}|termination|${i.effectiveDate}`,
    // Worked-example values only; migration must live-justify the real UCPath propagation policy.
    recoveryAbsence: { kind:"stabilized", minSinceFenceMs:30_000,
      consistentReads:2, minBetweenReadsMs:5_000, requireSameSourceState:true } },
}
// ServiceNow ticket — receipt-bearing (ports fill-form.ts:140-173)
completion: { kind: "receipt", proofFromOutput: (o) => o.ticketNumber,
  proofFromPresentProbe: (v) => v.proof, outputFromProof,
  proofSchema: z.string().regex(/^HRC\d{6,}$/) }
// Kuali save — save-verify, NO receipt (operator §13)
completion: { kind: "save-verify", verify: "kuali/read-saved-document",
  proofFromOutput, proofFromPresentProbe, outputFromProof, proofSchema: KualiSavedStateProof }
// OnBase upload — upload-verify, positive read-back OR allowlisted unverifiable→always-park
completion: { kind: "upload-verify", verify: "onbase/read-filed-document",
  proofFromOutput, proofFromPresentProbe, outputFromProof, proofSchema: OnBaseArtifactProof }
```

Kuali and OnBase are the one place the port is a **genuine addition** (§10): their submit tasks
cannot instantiate a passing `completion` without a new post-write read-back, because today they have
none. That is by design — the contract *forces* proof to exist.

---

## 3. The kernel write sequence

The kernel drives a fixed seven-beat sequence. It binds/parses the commit input first from workflow
input plus declared upstream outputs; commit input cannot depend on ephemeral prepare output. Beat ①
uses an ordinary read lease and releases it. Beats ②–⑥ use one uninterrupted exclusive transaction
lease, so a navigating probe can never destroy a staged form. Beat ③ is kernel-owned identity
binding on the exact staged page—no task callback can skip it. Dry-run composes beat ② only and has
no executable preflight/subject/fence/commit path or mutation capability. The impl author cannot
reorder the real-write beats.

```
① RESOLVE/PROBE → ② PREPARE → ③ BINDING PROOF → ④ FENCE → ⑤ EXTERNAL COMMIT → ⑥ PROOF → ⑦ DURABLE COMMIT
   read lease      transaction lease ──────────────────────────────────────────────────┘    DB + outboxes
```

**The same sequence with its crash seams and fail-closed exits.** Every ✗ is a park or a refusal,
never a fall-through; the only path to `done` runs the full spine. The seam that matters is between
④ and ⑦: a crash anywhere in there leaves a durable `attempting` intent, which is exactly what
recovery (§4) keys off.

```mermaid
flowchart TD
  A["① resolve + live probe<br/><i>read lease</i>"]
  A -->|"present (durable or live)"| AP["complete: already-present<br/>no click, no ledger row"]
  A -->|"ambiguous · unknown · throw"| PARK(["PARKED needs-operator"])
  A -->|"unseen / retryable key"| B

  B["② prepare<br/><i>transaction lease acquired</i>"]
  B -->|"failure / timeout"| REL["release poisoned page<br/>no external effect"]
  B --> C

  C["③ binding proof<br/>re-observe the staged page"]
  C -->|"mismatch · unknown · missing · stale"| NOFENCE["ZERO fence, ZERO click<br/>structured binding failure"]
  C --> D

  D["④ fence<br/>CAS permanent key → attempting<br/><b>durable before the click</b>"]
  D -->|"probe age elapsed · CAS lost"| DISCARD["discard staged page<br/>no click"]
  D --> E

  E["⑤ external commit<br/><i>MutationCapability bound to<br/>generation + proof digest</i>"] --> F
  F["⑥ capture / verify proof<br/>parse through proofSchema"]
  F -->|"absent · ambiguous · unknown · schema fail"| PARK
  F --> G["⑦ atomic durable commit<br/>intent + checkpoint + ledger outbox<br/>+ span outbox + run state"]
  G --> DONE(["done"])

  D -.->|crash| REC
  E -.->|crash| REC
  F -.->|crash| REC
  G -.->|"crash mid-transaction"| REC
  REC["recovery: re-run probe<br/>(§4)"]
  REC -->|"present + valid proof"| G
  REC -->|"absent, but only after the<br/>propagation window + repeated<br/>consistent observations (D64/D69)"| RETRY["new intent generation<br/>eligible to retry"]
  REC -->|"single / early absence<br/>· ambiguous · unknown"| PARK

  classDef bad fill:#00000000,stroke:#c0392b,stroke-width:1px;
  classDef good fill:#00000000,stroke:#27ae60,stroke-width:1px;
  class PARK,NOFENCE,DISCARD,REL bad;
  class DONE,AP good;
```

| Beat | What runs | What is DURABLE at end of beat | Fail-closed exit |
|---|---|---|---|
| **① Resolve + live probe** | From the already parsed stable commit input, derive the key and read the permanent `write_intents` row regardless of status/originating run. `committed` or `observed-present` ⇒ validate/reuse proof+typed output; `attempting` ⇒ recovery/owner check; `retryable` ⇒ eligible generation. Only an eligible unseen/retryable key may run the policy-controlled live probe, on a separate read lease. Record probe completion monotonic time. | one SQLite transaction records an unseen live `present` permanently as `observed-present`, checkpoints `TransactionOutcome{disposition:"already-present",proofSource:"live-probe"}`, advances run state, and enqueues its audit span—but **no write-ledger row** | invalid stored proof/output ⇒ corruption/park; attempting owner live ⇒ wait/fail loud; stale owner ⇒ recovery first; live `present` ⇒ typed no-click completion; ambiguous/unknown/throw parks |
| **② Prepare** | Acquire the context-exclusive transaction lease and run the prepare contract. The parsed commit input is already frozen; prepare output is preview/span data only. Retry may restart from beat ① on a fresh/reset lease before any fence. | no write intent | prepare failure/timeout ⇒ release poisoned/clean page; no external side effect to recover |
| **③ Binding proof** | Resolve the commit contract's required `SubjectBindingSpec`. Person/artifact scope executes its semantic observation after preparation on this exact page and builds `SubjectProof`; explicitly unscoped scope validates the allowlisted reason plus exact staged page state and builds `UnscopedBindingProof`. Both parse as `WriteBindingProof`. | proof is not yet authority, but is held for the fence transaction and evidence bundle | mismatch, unknown, missing/stale observation, unregistered unscoped reason, wrong system/page state, or schema failure ⇒ no fence/no click; close/poison page and emit a structured binding failure |
| **④ Fence** | Check `probeToFenceMaxMs` **and** that `WriteBindingProof` was created after prepare for this run/attempt/lease. INSERT the unseen key or CAS its `retryable` row to `attempting`, incrementing generation. Store the parsed binding proof and enqueue `write.attempting` in the same SQLite transaction. The permanent primary key is the same-key mutex. | durable intent + binding proof + span outbox | elapsed proof or binding mismatch ⇒ no click; CAS conflict ⇒ discard staged page/no click; no generic retry after a won fence |
| **⑤ External commit** | The external-write helper requires the unforgeable `MutationCapability` bound to the open intent generation **and binding-proof digest**. | live HR side effect | missing/mismatched fence capability or binding digest ⇒ throw before click |
| **⑥ Capture / verify** | Extract `proofFromOutput` or run the verify read on the retained transaction page; every completion kind parses through its `proofSchema`. | proof remains in memory | absent/ambiguous/unknown/throw/schema failure parks; no arm can return unvalidated proof |
| **⑦ Atomic durable commit** | ONE SQLite transaction validates the current claim+intent generations, marks the intent/attempt committed, writes the schema-valid `TransactionOutcome` checkpoint, immutable ledger outbox row (including binding-proof digest and the exact fenced subject/explicit absence), same-trace terminal-span/generic-outcome outbox row, any real evidence-receipt ref required by the active trust service, and the run transition. JSONL ledger/span projectors run afterward. | all authorities/outboxes durable together | transaction failure leaves intent attempting and enters recovery; trace/subject/claim mismatch fails before mutation; projector lag is repairable and never changes write outcome |

**Ordering invariant:** stable commit input and live probe exist before page preparation; a fresh
binding proof follows successful preparation on the same lease; the fence transaction in ④
stores that proof and happens-before the click; the click happens-before landing-proof validation;
proof validation happens-before the single ⑦ transaction. Ledger and span JSONL
are projections of durable outboxes, not additional commit beats. This generalizes oath-upload's
"marker durable before the POST" (`handler.ts:306-309`) into the kernel.

```sql
-- rebuild state.db — SYSTEM-OF-RECORD (D14: not rebuildable, not deletable). The crash-window fence.
CREATE TABLE write_intents (
  system          TEXT NOT NULL,   -- SystemId
  idempotency_key TEXT NOT NULL,
  workflow        TEXT NOT NULL,
  item_id         TEXT NOT NULL,
  node_id         TEXT NOT NULL,
  owner_run_id    TEXT NOT NULL,
  owner_attempt   INTEGER NOT NULL,
  generation      INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL CHECK(status IN
                    ('attempting','retryable','committed','observed-present')),
  origin          TEXT NOT NULL CHECK(origin IN
                    ('automation-attempt','external-observed')),
  fenced_at       TEXT,
  committed_at    TEXT,
  binding_proof_json TEXT,               -- required for origin='automation-attempt'; live-probe
  binding_proof_schema_hash TEXT,        -- observed-present rows instead retain probe evidence
  binding_proof_digest TEXT,
  proof_json      TEXT,
  proof_schema_hash TEXT NOT NULL,
  output_json     TEXT,
  output_schema_hash TEXT NOT NULL,
  PRIMARY KEY (system, idempotency_key),
  CHECK(origin='external-observed' OR
        (binding_proof_json IS NOT NULL AND binding_proof_schema_hash IS NOT NULL
         AND binding_proof_digest IS NOT NULL))
);

CREATE TABLE write_attempts (
  system TEXT NOT NULL, idempotency_key TEXT NOT NULL, generation INTEGER NOT NULL,
  run_id TEXT NOT NULL, attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('attempting','retryable','committed')),
  started_at TEXT NOT NULL, ended_at TEXT,
  binding_proof_json TEXT,         -- immutable proof for THIS generation; the intent holds latest
  binding_proof_schema_hash TEXT,
  binding_proof_digest TEXT,
  resolution_json TEXT,             -- typed operator/recovery evidence; never overwrites history
  PRIMARY KEY (system, idempotency_key, generation),
  CHECK(binding_proof_json IS NOT NULL AND binding_proof_schema_hash IS NOT NULL
        AND binding_proof_digest IS NOT NULL)
);

CREATE TABLE durable_outbox (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, aggregate_key TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL, projected_at TEXT
);
```

`write_attempts` contains only generations in which this automation crossed a fence; a live probe
that discovers an externally present transaction creates no attempt row. Committed and externally-
observed-present keys remain in the primary-key table forever. A later run with the same business key
parses and reuses the stored proof; it cannot create a second fence merely because the earlier row
is already satisfied. `observed-present` blocks a click but writes no ledger entry: discovering a
transaction is not evidence this automation filed it. There is no operator action that reopens a committed key. Normal recovery from a
proven-absent click changes the same row to `retryable` and increments its generation on the next
fence rather than deleting history. If an externally reversed transaction must legitimately be
filed again, its input carries a distinct audited correction/revision identity that derives a new
natural key; "void the fence and click again" is not an operation.

---

## 4. Crash-window recovery (positive proof or stabilized negative proof)

**The guarantee, stated precisely:** for any real commit, after a crash at *any* point recovery
selects exactly one of three outcomes and never retries from a single unproven UI miss:

1. **The write landed** (crash anywhere after ⑤) → recovery's probe returns `present` → the kernel
   runs `completion.proofSchema.parse(completion.proofFromPresentProbe(verdict))`, then
   `commit.output.parse(completion.outputFromProof(proof))` — the SAME validation
   beat ⑥ parsers run; a `present` proof is never trusted blind. On parse **success** it **backfills** the
   full typed `TransactionOutcome{disposition:"committed",proofSource:"recovery-probe"}`, marks the existing attempted intent committed, atomically
   enqueues ledger/span outboxes, and completes `done` (no second
   submit). On parse **failure** it **parks `needs-operator`** (a `present` we cannot validate is
   indeterminate, not done). There is **NO path to `done` with unvalidated proof—recovery
   included.**
2. **The write is proven absent.** One `absent` result is only an observation, not retry authority.
   The kernel validates its `AbsentEvidence` and schedules the **first qualifying** probe no earlier
   than `fencedAt + minSinceFenceMs` using a `not_before` requeue (no sleeping worker). It then obtains
   the configured 2–3 consistent observations separated by `minBetweenReadsMs`. Every counted
   observation—not merely the final one—must have `observedAt >= fencedAt + minSinceFenceMs` and
   bind the same key/query/authoritative source state. Earlier observations remain diagnostic only
   and contribute zero settlement votes (D69). Only then does
   the kernel record a strict `safe-to-retry` resolution and change the same intent to `retryable`;
   history is retained and the next attempt CAS-fences a new generation. A contract whose target
   cannot earn this proof declares `recoveryAbsence.kind:"operator-only"`.
3. **Indeterminate** (probe returns `ambiguous`/`unknown`, throws, returns malformed/different-key
   negative evidence, has not cleared its propagation window, disagrees across reads, or uses an
   `operator-only` policy) → `PARKED(needs-operator)` with
   a legible message naming the key, the system, and the match count — the operator verifies in the
   target system and uses one of the typed resolutions below. Never a guess.

**Recovery replay (resolves doc 02 §OQ2 — replaces "always park"):** on resume, the kernel first
scans `write_intents` for the resuming `(workflow,item_id,step_id)`. If it finds a row with
`status:"attempting"` and no `committed`, it **re-runs `idempotency.probe(key)` FIRST** (before any
`startAt` node logic) and routes on the evidence-qualified protocol above. Only after the probe resolves does
normal resume proceed. A read node with no fence auto-resumes as today (worst case: a repeated
read). This reads durable state from SQLite (system-of-record), never post-crash JSONL, mirroring
oath-upload's SQLite-fast-path recovery (`handler.ts:427-429`).

The same scan is mandatory on the expired-claim sweeper path. Claim expiry alone cannot move a run
with an unfinished intent to the ordinary queue; recovery owns it first, and an authority-read
failure keeps it unclaimable.

**Recovery lease identity (D116, as-built 2026-08-03).** The recovery probe's driver lease runs
outside any worker loop's claimed-run binding, so the recovery service binds the TARGET run's
retained immutable `configFingerprint` (doc 11 §4) around the lease itself — sourced from the
authority run row the intent names, never recomputed from current config — and releases it after
the probe. The park/refusal split is deliberate: only a genuine probe failure (throw, `unknown`,
`ambiguous`, malformed evidence) may park as a probe verdict; a *precondition* failure — no
retained fingerprint, or a session host already bound to another run — throws out of recovery
loudly and never converts into a park that reads as a probe verdict. The §4.1 typed operator
resolutions are pure authority work and lease no driver, so no binding applies there.

### 4.1 Parked-write resolution is typed and intent-scoped

A parked write does not inherit the queue's ordinary Done/Retry actions. The kernel exposes exactly
two intent-scoped resolutions, both requiring the current intent generation and an optimistic-lock
version so a stale browser action cannot race recovery:

1. **Confirmed present.** The operator supplies the exact business/artifact identity and proof. It
   parses through the same `completion.proofSchema`; `unverifiableByPage` uses the schema's typed
   `operator-attestation` arm. Success runs the same atomic beat ⑦ (intent committed + proof
   checkpoint + ledger/span outboxes + run state). Parse failure changes nothing.
2. **Confirmed absent.** The operator supplies a non-empty evidence note after checking the target
   system. SQLite records `{operator, confirmedAt, evidence, priorGeneration}` in `write_attempts`
   and changes the same permanent intent to `retryable`; only the next CAS may create a generation.
   The next generation must perform a fresh prepare+subject observation and writes a new immutable
   attempt proof; no prior `WriteBindingProof` is reused. It never deletes/reopens committed history and
   does not itself click.

Cancel or Hide may change the run/presentation but cannot alter the intent. There is no third “force
done” or “retry anyway” endpoint. Every resolution emits an audited note and is covered by strict
command schema, stale-generation, and double-click tests.

---

## 5. Double-submit prevention

**Idempotency key from stable identity, never position.** The `key` function takes the parsed
workflow-derived input and returns a natural business key: `${eid}|termination|${effectiveDate}`,
`${sessionId}|${pdfHash}` (oath-upload today), `${eid}|hire|${jobCode}|${effdt}` (onboarding — note
hires have no EID pre-hire, so the key uses name+effdt+jobCode, the same fields
`findExistingHireTransaction` matches on). It **never** incorporates run position, attempt number,
array index, or the OCR fan-out index — that is the doc1/doc2 (E2E-015) shared-id fallback, banned in
the fan-out (`buildFanOutItemIdResolver`) and banned here (§8). Two runs for the same
person+type+date derive the same key, so beat ① sees the first run's committed intent and refuses to
double-file.

**Two probe kinds are distinct and both port** (separations taught us the difference):
- The **idempotency probe** reads *processed/filed* transactions (a committed `T…` exists) —
  `findExistingTerminationTransaction` keyed EID+effdt+"Terminatn".
- The **date-agnostic pending sweep** (`deletePendingTransaction`, `transaction.ts:1167`) is a
  *commit cleanup* that deletes ALL in-progress unprocessed Terminat rows for the EID regardless of
  effdt — it catches a stale prior attempt carrying a *different* computed effdt that the date-keyed
  probe misses. It ports as its own `ucpath/clear-pending-terminations` transaction composed BEFORE
  termination (it has its own durable key and typed proof: deleting nothing is a validated no-op;
  deleted row identities are its proof).

**The per-workflow probe-policy knob (charter §b — decided at migration, NOT defaulted here).** Beat
① (the *pre-write* probe) is governed by a per-workflow knob; the *recovery* probe (§4) is always on
regardless.

```ts
// on the transaction node (doc 02 owns the field; semantics owned here)
probePolicy: "always" | "retries-and-recovery-only";   // REQUIRED — no default
probeToFenceMaxMs: number;                              // REQUIRED, >0 — migration-justified
```

- `"always"` — probe before every submit (one extra live read per submit; safest; closes the crash
  window even on the first attempt).
- `"retries-and-recovery-only"` — may skip only the live-page probe when the durable key has never
  existed. Durable lookup is never skipped, committed keys are never exempt, and retries/recovery
  always probe. The trade-off is failure to notice an older external transaction absent from this
  automation's ledger, not permission to repeat one already committed here.

Both fields are **required** (compile error if omitted on a transaction), which forces the §b
migration question to answer policy and maximum preflight age per workflow. There is **no hardcoded
default**. The Clock's monotonic time measures probe completion → fence; expiration discards the
prepared page and restarts at preflight, never clicks on an over-age result.

---

## 6. The immutable receipt / transaction ledger

**Purpose (operator §13):** an immutable record of what real transactions were actually filed, **never
pruned** — it outlives doc 03's decided base retention (spans 30d / notes 30d, D86) and the
`clean-tracker` sweep.

```ts
// src/domain/ledger.ts — the append-only at-rest entry shape.
// Beat ⑦ writes its unsequenced payload to durable_outbox; the projector adds ordered seq.
export interface LedgerEntry {
  outboxId: OutboxId;             // immutable DB identity; projector idempotency key
  seq: NonNegativeInt;            // assigned transactionally by the serialized projector
  workflow: WorkflowId;
  itemId: ItemId;
  system: BrowserSystemId;        // ucpath | crm | servicenow | kuali | onbase
  idempotencyKey: IdempotencyKey; // the natural key (§5) — dedupe + audit join
  proof: CanonicalJsonValue;      // already parsed by the referenced completion proof schema
  proofSchemaHash: Fingerprint;
  completionKind: "receipt" | "save-verify" | "upload-verify";
  proofSource: "normal-output" | "recovery-probe" | "operator-attestation";
  bindingProofDigest: Sha256;       // exact subject-match or unscoped proof stored on the intent
  subject?: SubjectEvidenceWire;    // present only for subject/artifact-scoped commits
  runId: RunId; traceId: TraceId; attempt: PositiveInt;
  operator: OperatorId;           // from the config domain (doc 11), never fabricated
  instance: "prod" | "test";      // resolved run snapshot (doc 11)
  configFingerprint: Fingerprint;
  dryRun: false;                  // real writes only; a dry run composes no submit, so writes NO ledger entry
  fencedAt: IsoInstant;           // durable instant before the click
  confirmedAt: IsoInstant;        // proof accepted; may be later after recovery/manual confirmation
  externalOccurredAt?: IsoInstant;// only when the external proof itself supplies a trustworthy time
}
```

`LedgerEntrySchema` is a strict discriminated/runtime schema and verifies the proof again by
`proofSchemaHash` during projection/read. The interface is shown only for readability; persisted
code uses its inferred type. There is no unchecked cast from the generic canonical proof envelope.

- **Location:** `.tracker-rebuild/ledger/<system>-<YYYY-MM-DD>.jsonl` (doc 03 §2.1). JSONL so the
  operator greps it; per-system+day partition so `grep 10001573 .tracker-rebuild/ledger/ucpath-*.jsonl`
  answers "what did we file for this person?" across time.
- **Never pruned (retention floor):** rebuild cleanup (which prunes `spans/` and `notes/` at
  30d—D86) skips `ledger/` unconditionally—a ratchet guard fails
  if any prune path can reach `ledger/`. This is the "immutable transaction ledger, never pruned" of
  operator §13. The never-pruned floor sits above a *settled* number (D21), not a guessed one.
- **Serialized ordered projection.** Executors never append the ledger file. Beat ⑦ writes a
  unique ledger outbox row. One projector holds a SQLite lease for `(system,date)`, assigns the next
  sequence, appends one canonical actor-attributed line, fsyncs, and marks that outbox projected.
  Restart reconciles committed intents/outboxes against `outboxId` + sequence and appends only
  missing entries; duplicate, gap, malformed-tail, or order conflicts stop projection and surface
  degraded health rather than silently rewriting history.
- **Hash-chain/tail-anchor deferred (D79).** `prevHash`, `ledger_heads`, and tamper-evident tail
  verification are not initial single-operator requirements. They return only with the multi-user
  phase or a separately ratified compliance requirement. Never-pruned retention, strict schemas,
  atomic outboxes, one ordered projector, actor attribution, backups, and reconciliation remain.
- **Projection is idempotent** by `outboxId`. Recovery audits committed intents against ledger and
  terminal-span outboxes, creates only missing outboxes in SQLite, then lets projectors catch up.
- **One entry = one filed transaction.** The ledger is the durable superset of the `write.committed`
  span events (gap-audit gap 5: "receipts ARE the ledger"). It records a confirmed automation
  attempt, not a claim that `confirmedAt` equals the external filing instant. A preflight probe that
  merely discovers an existing external transaction produces `write.skipped-existing` audit state
  and no ledger entry.

---

## 7. Fail-closed everywhere — every place `unknown` could leak into `done`, and its exit

The operator's core requirement. Exhaustive:

| # | Where "unknown" could become "done" | Fail-closed exit |
|---|---|---|
| 1 | Pre-write probe (①) can't determine presence | `unknown` verdict ⇒ `PARKED(needs-operator)` — never submit |
| 2 | Pre-write probe finds >1 match | `ambiguous` ⇒ `PARKED` — never guess which is "the" transaction |
| 3 | Probe read **throws** (page/net error) | wrapped as `unknown` (a failed check ≠ "found nothing" — the charter catch-swallow ban) ⇒ `PARKED` |
| 4 | Receipt read-back returns `""` (UCPath) / no `number=` (ServiceNow) | missing/empty receipt ⇒ `PARKED("clicked, cannot prove it landed")` — mirrors today's "refusing to report success" throw |
| 5 | Captured proof fails its `proofSchema` | schema-fail ⇒ `PARKED`, never `done{committed:true}` |
| 6 | Kuali `save-verify` can't confirm the save | any verdict ≠ `present` ⇒ `PARKED` |
| 7 | OnBase `upload-verify` can't confirm the filing | any verdict ≠ `present` ⇒ `PARKED`; `unverifiableByPage` allowlist ⇒ **always** `PARKED` for manual confirm (never auto-done) |
| 8 | Crash mid-write, recovery probe indeterminate | `ambiguous`/`unknown`/throw/malformed absence ⇒ `PARKED`; `present` ⇒ backfill-done only after the arm's `proofSchema`; `absent` becomes retry authority only after every counted observation was captured after the propagation window and clears the repeated-observation policy, otherwise parks (D64/D69) |
| 9 | A commit `run` returns success with no proof | kernel rejects at ⑥ ⇒ `PARKED` |
| 10 | The mutation primitive fired without a fence (a mis-authored submit) | primitive throws (⑤) — corruption, loud |
| 11 | dry-run: no submit composed at all (charter §1a) | write-safety never engages; nothing to make done — clean, no leak |
| 12 | Live probe aged while the form was prepared | `probeToFenceMaxMs` expires ⇒ discard page and restart at preflight; no fence/click |
| 13 | Operator clicks a stale/generic Done or Retry on a parked write | those actions do not exist; present proof/absent evidence endpoints require intent generation+version and fail on conflict |
| 14 | Staged page shows another person/file, or the identity cannot be read | beat ③ returns mismatch/unknown ⇒ zero fence, zero mutation capability, poisoned/closed lease, structured failure + diagnostic bundle |
| 15 | A commit declares no subject and therefore has nothing to bind to the fence | `subject.kind:"none"` requires an allowlisted reason and a schema-valid unscoped page-state proof; otherwise zero fence. The capability always binds to a `WriteBindingProof` digest (D65) |

The unifying rule: **only schema-valid landing proof plus schema-valid reconstructed/normal
transaction output yields `done`; only an actual fenced automation attempt yields a write-ledger
entry. An absence after a click retries only after schema-valid negative evidence satisfies the
recovery-settlement policy; every other ambiguous, unknown, thrown, empty, early, or inconsistent
outcome parks.** A boolean probe would
collapse #1/#3/#8 into "false ⇒ proceed"; the `ProbeVerdict` type makes that collapse
*unrepresentable*.

---

## 8. Mechanical guards (fail-loud ratchets, `npm run test:architecture`)

- **`write-safety-contract.test.ts`** — every `effect:"commit"` contract MUST declare write safety;
  no allowlisted escape hatch. Every completion arm has nontrivial `proofSchema`, normal-output and
  recovery-probe extractors, `outputFromProof`, and fixtures proving normal/recovery/preflight-
  present paths parse the same proof and commit-output schemas and yield the correct discriminated
  `TransactionOutcome`.
- **Probe/verify resolution** — `idempotency.probe` and any `save-verify`/`upload-verify` `verify`
  TaskId resolve to a real `effect:"read"` task in the **same store**, whose output is (or extends)
  `ProbeVerdict`, whose contract declares zero-age freshness. Table-driven over the store index.
- **Fence-before-click** — a unit fixture asserts the `write_intents` SQLite commit is observed
  before the mutation primitive is invoked; the primitive throws when invoked with no open fence
  or when its capability's binding-proof digest does not match the fenced intent.
- **Subject-before-fence** — every commit contract has a strong/explicit-none subject declaration;
  prepare/commit subjects are compatible; the driver observation resolves in the same system.
  Ordering tests assert prepare-end < subject-observed < fence-commit < mutation-call. Registered
  scenarios cover match, mismatch, unknown/missing element, stale proof after navigation, stale
  proof after retry, and two EIDs alternating through one pooled page.
- **Unscoped binding allowlist** — every commit with `subject.kind:"none"` has one reviewed reason
  and builds the D65 unscoped proof on a registered page state; stale entries fail in reverse. A
  fixture proves no empty/fabricated subject evidence is accepted and the mutation capability is
  bound to the unscoped proof digest.
- **Same-key sequential + concurrent dedupe** — fixtures cover two simultaneous starters and a
  later fresh run after the first committed. Both reuse/block on the permanent primary-key intent;
  neither can create a second fence/click. An unseen live `present` becomes `observed-present`,
  produces typed output but no ledger outbox, and remains permanently click-blocking.
- **Crash-recovery** — a fixture injects a `write_intents{status:"attempting"}` with no `committed`
  and asserts the recovery probe runs FIRST and routes present→(schema-parse then)backfill /
  present-with-receipt-failing-schema→park (D19) / one early absent→requeue-or-park / stabilized
  same-key negative evidence→retry / inconsistent or malformed absence→park / operator-only→park /
  unknown→park. Manual Clock fixtures cross the exact propagation/read-spacing boundaries without
  sleeping.
- **Atomic outbox + ledger integrity** — crash injection at every subpoint of beat ⑦ proves the
  intent/checkpoint/ledger-outbox/span-outbox commit is all-or-none. Concurrent projector fixtures
  prove one ordered stream, actor attribution, idempotence by outbox id, and loud failure on
  sequence gaps, malformed tails, duplicates, or missing files. Hash-chain/tail-anchor tests wait
  for the deferred multi-user upgrade.
- **Idempotency key hygiene** — a grep/AST guard flags an `idempotency.key` body referencing
  `attempt`, `index`, `runId`, or array position (the doc1/doc2 ban); keys must read input fields.
- **Transaction pairing** — every prepare and commit contract is paired in a transaction node;
  neither is legal standalone, the lease scope is transaction-wide, and a dry-run executable plan
  contains the prepare arm but zero commit arms or mutation capabilities (doc 10).

---

## 9. Composition with the existing docs (no redefinition)

- **Charter §1a (fill/submit split).** Fill is `effect:"prepare"`, submit/save/upload is
  `effect:"commit"`, and one transaction node retains the page lease across both. A dry-run plan
  includes prepare and excludes commit, so no fence/probe/ledger work begins.
- **Doc 01 §6.2 (mutation primitive).** `stores/common/mutation.ts` accepts only the commit ctx's
  capability bound to the open intent generation + `WriteBindingProof` digest; no boolean dry-run
  branch exists.
- **Doc 02 §5.6/§5.7 (checkpoints/resume).** Transaction nodes checkpoint their full typed
  `TransactionOutcome`
  and retain the validated proof on the permanent intent; a transaction
  whose committed/satisfied key exists reuses its validated proof+output. Beat ⑦'s transaction-output checkpoint and
  the `write_intents` row share the `(workflow,item_id,step_id,attempt)` key. §5.6 #2 is upgraded per
  §4. The freshness walk (D8) is orthogonal and upstream: it keeps *stale read data* out of the fill;
  write-safety keeps duplicate writes out of commit — two different holes, two different guards.
- **Doc 02 gates (D5).** `PARKED(needs-operator)` is doc 02's park state; write-safety is one of the
  producers of it. Parking closes browser contexts before releasing exclusive leases; resume reacquires and
  re-enters at the recovery probe.
- **Doc 03 (spans/storage/ledger dir).** `write.attempting` and `write.committed` are two new span
  events (the fence + the commit); subject observation is `subject.observed`, and proof/evidence
  refs ride strict run-detail updates. Per **D21**,
  doc 03 OWNS and adds the `ledger/` dir (never-pruned retention floor) and the `write_intents`
  SQLite **system-of-record** table (added to the D14 set) in its storage layout — this doc
  references them, it does not place them in the `.tracker/` tree.
- **Clock/instance (doc 11).** Every timestamp (`fenced_at`, `committed_at`, ledger `fencedAt` /
  `confirmedAt` / optional `externalOccurredAt`) comes from the
  injectable Clock; `operator` and `instance` (prod/test) come from the config/secrets domain and
  RunEnvelope — all owned by **doc 11** — so the ledger never fabricates a time or lets a test read
  look like a prod filing.

---

## 10. Port inventory (verbatim-wrapped vs newly built)

**Ports verbatim, wrapped in the contract:**
- UCPath `waitForTransactionOutcome` (polls, RETURNS `"timeout"` on neither-signal) + its caller
  `clickSaveAndSubmit`'s "outcome unknown, refusing to report success" throw (`transaction.ts:855-859`)
  + `readLatestTransactionNumber` (`transaction.ts:919-985`) → UCPath submit tasks' `receipt`
  capture (beat ⑥) and the `""`-means-unknown rule (fail-closed #4). The by-EID (not name) row
  re-find ports as-is.
- ServiceNow `submitAndCaptureTicketNumber` + `parseTicketNumberFromUrl` (`fill-form.ts:140-173`) →
  ServiceNow `receipt` capture.
- oath-upload `submitAttempted` + `hasUnverifiedPriorSubmit` + `findPriorTicketForSession` +
  SQLite-fast-path recovery (`handler.ts:249,273,309,388-454`) → the generalized `write_intents`
  fence + the recovery-probe replay (§4).
- Separations `findExistingTerminationTransaction` (`steps/ucpath-transaction.ts:83-104`) → the
  `ucpath/find-existing-termination` probe; `deletePendingTransaction` (`transaction.ts:1167`) → the
  `ucpath/clear-pending-terminations` cleanup transaction (§5).
- Onboarding `findExistingHireTransaction` + `decideHireDuplicateSkip` (`workflow.ts:488-521`) → the
  hire probe — its verdict widened from boolean fail-open to `ProbeVerdict` (its high-confidence skip
  becomes `present`; its low-confidence "fail open→submit" becomes `absent`; its genuinely-ambiguous
  case becomes `ambiguous`→park, which is the safety upgrade).

**Newly built (mostly the write-ahead layer — the gap audit's "mostly new"):**
- The permanent-key intent table, atomic outboxes, fixed sequencer, `ProbeVerdict`, serialized
  ordered ledger projector, and recovery reconciliation.
- **Kuali `kuali/read-saved-document`** — a positive `save-verify` read-back that does NOT exist today
  (Kuali removed its error detection as false-positive-prone). Must be built and live-verified before
  Kuali submit tasks can instantiate a passing `completion`.
- **OnBase `onbase/read-filed-document`** — a positive `upload-verify` read-back replacing today's
  negative "not an error page" (`handler.ts:208-217`). If a reliable positive read proves infeasible,
  the documented `unverifiableByPage` allowlist makes the OnBase submit **always** park for the
  operator's manual confirmation (which the operator already does — §13).

---

## 11. Adversarial self-review — how this could still fail, and residual risk

- **Same-key sequential/concurrent dedupe and positive recovery backfill are closed.** The permanent
  `(system,idempotency_key)` primary key covers attempting and committed states, so a later pristine
  run cannot fence again. Recovery no longer trusts a present proof blind: the completion arm's
  `proofSchema` parses it, parse-fail →
  park, so there is no unvalidated path to `done`. **Honest scope (D20):** this closes
  two unattended generations from arising from one early post-fence miss. It does not create
  distributed exactly-once when a target cannot supply authoritative positive/negative evidence;
  those cases park. Duplicate-*person* remains a separate racy-selection residual (next bullet).
- **The probe/verify read is itself a read that can lie.** A false `present` skips a needed write; a
  false `absent` before a first submit can still permit a duplicate of external work, and no UI
  read can prove distributed exactly-once absolutely. *Guards:* zero-age freshness (never a
  checkpoint); exact-match on the stable key; typed negative evidence; post-fence propagation +
  repeated-read stabilization; `ambiguous`/`unknown` park; a throwing probe is `unknown`, not
  `absent` (charter catch-swallow ban). **Residual:** a
  probe that reads too early (the duplicate-person root cause) could report `absent` on a
  still-rendering page — mitigated only by porting the race-based classifiers
  (`raceNewHireVsRehireSignal`) into the probe impls, a review+live-verify discipline, not a
  mechanical guard. **This is the deepest residual and must be live-verified per probe at migration.**
- **Kuali/OnBase have no machine receipt.** `save-verify`/`upload-verify` reads may themselves be
  weak (Kuali's deleted error-detection was false-positive-prone). **Residual, stated honestly:** if
  a reliable positive read-back can't be built, OnBase falls to `unverifiableByPage`→always-park and
  Kuali's `save-verify` may over-park on benign pages. Over-parking is fail-*closed* (safe but noisy);
  the real risk is a `save-verify` that returns a false `present` and reports a save that didn't land.
  This is the one place the fail-closed guarantee rests on read quality we cannot fully mechanize.
- **Wrong-DATA is only partly covered here.** Fresh subject binding structurally blocks one critical
  subtype: the staged browser page belongs to someone/something other than the expected commit
  subject. It does **not** prove that upstream rules selected the correct real-world person, action,
  effective date, pay data, or document content. Those remain doc 02 freshness, typed validation,
  scenario coverage, and identity/operator gates. The ledger makes residual wrong filings
  attributable. Exactly-once plus subject-match is still not correctness of every field.
- **Fence bypass.** A future submit task could fire a raw click outside the mutation primitive.
  *Guard:* tasks have no raw Page/Locator/selector access (docs 01/12); submit-capable driver methods
  require the mutation capability, and that primitive validates the fence + subject digest. Per
  **D22** doc 10's
  `commit-routes-through-mutation` ratchet is an import/capability check that every `effect:"commit"`
  impl routes its submit click through `stores/common/mutation.ts` — so "fence-before-click is
  unbypassable" is now structural, not grep-hopeful. **Residual:** a leaf that reaches a submit via a
  novel un-wrapped helper the import walk doesn't recognize as a click — narrowed to review, not
  wide open.
- **Probe-policy misconfig.** `"retries-and-recovery-only"` can miss a transaction created outside
  this ledger on a pristine key; it cannot bypass durable committed history. The choice remains a
  required migration decision and should default by review preference to `always`.
- **Ledger damage/loss.** Strict entry parsing, ordered outbox reconciliation, backups, and degraded
  health catch malformed/gapped projection state; hash-chain/tail-anchor tamper evidence is deferred
  to multi-user work (D79), so malicious coherent local rewriting remains out of current scope.

---

## 12. Worked example — a separations termination, with a crash

Input `{ emplId:"10001573", action:"termination", effectiveDate:"08/01/2026" }`, dry-run **off**,
`instance:"prod"`. Composed nodes: cleanup transaction → termination transaction whose prepare arm
is `ucpath/fill-termination`, commit arm is `ucpath/submit-termination`, and probe policy is always.

**Happy path (seven beats):**
```
bind stable commit input + key="10001573|termination|08/01/2026"
① durable lookup → unseen; separate read lease runs find-existing-termination →
   { state:"absent", evidence:{idempotencyKeyDigest,source,sourceState,observedAt,queryDigest,evidenceRef} }
   release read lease; record monotonic probe completion
② acquire exclusive transaction lease; fill-termination stages the form
③ driver observes ucpath.smart-hr.subject-eid="10001573" on the staged page;
   kernel matches expected EID and constructs WriteBindingProof{kind:"subject-match",leaseId,
     pageStateId,observedAt,digest}
④ probe/subject age < probeToFenceMaxMs; fence
   write_intents{key,status:"attempting",binding_proof_digest} COMMITTED (SQLite)
   → span write.attempting
⑤ commit mutation primitive: Save+Submit click (matching fence+subject capability → fires)
⑥ capture readLatestTransactionNumber (re-nav on retained transaction page) → "T002173999"
         pick(o)=o.receipt; schema z.strictObject({transactionNumber:/^T\d{6,}$/}).parse → ok
⑦ atomic DB commit: typed TransactionOutcome{disposition:"committed",proofSource:"normal-output"}
                        checkpoint + write_intents{status:"committed",
                           proof_json, output_json, binding_proof_json}
         + ledger/span outboxes { system:"ucpath", idempotencyKey:"10001573|termination|08/01/2026",
                           proof:{transactionNumber:"T002173999"}, operator, instance:"prod",
                           dryRun:false, proofSource:"normal-output", bindingProofDigest,
                           fencedAt, confirmedAt:clock.now() }
           // ledger projector assigns ordered sequence + actor metadata only after claiming this outbox
         + span write.committed + span.ended(done)
```

**Crash AFTER the click (⑤) but BEFORE capture (⑥).** The executor dies; the Save landed in PeopleSoft
but no receipt was recorded. Lease expiry re-enqueues the run; recovery (§4) runs FIRST:
```
scan write_intents (separations, 10001573-item, ucpath-submit) → status:"attempting", no committed
re-run ucpath/find-existing-termination key="10001573|termination|08/01/2026"
  → { state:"present", proof:{transactionNumber:"T002173999"} }   // the row PeopleSoft now shows
⇒ BACKFILL in one DB transaction: committed proof + ledger/span outboxes + done
⇒ NO second Save. The permanent fence and typed positive proof establish convergence without a
second unattended commit attempt.
```
Had an early recovery probe returned `absent`, it would be retained only as diagnostic evidence.
The kernel would requeue without occupying a worker, take its first qualifying observation at least
30s after the fence, then require a second same-key/same-state absence at least 5s
later before marking the intent retryable. An early, malformed, or disagreeing absence would park.
Had it returned `ambiguous` (two "Terminatn" rows for that EID+date) or
`unknown` (grid didn't render) → `PARKED(needs-operator)`: *"termination for EID 10001573 effdt
08/01/2026: probe found 2 matches / probe indeterminate — verify in UCPath, then retry or mark
done."* Had the present proof failed `proofSchema` → `PARKED`, never `done`.
Never a guess, never a duplicate `T…`.

**Two runs, same key (D18).** Suppose a second run for the same
`{10001573, termination, 08/01/2026}` starts while the first is mid-submit. Its beat ① consults
`write_intents` FIRST, finds the first run's `attempting` row on
`idempotency_key="10001573|termination|08/01/2026"`, and **fails loud without fencing or clicking** —
*"another run is mid-submit for key 10001573|termination|08/01/2026 — refusing to double-fence."*
Even if two starters race, one permanent-key INSERT/CAS wins. After commit, any future run finds and
reuses the proof. Concurrent and sequential duplicates are both blocked.

**Honest scope (D20/D64).** This is how the known double-**FILE** paths are controlled: the permanent
fence + same-key mutex (D18), plus the pre-Save `present` probe and evidence-qualified recovery,
prevent a second unattended click unless a new generation first earns typed stabilized-negative
authority. Every uncertain state parks instead of fail-open→SUBMIT. This is deliberately not a
claim of unconditional distributed exactly-once for a UI-only target.
The duplicate-**PERSON** class (the too-early racy read that classified a rehire as a new hire — §0)
is **NOT** structurally closed by subject binding: the selected record and staged page could agree
while the selection itself was wrong. That remains a disclosed residual mitigated by porting race
classifiers, typed ambiguity, per-probe live verification, identity gates, and the conditional
create-path pending-termination sweep (§11). The fenced-generation guarantee controls duplicate
attempts; subject binding means no commit on an observably different open record; neither alone
proves every business choice.

---

## 13. Open questions for the operator / orchestrator

1. ~~**Kuali `save-verify` reliability**~~ — **RESOLVED 2026-07-23 by live probe (D78): BUILDABLE.**
   Run under operator authorization on Action List docs 4444/4453 (RRSS Separation Request Forms,
   new/unworked). Doc 4453 **read-only**: every separations-relevant field (name, EID, last day
   worked, separation date, termination type, timekeeper, status) read deterministically by
   **role + exact label** from the accessibility tree, byte-identical across reload. Doc 4444
   **write round-trip**: the timekeeper field (the benign field the legacy flow fills on drafts)
   written `PROBE-DELETE-ME` → Save → reload → value persisted; cleared → Save → reload → empty;
   full-form normalized diff before/after clean, doc restored byte-identically, no workflow buttons
   touched. Evidence: `.screenshots/kuali-probe/` (6 PNGs + 5 a11y dumps).
   **Four design constraints this produced — they are requirements on the `save-verify` arm, not
   trivia:** (a) **save success is UI-silent** — no toast, no banner — so a **reload read-back is
   mandatory** and "clicked without error" may never count as proof (this independently confirms
   the 2026-04-10 lesson that killed Kuali error detection as false-positive-prone); (b) date
   values render as **child text nodes**, so the reader must descend, not read the labelled node's
   own text; (c) **DOM refs change on every reload**, so the verifier anchors on role + exact label
   (literal `*` included) and never on a captured ref; (d) a full fill→save→reload→verify cycle
   costs **~8–10s/doc**, which is the budget the transaction node must carry. The doc URL is a
   stable reload-safe deep link but carries an opaque `actionId` — capture it at open.
2. **OnBase positive read-back vs always-park — BLOCKED, not deferred (D78).** The question is
   unchanged (is a live-verifiable "document filed" read achievable, or does OnBase take the
   `unverifiableByPage` allowlist → always-park for manual confirm, aligned with "operator tracks
   completion manually"?), but it cannot be answered without a target: **no uploadable probe
   document exists today**, so the probe is gated on the next real document upload (operator,
   2026-07-24). Consequence to be explicit about before order 7: if OnBase lands on always-park,
   its automation degrades to "the operator manually confirms every upload," which changes the
   daily workload rather than the safety story. Owner: this doc; gate: doc 07 §3.8.
3. ~~Ledger tamper-evidence altitude~~ — **amended by D79:** hash chain + independent tail anchor
   are deferred until multi-user or a separately ratified compliance need. The initial ledger is
   never-pruned, ordered, actor-attributed, strict, backed up, and reconciled from atomic outboxes.
4. **Probe policy + elapsed budget per workflow (§b).** For each migrating workflow: `"always"`
   (safe, +1 round-trip) or `"retries-and-recovery-only"` (cannot detect a prior external write on
   an unseen key), and what justified `probeToFenceMaxMs` bounds preparation after that probe?
   Asked per workflow at migration — this doc sets the mechanism, not the values.
5. **Pending-sweep as write-safety.** Should `ucpath/clear-pending-terminations` (the date-agnostic
   sweep — the real duplicate guard today) be a first-class write-safety pre-step on every UCPath
   create path, or only on separations? It mutates (deletes rows), so it needs its own fence/ledger
   treatment — confirm the modeling.
6. ~~**UCPath `receipt` readability**~~ — **RESOLVED 2026-08-04 by live probe (D130): BUILDABLE, and
   the arm as previously specified was WRONG.** Settled **read-only**, with **no transaction
   created** — the operator's authorization for one real submit was not spent, because the question
   turned out to be answerable better without it (see the constraint (a) reasoning below). Probed
   live against three real transactions spanning three templates and three approval statuses:
   `T002125030` (HIR, Approved, EID 10873698), `T002204014` (REH, **Denied**), `T002204964`
   (XFR, Pending).

   **Where the receipt lives.** Not on the submit, and not on the page that looks like it should
   carry it. The **Smart HR Transaction Status** dashboard (`HR_TBH_STATUS.GBL`) — the natural
   "did my transaction land" screen — has **no Transaction ID column at all** (Template, Effective
   Date, Transaction Status, Person ID, Empl Record, Action, Business Unit, First/Last Name). The
   one surface that displays the number as an addressable field is **SS Smart HR Transactions**
   (`UC_EXTENSIONS.UC_SS_TBH.GBL`), transaction detail.

   **Six design constraints — requirements on the `receipt` arm, not trivia:**
   (a) **A `T…` is NOT proof of success.** A Denied transaction carries a fully-formed receipt
   number, and 300 Denied plus 300 Pending transactions were visible on the day of the probe. The
   completion proof is therefore the **pair** `(transactionNumber, approvalStatus)`; §2.2's
   number-only `proofSchema` is corrected in this pass. Legacy's `interpretPostSubmitTxnReadback`
   (`transaction.ts:1310-1317`) tests only `/^T\d{6,}$/`, so it stamps a refused transaction as a
   successful receipt — a real latent defect, found without writing anything. **This is also why the
   probe did not submit:** a fresh submit could only ever have shown the `Pending` case, so reading
   an already-Denied transaction settled the success/failure question strictly better than creating
   one would have.
   (b) **The bare component URL is not a deep link, and the URL is never state evidence.** Reloading
   a search-drilled detail page silently returns to the Find-an-Existing-Value form while
   `location.href` stays byte-identical. Adding PeopleSoft's search key —
   `?Action=U&UC_TRANSACT_ID=T…` — makes the detail directly addressable **and** reload-stable
   (`T002204014` re-rendered byte-identically across a reload). Runs carry the key, not a URL.
   (c) **An unknown transaction id fails SILENTLY.** The keyed deep link for a nonexistent `T…`
   renders the ordinary search form: no error, no banner, no marker, same URL shape. "The page
   loaded" proves nothing. The reader must assert the receipt field resolved **and** that its text
   equals the requested id; absence is a loud failure, never "no receipt."
   (d) **There is no role+label anchor.** Both values render as bare `<span>`s with no programmatic
   relationship to their labels, so the accessibility tree shows adjacent unnamed generics. The
   anchors are PeopleSoft `RECORD_FIELD` ids — `#UC_SS_TRANSACT_UC_TRANSACT_ID` and
   `#UC_SS_TRANSACT_APPR_STATUS` — each matching exactly one node on all three probed transactions.
   This is the opposite of Kuali's constraint (c), and the two must not be generalized together.
   (e) **This route has no content frame.** Reached by its deep link the component renders with
   **zero** `<iframe>` elements and no `#main_target_win0`. Legacy funnels every UCPath read through
   `getContentFrame(page)`, which here resolves to nothing.
   (f) **Discovery by EID is a guess, so don't build on it.** The results grid renders at most 100
   rows against a server-side maximum of 300 (both `Denied` and `Pending` reported exactly "300
   results", so a count of 300 means *truncated*, not *complete*), it is ordered by the search key
   rather than by recency, and it exposes no submitted-at column. A single-hit search auto-drills to
   the detail while two or more render the grid, so even the landing shape is result-count
   dependent. Positive markers exist and are good — `span#PTS_CRITTEXT_DISP` carries either
   `"N results   -   <Key> \"<value>\""` (echoing the key, so the answer can be bound to the
   question) or `"No matching values were found."` — but the run must carry the `T…` it fenced, and
   use search only as recovery.

   Evidence: `evidence/ui/ucpath/ss-smart-hr.{fixture,live}.json`; registered as
   `ucpath.ss-smart-hr.{receipt-display,approval-status-display,transaction-ready,
   transaction-receipt,approval-status}`. **Still unproven (needs one real submit):** whether the
   post-submit confirmation dialog renders the number inline, and the propagation window between
   submit and searchability. Legacy answers both from its own live mapping — "**Cannot read it from
   the dialog itself**" (`workflows/separations/CLAUDE.md:147`, mapped 2026-04-01) and a 15s
   readback poll (`transaction.ts:947-965`) — and those are ported as legacy knowledge, not as
   rebuild-verified facts. Owner: this doc; gate: doc 07 §3.8.

---

## 14. The identity-approval gate — the wrong-PERSON control

Status: **designed 2026-07-26 (D77).** Policy ratified by the operator 2026-07-24: **ALWAYS-GATE**
— manual approval on every separation, for both separation types the operator distinguishes
(**Kuali separations** and **I-9 separations**), with **no auto-approve-on-match mode**. **Scope
(D127, 2026-08-04): §14.8** records the one ratified exemption — `kuali-timekeeper-annotation`,
which resolves no person and files nothing — and the two checkable facts any future exemption must
show. D77 is otherwise unchanged and still binds every commit that consumes an operator-approved
subject.

### 14.1 Why this section exists at all

Everything else in this doc guards the *double-file* class. It cannot guard the *wrong-person*
class, and §0 says so: incident `T002173685` was a **wrong-data** error — a name-search override
date-matched a different career employee and filed a real termination against him. A permanent-key
fence would have fenced that write perfectly and filed it anyway, because the key was derived from
the wrong person. The probe would have found no prior termination for that person, correctly, and
authorized the click.

Until this pass the program's design effort was inverted: ~60KB specified the fence that admittedly
cannot prevent the incident, while the control that *can* was one line in doc 07 saying it "has no
design yet," deferred to migration order 8 — the very last workflow. The operator's ALWAYS-GATE
ratification made the policy cheap to design, so it is designed here, in Phase 0.

**Two layers, two different questions — both required, neither substitutes for the other:**

| Layer | Question it answers | Failure it catches | Owner |
|---|---|---|---|
| **Identity-approval gate** (this section) | *Is this the right person to act on?* | wrong business selection — a name match that resolved a different real employee | operator decision |
| **Fresh subject binding** (§ binding proof) | *Is the page I am about to click on showing that person?* | correct selection, stale/switched page state | machine observation |

A run must pass both. The gate produces an **approved subject**; the binding proof asserts the
staged page equals that approved subject at the instant of the fence. Neither is inferable from the
other, and the gate's answer is what the binding proof's `expected` side is bound to.

### 14.2 What ports, and what deliberately changes

The legacy implementation is live-verified and ports nearly whole (`src/domain/identity-approval.ts`
+ `src/control/ops/eid-approval.ts` + the dashboard `EidApprovalBanner`): the two-candidate
side-by-side presentation, the per-candidate "Use this EID", the manual 8-digit entry, dismiss, and
the re-queue-with-approved-EID resume are all proven operator UX and stay.

**One thing changes, deliberately: the trigger.** The legacy gate is **mismatch-only** — it fires
only when `classifyNameSimilarity` returns the `different` tier, and `same`/`similar` proceed
silently. ALWAYS-GATE fires on **every** separation regardless of match quality. That is a policy
widening, not a port, and it must be recorded as such because it changes the operator's daily load
and introduces a new failure mode (§14.6).

Three legacy mechanics do **not** port, because the rebuild has real gate nodes:

- the row ending `done` with `data.eidApproval="pending"` (a browser-release artifact that made a
  paused run look completed — doc 03 already lifts this shape as a gate, not a completion);
- `data`-bag string state (`Record<string,string>`) — replaced by a typed gate result (D46/D67);
- the re-queue-as-a-new-run resume — replaced by a real park/resume on one run, so the approval and
  the write live in one trace with one identity.

### 14.3 Where the gate sits in the graph

```
  read: resolve candidates ─► GATE identity-approval ─► transaction[ prepare ─► bind ─► fence ─► commit ─► proof ]
        (UCPath search +            (operator)               ▲
         roster/input record)                                └─ expected subject := gate result
```

**Before the transaction node, never inside it.** Two reasons, both structural: a gate is a long
wait and D26 forbids any park, checkpoint, or interruption between `prepare` and `commit`; and a
staged wizard page cannot survive an operator lunch break. So the run parks *before* acquiring the
transaction lease, releases its browser sessions (D5), and on resume reacquires and stages fresh.

### 14.4 The resolver — what the operator is actually asked

The gate's result schema is strict and typed (doc 02 owns gate-result plumbing; this is the payload
this gate declares):

```ts
IdentityApprovalResult = z.discriminatedUnion("decision", [
  { decision: "approved",  eid: Eid, chosenFrom: "proposed" | "original" | "manual",
    approvedBy: ActorId, approvedAt: Instant, evidenceDigest: Digest },
  { decision: "rejected",  reason: z.string().min(1), rejectedBy: ActorId, rejectedAt: Instant },
])
```

The gate opens carrying a **decision packet** — everything needed to decide *without leaving the
dashboard*, which is the same acceptance standard as the receipt (D82):

- **the input record** as submitted: name, EID if supplied, department, last day worked, source
  (typed / roster row + file digest / OCR record + page);
- **each candidate** UCPath resolved: EID, legal name, department, payroll title, job/appointment
  status, and — decisively for `T002173685` — **whether more than one candidate matched**;
- **why the system proposes this one**: match source, similarity tier, confidence, and the fields
  that agreed vs disagreed;
- **disconfirming evidence first** (§14.6): the fields where input and candidate *differ*, rendered
  before the fields that agree.

Actions: **approve this candidate** · **enter an EID manually** (8-digit, re-validated against a
live read before it can be approved — a typed EID is an assertion, not evidence) · **reject** with
a reason. `rejected` terminalizes the run `cancelled` with the reason on the receipt; it never
falls through to a write.

**Nothing else can resolve it.** Not a retry, not a bump, not a cascade from a parent, not AI
(charter §23 / D60 — AI may not resolve a gate), and not a generic "Done" action (D44's rule for
parked writes applies identically here). The command arm is the typed gate-resolution arm (D67).

### 14.5 Staleness — an approval is an observation, not a permanent fact

An approval made against candidate data read at `t` asserts nothing about the world at `t + 3 days`.
So the gate result carries `approvedAt` and the **`evidenceDigest` of the exact candidate packet
shown**, and the transaction node declares a freshness limit on both (D8/D34 — this is field
provenance, not a special case). On resume the kernel re-reads the candidate and:

- **identical digest, within limit** → proceed to prepare with `expected := approved subject`;
- **within limit but the candidate changed** (new job status, new department, now-ambiguous) →
  **re-open the gate** with the diff highlighted — an approval never survives the disappearance of
  what it approved;
- **outside the limit** → re-open the gate. `Infinity` is illegal here (D8 forbids it for identity
  facts) and there is no field-scoped override arm: identity is on the never-overridable list.

### 14.6 Adversarial self-review — how this control rots

| # | How it fails | Guard |
|---|---|---|
| 1 | **Rubber-stamping — the dominant risk of ALWAYS-GATE.** A gate that fires on every run, and is almost always obviously correct, trains the operator to click approve without reading. The legacy mismatch-only gate was *rare*, so it carried signal; an always-gate carries none by default and could end up strictly worse than the old behaviour | The packet leads with **disconfirming evidence** (differing fields first), and the approve control is **not uniform**: a single unambiguous high-similarity candidate is a one-click approve, while **any** ambiguity — 2+ candidates, a `different` similarity tier, an EID conflict, a manual EID — requires an explicit distinct action (choose-a-candidate, or type the EID). The shape of the decision changes with its risk, so a risky one cannot be dispatched by muscle memory |
| 2 | **The gate is bypassed by a resume/retry path** | Gate resolution is a typed run-state transition owned by doc 02, not a `data` flag. A resumed run whose gate result is missing/expired/digest-mismatched re-opens the gate; a commit whose `expected` subject has no backing approved gate result **cannot fence** — the binding proof has nothing to bind to. Guard: `identity-gate-before-separation-commit` asserts every separation descriptor's commit is graph-reachable only through the gate node |
| 3 | **Approval drifts from the thing approved** | `evidenceDigest` + `approvedAt` + the re-read on resume (§14.5) |
| 4 | **The approved person and the staged page diverge** | not this gate's job — §binding proof re-observes at the fence. The two-layer split is the guard |
| 5 | **Gate result becomes free-form control state** | D67: the span event carries a validated resolution key + payload hash; the payload itself lives in SQLite/checkpoint under this schema |
| 6 | **Who approved is lost** | `approvedBy: ActorId` is a D75 multi-user seam — required from day one, never trimmed, and carried onto the receipt (D82) so the double-check shows the human in the loop |

**Honest residual.** This gate makes a wrong-person termination require a *human* to approve the
wrong person while looking at the disconfirming evidence. It does not make the class impossible —
no local control can, because the operator is the authority on which person is correct. What it
does eliminate is the class of wrong-person write that happened *with no human ever seeing the
candidate*, which is exactly what `T002173685` was.

### 14.7 Open question deliberately left to migration

The gate is designed here; two values belong to the separations §b questionnaire: the **freshness
limit** on the approval (how long may an approval sit before re-gating — hours, not days), and
whether **I-9 separations** show a different candidate packet than Kuali separations (the operator
distinguishes the two types; the resolver schema is shared either way).

### 14.8 Scope — the Kuali timekeeper-annotation workflow takes NO identity-approval gate (D127)

**Ratified by the operator 2026-08-04.** `kuali-timekeeper-annotation` — the Phase-2 transaction
proof (§Phase 2 transaction-proof as-built, D122) — **does not get an identity-approval gate.** Its
wrong-person safety rests entirely on the **machine-verified subject binding**: the write sequencer
reads the EID displayed on the live document and produces **zero fence and zero click** on
mismatch, on an unreadable EID, or on a subject that changed after `prepare`. That is a proven
control in this tree, not an assumption — the dry-run half drives those exact arms at beat ① and
beat ③ over a real authority database.

**Why the gate does not attach, stated as a rule and not as a preference.** §14 exists for the
wrong-**business-selection** class: a run resolves *which human* to act on from a name search or a
roster, and no page observation can catch a correct-looking selection of the wrong person. This
workflow resolves nothing. The operator supplies the document, the run opens that exact document by
its deep link, and the only question left — *is the document in front of me the one I mean?* — is a
question the page can answer, which is precisely what binding does. Adding a gate here would ask
the operator to confirm an identity the machine already verified against the live page, on every
run, which is §14.6 risk 1 (rubber-stamping) manufactured deliberately: gates that carry no signal
train the operator to click through the ones that do.

**This is a SCOPED decision, not a general waiver, and must never be cited as one.** D77's
ALWAYS-GATE policy is untouched and still binds every separation-class workflow, both types. More
generally **D77 still binds any commit that consumes an operator-approved subject**: where a run's
`expected` subject originates in an operator decision, the gate is mandatory, the binding proof
still runs at the fence, and neither layer substitutes for the other (§14.1). The exemption here is
narrow and rests on two facts that are checkable, so a future workflow claiming it must show both:

1. **The subject is not selected by the run.** It arrives as an operator-supplied document/record
   identity, and the run never resolves a person from a search, a name match, or a roster row.
2. **The write files nothing of separation class.** `kuali/save-timekeeper-annotation` writes a
   benign annotation field on a draft, reversible by writing the captured previous value back
   (D122/D78). It does not terminate, hire, pay, or separate anyone.

Lose either fact — the workflow starts resolving a person, or its target widens past the annotation
field — and §14 attaches again. Recording that boundary is the point of writing this down: the
exemption is a property of this graph, and it expires the moment the graph changes.
