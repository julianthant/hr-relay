# Rebuild Roadmap — Operator Tracking View

> **This is a derived convenience view, not a source of truth.** The plan SSOT is
> `docs/rebuild/07-master-plan.md` (phases, exit criteria) and the owning docs 00–13; the decision
> changelog is `docs/rebuild/04-reconciliation.md`. If this file ever disagrees with those, **they
> win**. Sessions: regenerate the status sections of this file at every slice boundary.
>
> **Last updated:** 2026-08-12 · Phase 2 closed · decisions through **D193** · schema **v13**

---

## 1 · At a glance

| Fact | Value |
|---|---|
| **Scope** | **Solo, local, never hosted** (D193) — one operator, one machine; "production" = the day this replaces legacy as your daily **local** tool. *Later, unplanned:* package it as a locally-run app ("web app → real app"); a cooperation/multi-user mode built **on top of** solo, if ever |
| Runtime phase marker | `completedThrough: "2j"` · `active: "3-workflow-migration"` |
| Phases complete | 0, 1 (a–e, f, g-spine, i-spine), 2 (proof + 2g + 2h + 2i + 2j) |
| Active phase | **Phase 3 — per-workflow migration**; **building separations chunk 1** — the `new-kronos` store + timecard-read sub-workflow, order 8 (D193), questionnaire fully answered 2026-08-12 |
| After Phase 3 | The one all-at-once cutover (D89/D93), then rollback-window closure |
| Decisions ratified | D1–D193 (D131 is a permanent gap — never reused) |
| Authority schema | v13 (released migrations SHA-pinned, immutable) |
| Guards | **60 active** / 8 retired / 2 planned (`one-time-import-offline`, `preflight-coverage`) |
| Tests | 1602 unit+scenario · 431 architecture · 134 parity · coverage gate green (87.1% lines) |
| Workflows registered | 2 — `person-lookup` (live-proven), `kuali-timekeeper-annotation` (controlled-commit-proven) |
| Legacy capability register | 78 entries: **48 open · 20 replaced · 7 native · 3 retired** — cutover requires zero open |
| Production writes proven | Kuali controlled commit on real doc 4489 (D135): fence → click → read-back → settle, idempotent re-run 2 ms |

**Roadmap position, honestly framed:** the *platform* is finished and proven (execution kernel,
write safety, evidence, storage, intake, capture, operator surfaces, restore/soak drills). The
*product* is ~2 of 15 workflows. Phase 3 is where the remaining 13 legacy workflows migrate onto
the platform one at a time, each with its own live proof. Platform risk is largely retired; the
remaining work is volume with per-workflow verification.

---

## 2 · Completed — Phases 0–2

### Phase 0–1 (2026-07-31 → 2026-08-04)

- [x] **Phase 0** — foundation design; docs 00–13 reconciled (D1–D94); all-at-once cutover ratified
- [x] **1a–1b** — guard plumbing, honest legacy baselines, strict domain leaf, clock/config/secrets
- [x] **1c–1e** — authority storage + recovery + command/write shells; semantic UI registry + drivers; workflow DAG
- [x] **1f / 1g-spine / 1i-spine** — registry, workers, command service, write sequencer; span emission + the ONE projection; Person Lookup parity slice
- [x] **Phase 1 exit (D74)** — live run against real UCPath + CRM, dead-session recovery mid-run, terminal `done` at attempt 2, all four parity surfaces from one projection

### Phase 2 (2026-08-04 → 2026-08-09)

