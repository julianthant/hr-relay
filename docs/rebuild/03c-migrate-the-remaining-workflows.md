# 03c · Phase 3c — migrate the remaining workflows

This doc is the dedicated home of **Phase 3c**, tree node `{#migrations}` — the remaining twelve
workflow migrations after separations. Phase 3 is three docs: **3a** finishes the dashboard
(`03a`), **3b** finishes separations (`03b`), **3c** is this one. It holds those tasks, what is done
and what is left, and its exit criteria; contracts it built live in `reference/`. It also hosts
**§Testing tiers** — the shape every migration below adds its tests to — because the tiers are a
property of migrating a workflow, not of any one workflow; the tiers' own normative spec is
`reference/guards-and-tests.md`.

## Phase summary
<!-- roadmap: migrations -->

<!-- roadmap-status: migrations -->
- [x] the risk-proof order is fixed and its entry point is chosen — separations (order 8) first, the table deliberately NOT re-sequenced (D84/D193)
- [x] order 0 · person-lookup is migrated and live-proven (D74, run `4ebf7275-0158-49af-a78f-1f37948efb27`); `src/workflows/person-lookup/descriptor.ts` is registered
- [x] the seven-step loop, the §b questionnaire and the per-workflow exit criteria are written and have been run once, by separations (doc 03b)
- [ ] orders 1 · 2 · 3 · 4 · 5 · 6 · 7 · 9 — **no descriptor exists for any of them**; `src/control/workflow-registry.ts` registers 8 modules and every one is person-lookup, `kuali-timekeeper-annotation` or a separations chunk
- [ ] the five declaration-only stores — `i9`, `old-kronos`, `onbase`, `servicenow`, `sharepoint` are `declareDriver(…, "unwired")` with `{}` tasks (7–12 lines each); orders 1, 2 and 7 build them
- [ ] the legacy capability register — **47 open · 20 replaced · 7 native · 4 retired** of 78 (recounted from `config/legacy-capabilities.json`, 2026-08-20); all 47 open name milestone `phase-3-workflow-migration`, and cutover requires zero open
- [ ] every `Dashboard · wire <workflow>` sub-task — nine of them, one per order; only `{#order-0-dash}`'s four squares are ticked
- [ ] the T1/T2 PROOF lines on every order node — the tiers are specified (`ref guards-and-tests` §10, dc2901de) and no workflow has its pair yet
> 2026-08-20 | docs-cohesion 03c | verified against `src/control/workflow-registry.ts:38-47`, `src/workflows/*/descriptor.ts` (8 files), `src/stores/*` and `config/legacy-capabilities.json` (recount 47/20/7/4 matches the tree's note); left: every order after 0, minus 8
<!-- /roadmap-status -->

**Phase 3c is the rest of the program.** Phase 3a built the dashboard every workflow inherits and
3b takes separations — the deepest write — through the loop once. 3c runs that same loop for the
**twelve remaining workflows**, one at a time, in the order below, until the legacy capability
register has no open entry left and the cutover gate (doc 05) can be read.

**What it reads as met before it starts.** From **03a**: the generic surfaces — run modal, queue
row, run detail + timeline, gate ceremony, notifications, archive · activity · explorer, intake and
capture — exist and answer for a workflow they were not written for (Track C proved that once
against a real composed run). A migration WIRES them; it never builds one. From **03b**: the store
task libraries the entry was chosen to force into existence (`ucpath` 10 tasks, `kuali` 10,
`new-kronos` 2, `crm` 2, `separations` 9 service tasks), the ALWAYS-GATE identity approval, the
typed start door (D250/D251/D261), and the wiring pattern each `Dashboard · wire` sub-task repeats.

**The honest state at HEAD.** One of the ten order rows is migrated. `src/control/workflow-registry.ts`
registers eight modules: `person-lookup` (order 0), `kuali-timekeeper-annotation` (the D135
transaction proof — not an order row), and the six separations descriptors (order 8, doc 03b).
**Orders 1, 2, 3, 4, 5, 6, 7 and 9 are pure plans** — no descriptor, no module, no tuple entry.
`config/pending-impl-bindings.json` is the checked-in EMPTY set, so nothing is half-bound either.

**The rule every order below inherits.** A migration is not done when its workflow runs. It carries
(1) its own `Dashboard · wire <workflow>` sub-task — the seven wire squares of
`ref frontend-backend-integration` §5.1.1–§5.1.7 plus whatever that workflow is first to need —
and (2) its **T1/T2 PROOF** lines: a structural fixture scenario and a live dry-run scenario for the
workflow, and a dashboard scenario for the surfaces it wired (`ref guards-and-tests` §10.11/§10.12).
Neither is optional and neither is 03a's job.

## Recommended migration order (by risk / complexity / reuse)

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.3 — its order-8 prerequisite block moved to `00-design-the-foundation.md` §ALWAYS-GATE identity approval, because D77 pulled that design into Phase 0 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**The ordering objective, made explicit (D84, amended by D88/D89).** Production availability does
not vary by migration order because legacy automation remains authoritative until one final
cutover. The order optimizes **total rebuild delivery time** by maximizing reuse leverage—each
migration must make the next cheaper — which is what the risk-ordered sequence below already does
(reads populate the stores every later workflow draws from; the OCR service pipeline unblocks four
consumers; the write-heavy workflows land last on top of everything).

**The trade this makes, stated plainly.** Onboarding and separations migrate last (orders 8–9).
That is deliberate: they are the highest-stakes writes, they reuse the most, and doing
them early would mean proving the write-safety contract on the two workflows least able to absorb
a contract flaw. The existing workflows continue serving production while this sequence runs, and
the separations identity-approval gate (doc
ref write-safety §14) is designed in Phase 0 rather than at order 8, so nothing about that workflow is
discovered late. If a dependency or evidence target becomes the binding constraint, this order is
the thing to revisit.

**Read this table beside the entry choice (D193, 2026-08-12).** The operator entered Phase 3 at
**order 8, separations** — see §3.1's entry block for the store-population reasoning. The table is
deliberately **not** re-sequenced: it is the risk-proof ordering and its argument above still holds,
so the entry buys the deepest proof first rather than making it cheaper. Nothing here is waived —
separations owes every §3.2 criterion, and the remaining orders keep their relative sequence for
whatever is taken up next.

Read-only and simple first (populate the read stores, low blast radius); OCR/approval flows next
(exercise the completion union + gates); write-heavy last (the write-safety contract's real test),
with the two **incident** workflows (onboarding duplicate-person, separations wrong-person) dead
last as the highest-stakes proofs.

| Order | Workflow(s) | Class | One-line justification |
|---|---|---|---|
| 0 | **person-lookup** | read | Phase 1 spine proof; runs live before any later migration |
| 1 | **person-lookup** (Search + Match modes), **i9-lookup** | read | Both Person Lookup questions and the signer lookup are pure UCPath reads; the two modes prove one workflow descriptor can preserve distinct system surfaces without a second workflow identity |
| 2 | **crm-doc-download**, **sharepoint-download**, **old-kronos-reports** | read/download | Single-system reads/downloads; stand up crm/sharepoint/old-kronos stores at low risk |
| 3 | **ocr** pipeline workflow (consumes the Phase-2h service stores) | service | No browser, no submit; the `extraction`/`normalization`/`ocr`/`roster` service stores are already built in **Phase 2h** (§3.5) — this order migrates the pipeline *workflow* on top of them, unblocking every OCR/contact/roster-dependent workflow below |
| 4 | **oath-signature**, **emergency-contact** | OCR fan-out + light write | Exercise the completion union (D11) + approval gates (D5) + operation-member fan-out; the write is a bounded UCPath enter/fill |
| 5 | **i9-check** | UCPath read + durable roster projection | Operation coordinator + member enqueue + display-only rows, but **no external submit**; its stable-keyed SQLite outbox + serialized workbook projector must prove retry-safe local materialization |
| 6 | **work-study**, **kronos-pay-rule** | single write | First workflow-specific production commits—small, isolated; validate receipt/save proof on the proven transaction kernel |
| 7 | **oath-upload**, **onbase** | write-heavy (ServiceNow + OnBase) | Prove ServiceNow `receipt`; resolve only OnBase OQ2 (`upload-verify` vs `unverifiableByPage`); oath-upload ports the born-at-upload fence |
| 8 | **separations** | write-heavy (UCPath term + Kuali) | Wrong-person incident (`T002173685`); needs UCPath `receipt` probe + pending-sweep + Kuali `save-verify` + identity-approval gate — the deepest write-safety proof |
| 9 | **onboarding** | write-heavy (UCPath hire) | Duplicate-person incident; the hire probe (no-EID key, `ProbeVerdict`-widened) + roster ingest — last, highest-stakes, most reuse of everything below it |

**OCR review UI lands WITH the OCR workflow (orders 3–4).** The OCR review/approve surface belongs
to the OCR workflow's own surface set and is built native together with the OCR pipeline (order 3)
and its first approval consumers (order 4), so the completion union + approval gates are exercised
by the real review UI. Per the 2026-07-24 layout ratification it renders as an **expanded page ↔
extracted-text pair** — each PDF page beside the fields extracted from it, never a collapsed
table. Production continues using the isolated legacy OCR surface until the single cutover.


**Order-6 canonical-EID audit gate.** The base decision is already made: `Eid` is
`/^10\d{6}$/`; there is no `legacyEid`. Before work-study/separations rebuild-ready status, replay their real
stored/fixture inputs through the canonical schema and surface every rejection. If evidence reveals
a genuinely different source identifier, model it under a specific domain name/brand with an
explicit verified conversion to `Eid`; do not widen the canonical type. This is an evidence gate,
not an unresolved architecture choice.

## The §b migration questionnaire (reusable template)

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.4 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

Embed in **every** workflow's migration plan doc; answer with the operator BEFORE building
(charter §b). Grounded in ref write-safety (write-safety) + 11 (freshness/instance) + 02 (gates).

1. **Real commits** — which actions mutate the external system? For each, define a prepare contract,
   commit contract, one transaction lease scope, stable idempotency key, expected subject,
   post-prepare semantic observation, normalizer/matcher, and mismatch/unknown evidence.
2. **Completion check per submit** — receipt (UCPath/ServiceNow: source of the confirmation/ticket
   number + its schema) | save-verify (Kuali: the read-back task) | upload-verify (OnBase: the
   positive read-back, OR an argued `unverifiableByPage`→always-park)? (Ref write-safety §2.)
3. **Double-submit probe policy and age budget per transaction** — `"always"` or
   `"retries-and-recovery-only"` (may miss only an older external write on an unseen durable key)? Required, no default
   (ref write-safety §5 / D17). What justified `probeToFenceMaxMs` bounds preparation after the live probe?
4. **Dry-run preview** — confirm what prepare evidence is shown and whether the run stops there;
   commit is structurally absent.
5. **Freshness maxAges — justify the *value*, not just its presence.** For each read whose output
   feeds a write, state default/field freshness limits, whether each non-identity field is
   `forbidden|audited` for override, and **why each is right**
   for this data's staleness risk — the guard only checks the field is *present*, never that the
   value is *correct*, so the operator owns justifying it (a too-large window silently reuses stale
   data into a live write). Identity, match/item, idempotency, and proof fields are never overridable;
   `Infinity` must be argued in a comment.
6. **Workflow-specific gates/data** — identity-approval gate? OCR approval gate? EID re-match?
   roster column mapping/intake manifest, mobile capture, or normalization approval (ref data-intake-and-edit-data)?
   per-run test/prod instance need (ref clock-config-secrets §4)?
7. **Reuse map** — which store tasks reused (peer-to-peer), which new, and for each new task: its
   reusable-base design + the workflow-specific customization (charter §3/§8). Which canonical
   UI element/page-state/observation ids and typed driver methods are reused or added? Are any names
   copied search terms or migrations rather than new concepts?
8. **Local artifact effects** — does a read download immutable bytes (content-addressed writer), or
   does the workflow update a mutable local file? Mutable targets require a stable-keyed blocking
   outbox projection, idempotent upsert semantics, and expected-version concurrent-edit policy—not a task
   append.
9. **Scenario inventory** — enumerate happy, no-match/empty, ambiguous, schema error, transient,
   permanent, every branch/gate/delegation/control path, subject mismatch, proof unknown, crash,
   retry, and discovered real-world variants that apply. Name truly impossible variants and why.
10. **Delegation and queue policy** — enqueue policy; standard actions; for every child edge: stable
    item id, typed result, cardinality/join, child failure, cancel, child retry/parent resume, and
    visibility. Include two-edge behavior when the workflow delegates more than once.
11. **Trust contract** — what evidence makes each terminal outcome `verified|partial|unknown`? What
    artifacts/screenshots/proofs are required, what is redacted, which failures/notifications fire,
    and how does `explain run` answer “what happened?”
12. **Authoring boundary** — workflows remain source-authored; DSL/codegen is cut. Which closed
    presentation/policy edits may the editor apply, and which requests must become a code-change
    brief? Selectors, schemas, bindings, proof, and graph structure always remain code work.

## Non-workflow capability closure inventory (D58)

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.6 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

Workflow directories are only part of the old program. The rebuild repo's
`config/legacy-capabilities.json` is created in 1a from a legacy source inventory and maintained
through rebuild, cutover, and any later retirement. Every entry has a stable
capability id, non-empty source paths, kind (`service|route|dashboard|cli|export|codegen|maintenance|
dev-tool`), known consumers, one strict disposition, owner milestone, verification evidence, and
status. Dispositions are a discriminated union:

- `native { milestone, targetIds }` — equivalent/improved native capability exists;
- `replaced { milestone, replacement, differencesAccepted }` — intentionally solved another way;
- `retired { milestone, evidence, reason }` — proven unused/unwanted; “seems dead” is insufficient;
- `candidateForRetirement { evidence, requiresOperatorAuthorization: true }` — replacement proof is
  complete, but legacy source remains preserved until a later explicit retirement decision.

**D88/D93 boundary:** `proxy` is not a disposition. The rebuild never calls a legacy endpoint and the
legacy runtime never calls the rebuild. A capability is implemented native/replaced inside the
rebuild repo, deliberately retired in the target, or remains open; completed replacements may
be marked `candidateForRetirement` without deleting the production/rollback source.

The initial grouped decisions are:

| Legacy capability family | Binding disposition and milestone |
|---|---|
| `services/capture` + capture routes/components/ngrok | native durable capture foundation in 2h/2i; legacy route/service/UI preserved through cutover |
| `services/address` + `llm/normalize-contact` | replaced by `normalization` service contracts in 2h; OCR order 3 proves real contact normalization/approval parity |
| OCR vision provider pool/rate limits/key status | generic admission/budget core in 1f; production pool/key-status adapters + OCR store in 2h; OCR workflow/order 3 closes legacy provider consumers |
| LLM triage/sanity/selector/summarize routes + ops scripts | native optional advisory adapters in 2i after trust surfaces; deterministic explain/rules/catalog remain primary; no authority edge |
| `services/matching` | roster/domain identity contracts in 2h; each real consumer closes during orders 3–9; no hardcoded header matcher survives |
| `services/timecard` | pure Clock-injected domain range logic + semantic common driver helper in 1d; Old Kronos adapter closes at order 2, New Kronos at order 8 after its last separations consumer |
| queue/task/dependency/worker/browser/daemon control routes | native command/worker/session protocol in 1f and operator UI in 2i; legacy routes remain isolated rollback code |
| files, screenshots, search/failures, SSE/projection routes | native projection spine in 1g, then artifact/evidence/query UI in 2g/2i; no cross-runtime imports or route forwarding |
| settings, preflight, credentials reference | native strict config/secrets foundation in 1b and storage-health UI in 2i; no legacy proxy ships |
| workflow presentation/design/data-bank/modifier | read-only explorer and constrained editor/replacement in 2i; old generated design briefs remain preserved with `src`, while useful history may be copied with provenance and never becomes runtime authority |
| OCR review/approve/retry/research/discard routes | native OCR workflow/gates/commands at orders 3–4; legacy routes remain isolated and production-authoritative until cutover |
| oath-upload/sharepoint and other workflow-special routes | absorbed into descriptor start surfaces and standard commands at that workflow's migration; legacy routes remain rollback code |
| export to xlsx, setup, test-login, tracker clean/compact, schema/catalog/search codegen | native CLI/maintenance work items attached to 1b/1d/1g/2i as appropriate; behavioral CLI fixtures and help output required before cutover |
| one-off debug/dev helpers (for example Kronos debug and dashboard dev components) | port only if a named supported diagnostic remains; otherwise retire with zero-consumer search plus accepted replacement/evidence |
| general `utils`/infra helpers | no bulk copy; each consumer-driven port maps to domain/infra/store ownership, and the capability guard blocks an orphan at cutover |

**Entry semantics as-built (D184, 2026-08-09).** The union above is unchanged in intent; three
things are now pinned by `legacy-capability-disposition` rather than left to prose.

- **`open` carries a required `reason`.** `{kind:"open", milestone}` alone is how 73 of 78 entries
  came to name milestones that had already shipped — nothing in the record contradicted them. An
  entry that moves to a later milestone must say why it moved.
- **`status` is the disposition's projection, not a second opinion.** It is
  `open | implemented | retired | retirement-candidate`, mapped one-to-one from the disposition
  kind (`native`/`replaced` → `implemented`). A two-valued flag would have had to call a
  retirement "implemented".
- **Every disposition arm carries `milestone`,** including `candidateForRetirement`, so
  `ownerMilestone` has something exact to agree with.

And the rule the sweep is applied under: **a wrong `native` claim is worse than an honest `open`.**
A family whose core landed but whose operator-visible half did not stays `open` and names what is
missing; only an evidenced, resolvable target closes an entry.

At every workflow rebuild-ready milestone, the commit updates affected capability entries and the
legacy-change-accounting map. Before cutover, the guard requires zero undecided/missing entries,
every `retired` target decision has evidence, every native/replaced target resolves, every old
route/service/script/component path is covered exactly once, and the final CLI/help/dashboard
inventories match. Nothing in this inventory authorizes legacy deletion.

## Live probe status (the design assumptions still unproven)

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.8 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

Ref write-safety's write-safety contract requires each system to produce a typed completion proof. For two
of four systems that is still an *assumption*. The Kuali probe showed how cheap it is to settle:
half a day of pre-authorized live access resolved a years-deep open question **and** produced four
design constraints (save is UI-silent so reload read-back is mandatory; date values render as
child text nodes; DOM refs change every reload so anchor on role + exact label; ~8–10s per
fill→save→reload→verify cycle) that would otherwise have been discovered mid-migration.

**D92 gate placement is ratified:** these probes are mandatory at the milestones below and are not
Phase-1 blockers. Deferral changes timing only; it does not waive proof.

| System | Completion arm | Status | Gate |
|---|---|---|---|
| **Kuali** | `save-verify` | ✅ **RESOLVED buildable** (live probe 2026-07-23, docs 4444/4453; read-only + a full write round-trip restored byte-identically) — **BUILT 2026-08-04** as `kuali/verify-timekeeper-annotation`, with its three element recipes ported and re-verified read-only the same day | — |
| **UCPath** | `receipt` (`T…` transaction number) | ✅ **RESOLVED buildable — and the arm as specified was WRONG** (live probe 2026-08-04, D130; **read-only, no transaction created**, so the authorized submit was not spent). The `T…` lives on SS Smart HR's transaction detail (`UC_EXTENSIONS.UC_SS_TBH.GBL`), NOT on the submit and NOT on the Transaction Status dashboard, which has no Transaction ID column at all. **A Denied transaction carries a well-formed `T…`** (`T002204014`; 300 Denied rows live), so the proof is the PAIR `(transactionNumber, approvalStatus)` — ref write-safety §2.2's number-only schema is corrected. Six constraints in ref write-safety §13.6 | residual submit-side questions before Phase 2's controlled commit |
| **ServiceNow** | `receipt` (`HRC0…` from the post-submit redirect) | ⏳ operator naming a target | before order 7 |
| **OnBase** | `upload-verify` or `unverifiableByPage`→always-park | ⏸ **blocked — no probe target exists today**; gated on the next real document upload | before order 7 |

**A fifth Kuali constraint, found on the 2026-08-04 read-only re-verification (D122):** an
`actionId` is **not stable across workflow steps**. Doc 4453's 2026-07-23 action id no longer
resolved to a form — it silently redirected to the Action List. A deep link is reload-safe *within*
a step and nothing more, so a run carries the action id AND the document number, and the driver
proves the opened document's number from its level-1 heading before touching anything. The three
ported anchors (`EID*`, `Timekeeper Name:*`, `Save`) each resolved to exactly one live node, and
`Save` sits in one action group with `Send Back` and `Mark Complete` — which is why its port drops
legacy's three-deep `.or()` chain and keeps only the exact role+name branch.

**The UCPath probe changed what "settling a probe" costs (D130, 2026-08-04).** It was authorized to
create one real transaction and did not need to, because **an already-FAILED transaction is a better
witness than a fresh one**. A new submit can only ever show the `Pending` shape; the live system
already held 300 Denied and 300 Pending transactions, so reading a Denied one answered the probe's
deepest question — *is "submitted" distinguishable from "looked submitted"?* — strictly better than
writing would have, and it answered it in the direction nobody had assumed: **it is not**, because a
refused transaction carries a perfectly well-formed `T…`. Before spending a write on a probe, look
for a real record already in the state you are trying to manufacture. Two of UCPath's six
constraints (submit-side receipt silence, propagation window) genuinely need a submit and remain
ported-from-legacy rather than rebuild-verified; that is the honest residual, and it is much smaller
than the whole question was.

Each probe is read-only-plus-restorable in the Kuali shape: read the completion surface, confirm a
deterministic anchor, and where a write is authorized, write → verify → restore. If OnBase lands
on `unverifiableByPage`, order-7 automation degrades to "operator manually confirms every upload"
— which changes the rebuilt workflow contract, so it must be settled at order 7 before readiness.

## Testing tiers
<!-- roadmap: test-tiers -->

<!-- roadmap-status: test-tiers -->
<!-- /roadmap-status -->

`tests/` is organized by **what a test needs**, and this is what every migration below adds its
tests to. The **no-dry-run** tests — unit, the architecture guards, ONE honest structural fixture
scenario per workflow, the dashboard feature scenarios, and parity — run per commit, per workflow
update, and all of them on a dashboard update. Every test that must RUN a workflow is built on a
**live dry run** of it (`dryRun=true`), declared as a scenario with **checkpoints asserted over
authority** (nodes reached, checkpoints, gate results, write intents, receipt shapes — Track C's
`docs/migrations/separations.md` §9.22 double-entry, as a file), **subject-parameterized** against
a canary registry per workflow (labels live in the repo, sensitive values — EIDs — stay in `.env`
and are referenced by label; a missing subject reports `blocked: needs <subject>`, never
`failed`), with **dashboard conditions attachable** (drive the real ceremony while the run is
parked, assert the timeline while it is running) and the result **recorded durably** — an evidence
row plus a dated line in the workflow's migration record, which is what a `PROOF` tick on a
migration node cites. The **end-to-end tier** is an agent-operated run of MANY dry-run scenarios in
parallel, across workflows and across two runs of the same workflow (`{#parallel-runs}`). Fixture
scenarios that pretend are rewritten into the honest structural one or into a dry-run scenario.
The coverage floor moves to **80 %** lines/statements/functions global. So a migration below owes
three test artefacts, not one: its T1 pair (the structural fixture scenario and the dry-run
scenario), its T3 pair (the dashboard conditions attached to that dry-run scenario), and its
`Dashboard · wire` task's T2 dashboard scenario. The normative spec — folder layout, file naming,
the vitest project per tier, the run policy, the subject registry, the durable result row — is
`reference/guards-and-tests.md` (R10, 2026-08-20).

## Order 0 · person-lookup
<!-- roadmap: order-0 -->

<!-- roadmap-status: order-0 -->
<!-- /roadmap-status -->

### Dashboard · wire person-lookup
<!-- roadmap: order-0-dash -->

<!-- roadmap-status: order-0-dash -->
<!-- /roadmap-status -->

## Order 1 · person-lookup Search + Match · i9-lookup
<!-- roadmap: order-1 -->

<!-- roadmap-status: order-1 -->
<!-- /roadmap-status -->

### Dashboard · wire Search + Match · i9-lookup
<!-- roadmap: order-1-dash -->

<!-- roadmap-status: order-1-dash -->
<!-- /roadmap-status -->

## Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports
<!-- roadmap: order-2 -->

<!-- roadmap-status: order-2 -->
<!-- /roadmap-status -->

### Dashboard · wire the downloads
<!-- roadmap: order-2-dash -->

<!-- roadmap-status: order-2-dash -->
<!-- /roadmap-status -->

## Order 3 · the OCR pipeline workflow
<!-- roadmap: order-3 -->

<!-- roadmap-status: order-3 -->
<!-- /roadmap-status -->

### Dashboard · wire the OCR pipeline
<!-- roadmap: order-3-dash -->

<!-- roadmap-status: order-3-dash -->
<!-- /roadmap-status -->

## Order 4 · oath-signature · emergency-contact
<!-- roadmap: order-4 -->

<!-- roadmap-status: order-4 -->
<!-- /roadmap-status -->

### Dashboard · wire oath-signature · emergency-contact
<!-- roadmap: order-4-dash -->

<!-- roadmap-status: order-4-dash -->
<!-- /roadmap-status -->

## Order 5 · i9-check
<!-- roadmap: order-5 -->

<!-- roadmap-status: order-5 -->
<!-- /roadmap-status -->

### Dashboard · wire i9-check
<!-- roadmap: order-5-dash -->

<!-- roadmap-status: order-5-dash -->
<!-- /roadmap-status -->

## Order 6 · work-study · kronos-pay-rule
<!-- roadmap: order-6 -->

<!-- roadmap-status: order-6 -->
<!-- /roadmap-status -->

### Dashboard · wire work-study · kronos-pay-rule
<!-- roadmap: order-6-dash -->

<!-- roadmap-status: order-6-dash -->
<!-- /roadmap-status -->

## Order 7 · oath-upload · onbase
<!-- roadmap: order-7 -->

<!-- roadmap-status: order-7 -->
<!-- /roadmap-status -->

### Dashboard · wire oath-upload · onbase
<!-- roadmap: order-7-dash -->

<!-- roadmap-status: order-7-dash -->
<!-- /roadmap-status -->

## Order 9 · onboarding
<!-- roadmap: order-9 -->

<!-- roadmap-status: order-9 -->
<!-- /roadmap-status -->

### Dashboard · wire onboarding
<!-- roadmap: order-9-dash -->

<!-- roadmap-status: order-9-dash -->
<!-- /roadmap-status -->

## Cross-cutting Phase 3 capabilities (no single order)
<!-- roadmap: cross-cutting -->

<!-- roadmap-status: cross-cutting -->
<!-- /roadmap-status -->

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

**No round has been ratified for a remaining order yet** — the migrations after separations are
unstarted, so this list is the standing set the loop runs under rather than a record of work:

| D | Where it binds |
|---|---|
| D84 (round 8, 2026-07-23 → 07-26) | the reuse-leverage ordering the §Recommended migration order table encodes |
| D89 (round 10, 2026-07-31) | rebuild-ready is not a production flip — one all-at-once cutover, step 6 of the loop |
| D58 (round 5, 2026-07-22) | the non-workflow capability closure inventory each migration advances |
| D92 (round 10, 2026-07-31) | the live probes are mandatory at the milestones §Live probe status names |
| D193 (round 47, 2026-08-12) | the entry point — separations first, the table deliberately not re-sequenced |
| D191 (round 46, 2026-08-12) | the per-commit gate every migration's step 3 runs |

A round ratified by a future migration is added here in the same commit that records it.

## Exit criteria

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.2 — the per-workflow exit criteria every migration answers, separations included on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

- §b questionnaire answered + recorded in the workflow's migration doc.
- the rebuild repo's `typecheck` + `lint` + `test` + `test:architecture` green; the workflow's descriptor passes
  `descriptor-coverage`; every commit contract passes `write-safety-contract` (its completion arm +
  probe + probe-policy) and transaction pairing.
- Workflow/task inputs, outputs, results, commands, details, and evidence parse strict; every UI id,
  scenario id, child result/policy, and subject observation resolves. No raw Page/Locator/selector
  appears outside the system driver.
- **Live dry-run** green against every real system it touches (submit-free).
- Every commit/probe/verify has controlled live evidence on the configured target; unavailable safe
  evidence blocks rebuild-ready status rather than converting dry-run success into a write-safety claim.
- Old per-system `src` code and tests remain runnable and preserved through initial cutover. A
  capability may become `candidate-for-later-retirement`, but deletion requires separate explicit
  operator authorization after cutover and rollback-window closure.
- Every old service/route/dashboard/CLI/tool capability touched by the workflow has an updated D58
  disposition; every native replacement has evidence. Under D93 the rebuild repo cannot import
  legacy source at all — the old runtime-isolation guard is retired because the property is
  structural. Preserved legacy paths are not deleted by this migration.
