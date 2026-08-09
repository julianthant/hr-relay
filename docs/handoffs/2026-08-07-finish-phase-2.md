# Handoff — finish Phase 2 (rest of 2h, then 2i and 2j)

**Date:** 2026-08-07, extended 2026-08-08
**Paused at:** **ALL OF TAIL 2h IS COMPLETE (D146–D167, closed 2026-08-08).** The 2026-08-08
session landed D162–D167 in six commits: executor/worker provider+artifact wiring with the guard
relaxation, the roster store (tiers verbatim, scoring redesigned), the stable-keyed artifact
projector with the xlsx-retention sink, the normalization advice store + geocode adapters + the
rotation pool, the Edit Data core (CAS-against-resume-fence save + replay consume), and durable
capture (sessions as rows, the stable-keyed finalize outbox, restart/duplicate fixtures). The
runtime phase marker reports `completedThrough: "2h"` / `active: "2i"`. Resume at **2i, the
operator surface** — docs 03 + 12 are primary; the checklist below names the 2i slices, and the
2h as-builts in doc 06 name every seam 2i must wire (the ai advisory arm, the Edit Data rail, the
capture phone surface + PDF bundler + intake enqueue, the capture-durability-and-scope guard).

**Supersedes** `2026-08-05-phase2-tail-2h.md` for scope — that brief covers only 2h. Read it for the
D146–D159 detail; read this one for what remains of the whole phase.

## Task summary

Phase 1 is complete (D74 live exit test, 2026-08-04). Phase 2 is the transaction proof plus four
tails: 2g, 2h, 2i, 2j. The proof and 2g are done; **2h is about 40% done and 2i/2j are untouched**.
This handoff carries Phase 2 to its exit criteria.

The governing constraint throughout: **this system submits real HR transactions, so a
plausible-but-wrong value is the worst possible failure.** Nearly every serious defect this program
has found was *a check that could not fail*, and nearly all of them were exposed by running real
things against real data rather than by fixtures. Budget for that — a live pass on real documents
has found a defect every single time it has been run.

## Plan

- Plan SSOT: `docs/rebuild/07-master-plan.md` — §Phase 2's "deferred base tails" table (2h/2i/2j
  contents) and §"Hard exit criteria (Phase 2)".
- Decision changelog: `docs/rebuild/04-reconciliation.md` — **highest decision in use: D159**.
  **D131 is a retired gap — never reuse.** It is a POINTER INDEX; never implement from it.
- Owning docs: `06-data-intake-and-edit-data.md` is primary for 2h. `03` (surfaces), `12` (operator
  trust) for 2i. `05`/`10` for 2j.

## Current state

- Branch: `master`. Worktrees: none. Uncommitted changes: **clean**.
- 2026-08-08 session: six feature commits `0be4fc9` → `5226ff0` plus the 2h-closing chore.
  **Never pushed — do not push.**
- Gates ALL GREEN: typecheck · lint · **test 1270+** · **architecture 332** · **test:parity 70** ·
  build:manifest:check
- Guards: **54 active** (edit-data-field-policy joined at D166), 11 planned, 4 retired.
- Authority schema version: **11** (D164/D167 typed the v1 shells at the repo layer — no
  migration; zero production rows existed).
- Highest decision in use: **D167**.

## Progress

### Done

- [x] Phase 1 (through `1i-spine`), D74 live exit test passed
- [x] Phase 2 controlled transaction proof — real Kuali commit on doc 4489 (D135)
- [x] Phase 2 tail **2g** — evidence receipts, diagnostics, notifications, knowledge, ledger (D134–D145)
- [x] 2h — canonical field registry frozen against a recorded scan (D146)
- [x] 2h — operator column mapping: projection, identity, fail-closed reuse, suggestions (D147)
- [x] 2h — validation, rejection review, immutable manifest + rerun diff (D148)
- [x] 2h — extraction store: spreadsheet (D149) and PDF page rasterization (D152)
- [x] 2h — OCR gate with three interchangeable producer routes + `rebuild:cli ocr` (D151, D153–D155)
- [x] 2h — scanner stack: classify + group by name (D157, D158)
- [x] 2h — authority schema v11: durable `intake_manifests` + `ocr_extractions` (D159)
- [x] Legacy decoupling — change accounting and environment inventory retired (D150, D156)

### Remaining — 2h (finish this first)