- [x] **Transaction proof (D135)** — controlled Kuali write on real doc 4489: dry-run zero durable rows · forced-mismatch refused pre-fence · commit 16.45 s with reload read-back proof · idempotent re-run `already-present` in 2 ms · propagation window measured on doc 4490 · both docs restored
- [x] **2g — event/trust layer (D134–D145)** — evidence receipts derived from authority, diagnostic bundles with capture-time redaction, durable notification inbox, knowledge/fix records, ordered fsync'd ledger projector
- [x] **2h — data/intake foundation (D146–D167)** — canonical field registry, column mapping, validation + immutable manifests, spreadsheet/PDF extraction, OCR gate (3 producer routes) + i9 form (live-proven on the real 44-page scan), scanner stack, roster + normalization + provider pools, Edit Data core, durable capture
- [x] **2i-A/B/C/D** — trust surfaces, notification bell over the durable inbox, Edit Data rail (D168), Settings + storage doctor + live backup cadence (D169)
- [x] **2i-E — intake surface (D170–D173)** — durable sessions (schema v12), route-creates-session upload, six command arms, atomic manifest fan-out, person-lookup projection, mapping/validation workspace UI
- [x] **2i-F — capture surface (D174/D175)** — token-scoped phone routes (fail-closed), QR start, deterministic PDF bundler, intake handoff, mobile UI, `capture-durability-and-scope` guard
- [x] **2i-G — explorer/advisory/archive (D176–D180)** — read-only Workflow Explorer + UI catalog, AI advisories (redaction/strict-output/exhaustion/zero-authority all fixture-pinned), Archive model (schema v13) + version-bump + Activity report
- [x] **2j — closing gate (D181–D190)** — scenario corpus, **restore drill on a copy of the real authority DB** (corrupt → doctor refuses 0.92 s → restore 0.99 s → healthy), 3-worker soak (no duplicate claims/terminals), concurrency matrix, redaction scan, capability-inventory validation, every owning doc to as-built

**Defects the 2j gate caught that every earlier green gate missed** (kept here as a reminder of why
gates run): `cli storage restore` could never have worked; the run-detail trust panel was 2 px wide
since 1i-spine; every `paper-ink` parity reference was photographed dark; the receipt builder 500'd
on a reachable path; the coverage gate had been red for a whole tail.

---

## 3 · Active — Phase 3: per-workflow migration

### The loop each workflow goes through (doc 07 §3.1)

1. **Operator questionnaire (§b, 12 items) answered BEFORE building** ← *needs you, per workflow*
2. Author: reuse store tasks, add named workflow-specific ones; contracts → scenarios → impls → tests → descriptor
3. The full guard family fires (write safety, dedupe, provenance, scenario coverage, …)
4. **Live dry-run** against every real system it touches (submit-free, asserted zero commit rows)
5. **Controlled commit proof** for write workflows on a test instance or operator-approved canary ← *needs you: target naming*
6. Mark rebuild-ready — but **nothing goes live before the single cutover** (no mixed-engine production, ever)
7. Close the loop: regression scenario, knowledge record, capability disposition, docs

### Entry point — **separations (order 8)**, chosen 2026-08-12 (D193)

You picked separations to go first, and the reason is store population: a big multi-system workflow
**forces the task libraries into existence** — the UCPath termination write family, the Kuali
read + finalization write family, and the **new-kronos** driver, login recipe, and timecard reads
that do not exist at all today — so one migration mints what every later workflow reuses, instead of
trickling the same stores in through small reads. The order table below is **not** re-sequenced: it
stays the risk-proof ordering, so this entry buys the deepest write proof first rather than making
it cheaper. Separations still owes every exit criterion other than the questionnaire —
`docs/migrations/separations.md` holds it, and as of **2026-08-12 the questionnaire is fully
answered**, including §5 item 5's freshness values (residuals **5A** and **5B**); the doc's status
flipped from BLOCKED to **READY TO BUILD**, and chunk 1 (the `new-kronos` store + the
`separations-kronos-timecard` timecard-read sub-workflow) is now underway. Its controlled-commit
target (a UCPath termination + Kuali finalization you approve) is still yours to name at step 5; none
has been invented.

**How it gets built (your directive, recorded in that doc's §3):** bottom-up, not one slice — store
tasks first, then one small provable sub-workflow per system interaction (the Kronos timecard read,
the Kuali doc read, the UCPath termination write, the Kuali finalization write — the two writes each
following the proven `kuali-timekeeper-annotation` single-transaction-node shape), then composed
together. Two directives sit on top of that (§3.1, §3.2): **scenario variability is served by lego
recomposition** — moving and swapping chunks and customizing store items, never growing conditional
branches inside one monolithic workflow — and **every chunk maps exhaustively what it touches** (full
dropdown option lists, every status and branch it meets), so later scenario work finds its raw
material already captured. One honest note recorded there: composing by **real child runs** would mean
wiring the `child-run` seam, which exists typed but is **not wired** in production today — so the
default composition is one descriptor over the reused tasks, and questionnaire item 10 keeps it that
way (lego recomposition is descriptor assembly, not delegation).

### Migration order (doc 07 §3.3) — the 13 remaining legacy workflows

| Order | Workflow | Class | What it does for you | Blocking gaps |
|---|---|---|---|---|
| 0 | ~~person-lookup~~ | read | resolve a person by name/EID | ✅ live-proven (Phase 1) |
| 1 | person-lookup **Search+Match**, i9-lookup | read | HR-Tasks Search/Match; who signed I-9 §2 | i9 store has zero tasks, no login recipe |
| 2 | crm-doc-download, sharepoint-download, old-kronos-reports | read/download | iDocs PDFs; rosters; Time Detail PDFs | sharepoint + old-kronos stores declaration-only |
| 3 | ocr pipeline workflow | service | PDF → extraction → review → fan-out | needs the pipeline workflow + **OCR review UI** |
| 4 | oath-signature, emergency-contact | OCR fan-out + light write | oath date rows; emergency-contact fill | first fan-out + approval gates |
| 5 | i9-check | read + projection | verify I-9 packet, master retention workbook | operation coordinator + workbook outbox |
| 6 | work-study, kronos-pay-rule | **first real writes** | PayPath pool/comp; UKG pay rules | new-kronos store declaration-only; intake constants (`effectiveDate`) |
| 7 | oath-upload, onbase | write-heavy | ServiceNow ticket + PDF; OnBase doc import | servicenow + onbase stores declaration-only; **probe targets need operator naming** |
| 8 | separations | write-heavy | UCPath termination + Kuali finalization | deepest write proof; ALWAYS-GATE identity approval (doc 09 §14) |
| 9 | onboarding | write-heavy | the real hire transaction | last, highest-stakes; hire probe with no-EID key |

**Store driver reality check:** only **ucpath, crm, kuali** have real drivers, login recipes, and
tasks today. `onbase`, `servicenow`, `i9`, `new-kronos`, `old-kronos`, `sharepoint` are 3-line
session declarations with zero tasks — each gets built (with live re-verification of every ported
selector) at its order's migration.

### After Phase 3 — the cutover (doc 07 §4, D89/D93)

Pass every gate → stop new legacy enqueues, drain/park/reconcile everything → back up both repos'
state → run approved offline one-time imports (`one-time-import-offline` guard activates here) →
atomically repoint the launcher → smoke gates. The **entire legacy repo is preserved as the
rollback asset**; nothing in it is deleted until after rollback-window closure with separate
explicit authorization.

---

## 4 · What is needed from YOU

### Needed from you right now

**Nothing right now.** Separations' §5 questionnaire — including the last residual, item 5's
freshness values (5A and 5B) — was answered 2026-08-12 (see *Decided* below); the questionnaire is
now fully answered and `docs/migrations/separations.md`'s status flipped to **READY TO BUILD**. Next
operator input due is step 5's controlled-commit target naming (a UCPath termination + Kuali
finalization to approve), owed later in the build, not now.

### Decided