- [x] **2h-A — the `i9` OCR form. DONE 2026-08-08 (D160).** One form, two data-bearing page kinds
      (`OcrFormSpec.pageKinds`), uniform record with per-field `onPageKinds` (off-section fields are
      `not-on-form`, anything else refused), the sectioned-subject grouping arm (`incomplete` +
      `missingKinds`, flag-never-block). Live-proved on the whole real 44-page scan: 44/44
      accounted, 19 pairs found, 6 honest flags (2 paper orphans, 2 name-read splits).
- [x] **2h-B — the production `ocr.extract` provider adapter. DONE 2026-08-08 (D161 + D162).**
      First half: `src/infra/providers/gemini-ocr-extract.ts`, transport+provenance only,
      live-proved byte-identical to a route-2 human reading of the same real page. Second half:
      executor `ctx.providers`/`ctx.artifacts` wiring (per-invocation admitted clients over the
      run's retained config snapshot), worker composition in `compose.ts`, and the
      `provider-capability-boundary` arms relaxed to explicit allowlists — doc 06 §4.11 "Wired",
      `tests/unit/run-executor-capability-wiring.test.ts`.
- [x] **2h-C — roster store + artifact projector. DONE 2026-08-08 (D163 + D164).** The roster
      store with the verbatim tier port and redesigned scoring (doc 06 §4 as-built), and the §4.1
      stable-keyed projector: checkpoint+outbox atomic in the executor, blocking-by-structured-
      failure, cross-run resume by re-derived stable key, xlsx-retention sink over
      `write-excel-file`. The projector is not composed into the worker until a descriptor
      declares a projection (the workbook path is the consuming migration's fact).
- [x] **2h-D — normalization store + production pools. DONE 2026-08-08 (D165).**
      `normalization/read-contact-advice` (typed advice; rules ported, ai arm waits for 2i),
      census/nominatim transport adapters, and the rotation pool — one invocation is one model
      call, rotation across invocations; compose wires the gemini pool + keyless geocoders.
- [x] **2h-E — Edit Data core. DONE 2026-08-08 (D166).** The CAS-against-resume-fence save
      (`run/edit-checkpoint` activated, field-level patches, allowlist + full re-parse before
      anything durable moves), `envelope.injected` merge, executor consume at replay with
      operator provenance, and the activated `edit-data-field-policy` guard. Bounds recorded in
      doc 06 §6 as-built: retry-then-edit-queued for terminal runs; attempt-1 collision refuses
      loudly. The rail UI is 2i.
- [x] **2h-F — durable capture. DONE 2026-08-08 (D167).** Session + finalize-outbox schemas,
      typed repos over the v1 shells, all seven command arms active (current-state validation,
      no blanket CAS, content-level no-ops), and the finalize projector with deterministic
      bundler + transactional handoff seams. Fixtures pin restart-with-open-session,
      restart-mid-finalize convergence to one artifact/one handoff, no duplicate
      photos/handoffs, and failed→retry-finalize→finalized. The phone HTTP surface + real PDF
      bundler + intake enqueue wiring are 2i; `capture-durability-and-scope` activates there.

### Remaining — 2i (operator surface)

Sliced 2026-08-08 from the landscape recon (docs 03/12/13 + the dashboard tree). The SHOULD tier
(build before the first migration) comes first; the LATER tier may reorder but blocks Phase 3.
The BFF serves 7 endpoints today; each slice names what it adds.

- [ ] **2i-A — trust surfaces (START HERE).** The receipt and failure wires are D140/D142-complete
      (`GET /api/v1/runs/:runId/:section` already serves whole `RunEvidenceReceipt` and the
      whitelisted `FailureDetailWireSchema`), but `receipt.tsx:81-89` and
      `log-panel.tsx:402-453` still render 2g-era placeholders that DISCARD the served content
      (writeState/subject/causeChain/diagnosticBundle/sameFingerprintSeen). Pure rendering work:
      the full receipt view (doc 12 §2.3's acceptance: "complete the double-check without
      opening UCPath"), the failure detail (writeState unconditional, never behind disclosure),
      a failure tab in `TAB_ORDER`, new parity references for both.
- [ ] **2i-B — notification bell + inbox.** Activate the DEFERRED notification command family
      (read/unread/snooze — the D166/D167 activation pattern), add the lifecycle route, and the
      top-bar bell + inbox UI (doc 03 §2.6; the bell is "ABSENT rather than stubbed" at
      `top-bar.tsx:7-10`). D138 ordering already holds server-side.
- [ ] **2i-C — Edit Data rail.** Client half only (server fully active per D166): `editPolicyFor`
      with the reason always shown, the widened rail (`--ds-w-context-rail-wide`, 520px), Save →
      `run/edit-checkpoint`, the SSE `run.claimed` staleness signal disabling Save (doc 03 D19,
      doc 06 §6.1/§6.4).
- [ ] **2i-D — Settings + storage health/doctor.** The doctor/backup wire + Settings section
      (doc 03 §2.5); `StorageHealthSummaryWireSchema` carries only a summary today. Feeds the
      `preflight-coverage` planned guard.
- [ ] **2i-E — intake UI.** Upload → mapping grid (suggestions never pre-applied) → validation
      review (rows split, per-cell errors) → manifest + rerunDiff → run (doc 06 §2.2/§5.0);
      backend as-built through D148/D159. New BFF intake routes.
- [ ] **2i-F — capture surface.** The token-scoped phone routes (fail-closed enumeration), QR
      start, the real PDF bundler + intake-enqueue wiring into D167's seams, `capture.ingress`
      dependency handling, and ACTIVATE `capture-durability-and-scope`.
- [ ] **2i-G — LATER tier:** read-only Workflow Explorer (doc 12 §5 Phase A; guard
      `workflow-editor-compile-integrity`), AI advisories (doc 12 §4.4; guard
      `ai-advisory-no-authority`; the normalization `ai` arm + bootstrap unavailable-reason come
      off), generated UI catalog surface, Archive/version-bump UI (with task D80's model),
      activity report (doc 13 §6.7).
- [x] ~~The three presentation defects deferred from Phase 1~~ — **STALE ITEM: all three were
      fixed 2026-08-04** (D123 skipped-arm, D124 terminal duration, D126 accessible-name
      collision) per doc 03 §"Phase 1g/1i-spine as-built presentation deltas" and doc 07's
      Phase-1 exit block ("ALL THREE FIXED"). Nothing remains.

### Remaining — 2j (integration / restore / soak / docs gate)

- [ ] Full scenario corpus
- [ ] Corruption → read-only degraded → checksummed-backup restore → projection rebuild drill
- [ ] Dependency / control / capture concurrency matrix
- [ ] Worker teardown + multi-worker soak
- [ ] Redaction scan
- [ ] Capability-inventory validation
- [ ] Update every owning doc to as-built (including doc 02 §8)

### Phase 2 exit criteria not yet met (doc 07 §"Hard exit criteria")

- [ ] **Archive model (D80) proven** — a version bump moves prior-version runs into a read-only
      Archive, an archived run renders with zero old-version code paths, the ledger is untouched,
      relaunch starts a fresh current-version run, and a bump REFUSES while any prior-version run is
      non-terminal. **Nothing of this exists yet.**
- [ ] Read-only explorer renders the as-built person-lookup graph accurately (2i)
- [ ] Capture fixtures prove restart survival + no duplicate photos/handoffs (2h-F)
- [ ] AI-advisory fixtures prove redaction, strict output, provider exhaustion, zero authority edge (2i)
- [ ] Real-shaped copied authority DB survives corruption → restore → rebuild (2j)

## Deviations from the plan already made — do not re-litigate

1. **Doc 06 §3's `parse-pdf-fields` described a capability legacy never had** (D152). Onboarding's
   "extraction" is Playwright scraping a CRM page; no legacy code reads an AcroForm anywhere. The
   real need was rasterization, and that is what shipped.
2. **`extraction/parse-csv` → `extraction/extract-spreadsheet`** (D149): doc 06's illustrative id
   violated doc 01's read-verb grammar.
3. **The OCR three-producer requirement and the classify→group stack pipeline are NEW SCOPE**
   (D151, D157, D158) introduced by the operator on 2026-08-06. They are not in doc 07's 2h list.
   **Doc 07's 2h row should be amended to include them** — it currently understates the tail.
4. **Legacy change accounting and the legacy half of the environment inventory are RETIRED**
   (D150, D156). The two repositories touch each other in neither direction. Do not reinstate, do
   not extend `config/legacy-change-accounting.json`.
5. **The oath sign-in sheet is used by no workflow** (D154). Every form is one person per page.

## Open questions / deferred decisions

- **Q: the runtime's phase marker is stale.** `rebuild:cli phase` reports
  `active: "2-transaction-proof"`, met since 2026-08-04. — Current thinking: advance
  `ACTIVE_ITEM` in `src/core/runtime-composition.ts` as part of the next slice; it is a one-line
  change plus its test.
- **Q: doc 07's 2h row understates the tail** (see deviation 3). — Current thinking: amend it when
  2h closes, so the row describes what was actually built.
- **Q: `run-detail.ts:325-337` renders raw `span.patched` keys as labels**, never consulting the
  descriptor's authored `label`/`display`. Latent — `span.patched` has zero producers. — Current
  thinking: fix when a producer lands, or make the absence structural.
- **Q: doc 12 §4.3's "mark stale knowledge records `unverified`"** needs a CAS on a `version` field
  `KnowledgeRecordSchema` does not have. Left unratified; forward supersession covers the active view.
- **Q: content-addressed artifact bytes are not reclaimed** by the diagnostic retention sweep (shared
  by digest); the sweep reports unreferenced ids but reclamation needs a refcount the store lacks.
- **Q: UCPath/ServiceNow propagation windows** remain ported legacy knowledge, not rebuild-verified.
- **Q: `read-excel-file` throughput** (~3 s for 2000×20; very large files can overflow the stack).
  Fine for operator exports of dozens–hundreds of rows.
- **Q: `@office-kit/xlsx` at 1.0** — technically better than `read-excel-file`, refused only because
  its API is declared unstable. Worth revisiting.
- **Q: a 44-page scan rasterizes to ~22 MB of PNGs** at 2×. Fine for the content-addressed store, but
  worth measuring before a large batch.

## Verification before resuming

```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status                      # expect clean
git log --oneline -5            # expect f2621f6 at HEAD

npm run typecheck && npm run lint
npm run test                    # expect 1162 green
npm run test:architecture
npm run test:coverage
npm run test:parity             # 70
npm run build:manifest:check
```

See the OCR pipeline work end to end on real paper:

```bash
npm run rebuild:cli ocr forms
npm run rebuild:cli ocr instruction oath
npm run rebuild:cli ocr stack <classified.json> oath   # names what does not belong in the run
```

## What to know before touching this code

- **`npm run build:manifest` after ANY `src/domain/**` edit** — those files are in every descriptor's
  import closure. It also moves the dashboard's `wf <hash>` stamp, so the parity lane goes red until
  refreshed with `npm run test:parity:update`. That is D145 working, not a fault.
- **`src/domain/intake/**` and `src/domain/ocr/**` must stay free of Node built-ins** — both are
  browser-reachable, and Vite turns an externalized `node:*` import into a proxy that throws at
  module evaluation (doc 13 §8.13).
- **`strict-boundary-schemas` scans `src/domain`.** A new exported interface needs a schema or an
  allowlist entry WITH a reason; `as` casts are refused outright — use a type predicate, or parse.
- **`fail-loud-catch-default` has no waiver.** A `catch` that assigns `true`/`null`/`{}` fails even
  when it re-throws first. Return a discriminated value — see `attemptCoercion` in
  `src/domain/intake/validate.ts`.
- **A new guard file and its `guard-inventory.json` entry land in the SAME commit.** Append to the
  array rather than re-sorting; `json.dumps` with `ensure_ascii=False` rewrites every `§` escape.
- **A new authority table** joins `POST_V1_TABLE_ORDER` (never the released v1 order), needs a
  mutation case in `sqlite-authority-database.test.ts`, and its migration's literal digest appended
  to `RELEASED_MIGRATION_DIGESTS`.
- **Another session commits to this repo's `master` too.** That is normal — commit your own category
  and let git interleave. Do not revert their work.
- **Live verification is pre-authorized** — never ask. Real documents are at
  `/Users/julianhein/Projects/hr-automation/data/documents` and real scans at that repo's root.
  Real HR exports are gitignored; never commit one.

## Pointers

- `CLAUDE.md` (root) — conventions, the fail-loud rule, cross-repo rules, operational isolation, and
  the dated lessons. Read the 2026-08-03/04 entries.
- `docs/rebuild/07-master-plan.md` — the phased plan and Phase 2's exit criteria
- `docs/rebuild/06-data-intake-and-edit-data.md` — **primary for 2h**; §1.1, §2.6, §3.1, §3.2, §4.3
  through §4.9 and §5.0 are this session's as-built sections
- `docs/rebuild/03-tracker-dashboard.md` + `12-operator-trust-and-authoring.md` — primary for 2i
- `docs/rebuild/10-guard-test-architecture.md` — primary for 2j; §3.13 records the legacy retirement
- `docs/rebuild/guard-inventory.json` — the reviewed manifest; 13 `planned` entries map onto 2h's
  unbuilt half plus 2i/2j
- `docs/handoffs/2026-08-05-phase2-tail-2h.md` — the D146–D159 detail
- `config/canonical-field-inventory.json` — the recorded D58/D68 scan; extend it in the same commit
  as any new canonical field