- **Read tasks are authored RICH: one task per page visit, one fixed strict output, consumers project downstream — the `read(fields…)` shape is banned** — **D194**, 2026-08-12 (doc 01 §2.8, `STORES.md` §1). Applies to all new tasks; existing tasks are not rewritten, and `crm`'s duplicate record/dates page visit merges the next time that store is touched.
- **Separations questionnaire fully answered (2026-08-12) — READY TO BUILD** — `docs/migrations/separations.md`: unmapped termination type **fails loud** plus a live capture of the whole Kuali dropdown (§4a) · an unavailable or unreadable **Kronos hard-fails the whole run** (§4b) · a UCPath-filed / Kuali-unfinalized run **parks** with the transaction number durable (§4c) · **ALWAYS-GATE in every run mode**, no preset or resume can disable identity approval (§4d) · Kuali writes are **staged from variables, one pass, one save, one reload read-back** (§4e) · **no I-9 packet** in this workflow (§4f1) · production **canary** for the commit proof, target named by you at the time (§4f2) · `probeToFenceMaxMs` **measured**, never guessed (§4f3) · the scenario inventory stays open with a **MAP-EVERYTHING** directive on every build chunk (§4f4) · the final-pay radio stays **hardcoded** as your ratified business assertion (§4g) · scenario variability is served by **lego recomposition**, never by branches inside one workflow (§3.1) · and the last residual, **item 5's freshness values**: **5A** — no automatic freshness refresh in separations, the Kuali document/Job Summary/timecard reads all take the argued-unbounded arm (a saved, stable artifact does not churn; refresh only on an explicit operator re-run, including via Edit Data) while the identity-approval gate result keeps its drafted 4-hour bound (`Infinity` is illegal there, D8) · **5B** — every non-forbidden payload field (dates, department, titles) is `audited`, overridable only by explicit operator confirmation and never automatically; identity/person-selection/idempotency-key/write-proof stay `forbidden` for everyone. **Chunk 1 — the `new-kronos` store + the `separations-kronos-timecard` sub-workflow — starts now.**
- **Scope: solo, local, never hosted; local-app packaging and any cooperation mode are LATER and unplanned** — D193, 2026-08-12 (doc 00 §Non-negotiables, doc 12 §7)
- **Storage is done for this scope: manual `.tracker-rebuild/` folder copies (app stopped) are an acceptable backup; retention-sweep scheduling and the artifact refcount are `wont-build-unless-asked`** — D193, 2026-08-12 (doc 12 §D137, doc 03 §2.5). *Why:* this DB stores records of **completions**, not primary records — the real record of a completed transaction lives in UCPath/Kuali and is checkable there; these rows show *how* and *whether* something completed and mean little once it is completed and approved. (Unchanged: the fence rows are still load-bearing **during** a write.)
- **Phase 3 enters at separations (order 8)** — D193, 2026-08-12 (doc 07 §3.1) — chosen to force the store task libraries into existence; §3.3's ordering is unchanged
- **`test:coverage` becomes the per-commit gate** — D191, 2026-08-12 (doc 10 §3.14)
- **AI advisory tools dispositioned: run-summary and selector-suggestion retire; record-sanity-check stays open, deferred to order-8 separations** — D192, 2026-08-12 (doc 12 §4.4)
- **Production byte path timing confirmed: builds at the first phone-consuming migration (orders 3–4), not earlier, not at cutover** — D189 timing confirmed 2026-08-12 (doc 13 §6.9)

### Named to you at specific future gates

- **ServiceNow live-probe target** — name one before order 7 (doc 07 §3.8).
- **OnBase probe target** — none exists today; blocked until you name one (before order 7).
- **Per-workflow §b questionnaire** — 12 answers before each migration starts (doc 07 §3.4).
- **Order-8 identity approval** — separations runs under the ratified ALWAYS-GATE policy; you approve each identity match (doc 09 §14).
- **Canary/test-instance approval** — every write workflow's controlled commit needs a target you approve; dry-run alone can never prove landing (doc 07 §3.1 step 5).

---

## 5 · Deferred features — the X → Y traceback

*"I want to do X; the plan said build Y; Y is deferred."* Every deferral below has a named trigger
— none is silently dropped, and none is "can't ever work." **Two now have a decided stance instead
of a trigger** (the storage rows, D193): they are not waiting on anything, they simply do not get
built unless you ask.

| X — what you'd want to do | Y — what's deferred | Decision | Comes due |
|---|---|---|---|
| Photograph a paper form on your phone → it becomes an OCR-backed run (legacy: QR + ngrok capture) | Capture→workflow binding (`CAPTURE_INTAKE_BINDINGS` is deliberately empty — neither current workflow can honestly derive its input from a photo) | D174/D175 | Orders 3–4 (ocr pipeline, oath-signature, emergency-contact) — a test asserting the empty map fails the day a binding lands |
| Use the phone page in production / run the dashboard without the dev server | BFF static byte serving + tunnel launcher (`rebuild:dashboard:prod` names a mode nothing parses) | **D189** | First migration needing the phone in production; explicitly named a **cutover blocker** |
| See a capture-started run on the queue instantly | `run.queued` span from projector-enqueued runs | 2i-F note | Same day the capture binding lands ("close this first") |
| Edit a workflow's presentation/policy without a code change (legacy: n8n-style graph editor) | Workflow Explorer **edit half** (Phase B) | D186 | The **second** production workflow whose policy an operator wants to change — an editor shaped by a sample of one would be wrong |
| Get a record-sanity-check advisory panel (legacy had one; run summary and selector suggestion are **retired**, D192 — the receipt/explain surface and the deterministic catalog already cover them) | The record-sanity-check advisory arm — deterministic schema/rule issues stay authoritative, model issues are separately-labelled suggestions | D178/D192 | Order 8 (separations) — renders as prose beside the doc 09 §14 ALWAYS-GATE identity approval |
| Edit settings in the dashboard (legacy: 11 editable sections) | `apply-settings` command family — rebuild settings are read-only, "nothing here pretends to save" | D169/D184 | Phase 3 milestone, no single trigger |
| Set a run-wide constant (e.g. work-study `effectiveDate`) / unbind a mapped column | Intake grid constants entry + unbind arm — no command arms exist yet, and a control that pretends would be worse | D172/D173 | Order 6 (work-study), the first workflow needing a non-column field |
| One-click QR without pasting an HTTPS URL | on-demand ngrok launcher (refuses `ingress-not-built` rather than serving a loopback QR that scans and then dies) | D174/D175 | Bundled with D189's owner |
| Auto-purge old diagnostics on the 14/8/5 schedule | Retention sweep **scheduling** (the sweep itself is built and tested; nothing calls it on a cadence) | D169 note → **D193** | **Wont build unless you ask.** Off every milestone; manual folder copies + dirty-only backups are the accepted stance |
| Reclaim disk from unreferenced artifact bytes | Content-store refcount | open question → **D193** | **Wont build unless you ask.** Disk growth on one local machine isn't worth a durable reference count |
| Trust UCPath/ServiceNow wait-before-negative-read windows | Rebuild-verified propagation measurements (currently ported legacy knowledge) | doc 07 §3.8 | Each system's own migration's live probe |
| Search runs across dates / view screenshots / export Excel | No search module, no artifact-bytes route, no export writers in the BFF yet | capability register (open) | Phase 3, shaped against a real run corpus |

**Withdrawn, for the record:** the D128 claim that the Kuali write half was blocked because the
documents sat at a workflow step that couldn't own the field was **wrong** (D135). The real causes
were two rebuild driver defects (a ~700 ms gadget debounce fenced inside; `commit` returning at
request time so the verifier's reload cancelled the save). Both fixed; the commit landed and was
restored with proof. **Write-heavy migration is unblocked** — but every write workflow still owes
its own controlled-commit proof.

---

## 6 · Legacy vs rebuild

### Already built — what the rebuild does differently

| Area | Legacy | Rebuild |
|---|---|---|
| Run kernel | Daemon holds state in memory; crash mid-run leaves the row to be inferred | Authority re-read + CAS before **every** transition; lost claim can never terminalize over another owner; every task races an injected deadline |
| Write safety | No fence; a failed save leaves unknown state; a retry can double-file | Seven beats: probe → prepare → subject binding → **durable fence before the click** → commit → read-back proof → settle; uncertainty **parks** with durable intent; same permanent key re-run answers `already-present` in 2 ms |
| Dry run | A flag the workflow honors | On the run's immutable envelope; `commit` structurally absent; zero durable rows **asserted** |
| Evidence | Reconstructed from log files | `RunEvidenceReceipt` = pure function of authority, byte-identical on re-derivation, per-field declared redaction; CLI and dashboard read the same derivation |
| Failures | `error: string` on a span | Structured `FailureRecord` + auto-captured, capture-time-redacted diagnostic bundle, committed with the terminal state |
| Ledger | None | Ordered, actor-attributed, fsync'd, digest-chained; any corruption stops the partition rather than renumbering history |
| Storage | JSONL + SQLite, no backup, no restore | ONE authority DB, SHA-pinned immutable migrations, live backup cadence, byte-verifying doctor, **drilled** restore |
| Notifications | In-memory React store — reload loses it | Durable inbox row committed **before** any OS toast; repeated triggers fold into a count; no free-text (structurally can't leak form contents) |
| Intake | Parse at enqueue, then gone | Durable session → mapping (suggestions can never auto-bind) → validation → **immutable manifest** + N runs + CAS in one transaction; reruns hash-diff |
| Edit Data | Exists | Resume claim IS the fence; edits become authority only by re-parsing through the producing node's own schema |
| Start | Fire-and-forget enqueue | Plan-then-consume; exact raw JSON retained beside canonical — defaults can never erase what you typed |
| Registries | ~10 hand-maintained parallel registries; a typo compiles | ONE `WORKFLOW_MODULES` tuple; stale fingerprint manifest is a red gate |
| Guards | 31 guards, accepted lint debt | 60 guards, zero debt, every mechanical arm proven against a violating fixture |

### Where legacy is still ahead (the honest list — this IS the Phase 3 surface)

OCR review/approve UI · screenshots gallery + artifact-bytes route · cross-date search · Excel
exports (3 writers incl. the master I-9 retention workbook) · workflow graph editor + data bank ·
editable settings · the record-sanity-check AI tool (deferred to order-8; run-summary and
selector-suggest are **retired**, D192 — not gaps, decided) · production phone-capture delivery
path · LAN mode · setup wizard · `test-login` · **six system drivers** (onbase, servicenow, i9,
new-kronos, old-kronos, sharepoint — declaration-only in the rebuild).

### What the rebuild will never do, by design

- **Unverified silent fallbacks** — the founding rule; enforced by ratchets run against violating fixtures
- **Selector `.or()` fallback chains** — live re-verification at migration replaces them
- **Per-daemon stdout logs / ~30 bespoke polling hooks / secondary count caches** — one projection, one SSE spine; a second data path cannot disagree with the first
- **Per-action mutation routes / fire-and-forget enqueue** — one idempotent actor-stamped command endpoint
- **Generic retry on a parked write** — only proof-of-presence or operator-confirmed-absence releases one
- **DSL/codegen workflow authoring (D79a)** — selectors, schemas, proof, and graph structure stay code, forever
- **LAN/remote operator mode** — loopback only; the token-scoped phone ingress is the one deny-by-default exception
- **Hosting** (D193) — never deployed to a platform; it runs on your machine. A locally-run app package and a cooperation mode over solo are *later, unplanned* ideas, not a hosted future
- **Legacy change accounting (D150)** — replaced by mandatory live re-verification at each migration

---

## 7 · Verify any of this yourself

```bash
npm run rebuild:cli phase        # completedThrough 2j · active 3-workflow-migration
npm run typecheck && npm run lint && npm run test:coverage   # the per-commit gate (D191): 1602 tests + 60 guards + floors
npm run test                     # 1602 — available for a targeted run
npm run test:architecture        # 431 (60 guards) — available for a targeted run
npm run test:parity              # 134
npm run rebuild:cli storage doctor
git log --oneline master         # D170–D192 landed 2026-08-08 → 2026-08-12, never pushed
```

Primary references: `docs/rebuild/07-master-plan.md` (plan + exit criteria) ·
`docs/rebuild/04-reconciliation.md` (D1–D192 index) · `docs/rebuild/09-write-safety.md`
(controlled-commit as-built) · `config/legacy-capabilities.json` (the 78-entry cutover register) ·
`docs/handoffs/2026-08-07-finish-phase-2.md` (the closed Phase 2 handoff).
