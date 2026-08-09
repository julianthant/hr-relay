# Handoff — finish Phase 2 (rest of 2h, then 2i and 2j)

**Date:** 2026-08-07, extended 2026-08-08 and 2026-08-09
**Paused at:** **2i-E (the intake surface) CLOSED 2026-08-09 with D170–D173** — the durable session,
the enqueue, and the grid UI over person-lookup's first real intake projection. Resume at **2i-F,
the capture surface**. Everything below about 2h remains true.

**ALL OF TAIL 2h IS COMPLETE (D146–D167, closed 2026-08-08).** The 2026-08-08
session landed D162–D167 in six commits: executor/worker provider+artifact wiring with the guard
relaxation, the roster store (tiers verbatim, scoring redesigned), the stable-keyed artifact
projector with the xlsx-retention sink, the normalization advice store + geocode adapters + the
rotation pool, the Edit Data core (CAS-against-resume-fence save + replay consume), and durable
capture (sessions as rows, the stable-keyed finalize outbox, restart/duplicate fixtures). The
runtime phase marker reports `completedThrough: "2h"` / `active: "2i"`. **2i is underway: 2i-A
(trust surfaces), 2i-B (notification bell + inbox), 2i-C (the Edit Data rail, D168), and 2i-D
(Settings + storage health/doctor + the live backup cadence, D169) are DONE 2026-08-08.** Resume
at **2i-E, the intake UI** — docs 03 + 06 are primary; the checklist below names the remaining 2i
slices, and the 2h as-builts in doc 06 name every seam 2i must still wire (the ai advisory arm,
the capture phone surface + PDF bundler + intake enqueue, the capture-durability-and-scope
guard).

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
- Highest decision in use: **D173**.

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

- [x] **2i-A — trust surfaces. DONE 2026-08-08.** `src/dashboard/surfaces/trust.tsx` renders the
      full served content both placeholders discarded: the failure record (write-state sentence
      unconditional and never behind a disclosure, subject via served displayRedacted,
      sameFingerprintSeen as a count, remediation ladder, cause chain + fingerprint, bundle
      presence/absence with reason) and the receipt body in the schema's narrative order
      (input → observations → decisions → actions → verification → output → reuse → warnings,
      redaction rendered as final — a drop arm is an explicit redacted state). run-failed parity
      references re-frozen (6 triples). RESIDUAL: the run-receipt parity fixture still exercises
      only the receipt's `missing` arm — adapter #1 holds no authority rows; a populated-receipt
      reference needs an adapter-#2 state (noted for 2j's corpus work).
- [x] **2i-B — notification bell + inbox. DONE 2026-08-08.** The notification family activated
      (read/unread/snooze with version CAS + actor-ownership checks; read-state and snooze stay
      independent axes per D138), the day wire serves the durable rows through
      `notificationWireOf` (severity by trigger, `snoozed` only while in force), and the top-bar
      bell + inbox popover issue the three arms with command failures surfaced inline (the
      ratchet refused a swallowed catch — correctly). All parity references re-frozen for the
      bell. RESIDUAL: the wire's severity/state shape supersedes doc 03 §2.6's sketch
      (no `critical`, merged snooze state) — flag for the doc 03 as-built pass in 2j.
- [x] **2i-C — Edit Data rail. DONE 2026-08-08 (D168).** Not client-only after all: the recon
      showed the `context-data` wire carried only `{label, valueRedacted}` — no patch identity, no
      policy — so the wire grew `ContextDataSectionSchema` (per-entry edit union with the raw
      checkpoint scalar + staged `envelope.injected` correction beside it; payload-level `editing`
      from raw lifecycle with `expectedVersion` as the CAS basis), the server query joined details
      × `editData` declarations by `(nodeId, fieldPath)`, and `EditDataFieldSchema` grew a
      required `label` plus two factory refusals (always-rerun nodes; offers-rule paths).
      Client half as planned: `editPolicyFor` composes field/run/live with the most specific
      reason always shown; the staleness signal is as-built the DAY STREAM's queue-row status
      (`liveLockReasonOf` — no per-run SSE client exists; recorded in doc 03 D19 + doc 06
      §6.4.1), editing enters on focus, the rail widens (`--ds-w-context-rail-wide`'s first
      consumer), Save → one `run/edit-checkpoint`, applied → detail+sections refetch at the
      bumped `rowRevision`, rejected → kernel sentence verbatim with drafts kept. `person-lookup`
      declares the three CRM dates. Open remainders recorded in D19's as-built note: the
      `Load a prior run` footer and `actions[]` data-placement gating (served actions still
      empty). Tests: `context-data-edit.test.ts` (6), `edit-policy.test.ts` (7), two new
      field-policy guard arms; parity refrozen once (queued run hosts the editable showcase —
      the seeded open-gate twin is CLAIMED, so both adapters render it locked).
- [x] **2i-D — Settings + storage health/doctor. DONE 2026-08-08 (D169).** The recon found the
      real gap: `AuthorityBackupService` had NO composer — no backup had ever been taken by the
      running system. The dashboard composition now owns the cadence (start backup, dirty-only
      15-min ticks, graceful-drain at stop with a post-cleanup throw on failure) and retains the
      service's last outcome for the doctor wire's `service` arm. Bootstrap `storage.backup` is
      real (`summarizeBackupHealth` — manifest age + generation gap, write-time verification
      trusted; unparseable → `missing`, the closed enum's fail-safe); the byte-re-verifying
      doctor serves through `GET /api/v1/storage/doctor` (`StorageDoctorWireSchema`), the
      Settings gear's Storage section (server-served `settingsSections`, today exactly
      `storage`; `apply-settings` STAYS the deferred bff-flow probe), and
      `rebuild:cli storage doctor [--json]` (exit 0 = healthy AND current; live-proved — it
      correctly reported the standing local authority DEGRADED at schema v10 vs the v11 build).
      Remainders on their owners: `cli storage restore` + one-time proof → 2j's drill (wire
      `offline-restore.ts`); the 14/8/5 retention sweep; `preflight-coverage` stays planned (its
      subject is the preflight framework's coverage, not this slice). Found+fixed:
      compose-real-port's cleanup ran `rmSync` before `stop()` (benign until stop wrote files);
      summary newest-manifest ties now break by generation. Tests: `storage-summary.test.ts`
      (4, real service round-trip), bff-flow doctor arm, runtime-composition storage seam arm;
      parity refrozen once (the top-bar gear).
- [x] **2i-E — intake surface. DONE 2026-08-09 (D170–D173).** Upload → mapping grid (suggestions never pre-applied) →
      validation review (rows split, per-cell errors) → manifest + rerunDiff → run (doc 06
      §2.2/§5.0). The 2026-08-08 recon sized it: the PURE pipeline is complete and tested
      (`src/domain/intake/` — header-discovery, mapping with `confirmBinding` as sole mint,
      validate, manifest + rerunDiff + enqueueReadiness) and `extraction/extract-spreadsheet`
      parses csv/xlsx with header candidates; but there is NO durable intake session (the six
      deferred arms target `{intakeSessionId, expectedVersion}` and only the terminal manifest
      is durable via D159), NO byte-ingest route (the BFF has no route accepting raw bytes →
      `ArtifactRef`; capture assumes a pre-minted ref), NO dropzone/grid-edit primitives, and
      NO workflow declares an intake projection (work-study, doc 06 §8's example, does not
      exist — person-lookup is the sensible first target: a spreadsheet of people fanning out
      N lookups). Sub-slices, each its own commit:
      - [x] **E1 — server sessions + non-enqueue arms. LANDED 2026-08-09 as D170** (schema v12
        foundation in `4d6db1a`; arms + parser seam + route + wire in the follow-up commit).
        Normative text: doc 06 §2.7. Two as-built notes for E2/E3:
        · the `intakeParser` seam is **prepared then read** — async `prepare` warms one
          `(artifact, sheet)` grid, sync `parse` derives the layout — because the kernel's
          authority transaction cannot await. `POST /api/v1/commands` calls
          `intake.prepare(body)` before dispatch; an unprepared key throws by name.
        · the intake projection is declared on the workflow's **server module** (derived into
          `INTAKE_PROJECTIONS` by `src/control/workflow-registry.ts`), NOT its descriptor —
          keeping it out of `contractFingerprint`. **Nothing declares one yet**, so E3's
          person-lookup projection is what first makes the surface reachable in production;
          `defineIntakeProjection` resolves target paths through a strict object and
          `PersonLookupInput` is a UNION, so that is real design work, not a five-line add.
        Design settled 2026-08-08:
        · **The ROUTE creates the session, commands only mutate it** (capture's exact
          precedent — no `capture-open` arm exists; phone routes create those rows).
          `POST /api/v1/intake/files?workflow=<id>` takes raw bytes (size-capped), writes
          them through the content-addressed writer, runs discovery via the grid edge, mints
          the `intake_sessions` row (state `mapping`), and returns the session wire.
        · **Authority schema v12**: `intake_sessions` with searchable columns
          (workflow, source_sha256, state) beside record_json; version-CAS updates;
          extend the pinned digest table with v12's literal. Session record
          (`src/domain/intake/session.ts`): id, actorId, workflow, `artifact: ArtifactRef`,
          sheet, `headerRowIndex` nullable, `bindings: ColumnBinding[]`, constants,
          corrections (+correctedAt), exclusions (+reason, at), state
          `mapping|validated|enqueued|discarded`, a `validation` union retaining `readAt`
          (two-digit-year replay determinism), optional intakeManifestId (enqueued requires
          it), version/createdAt/updatedAt. Rows/columns are RE-DERIVED from the immutable
          artifact every read — never stored in authority.
        · **The kernel gets an injected deterministic `intakeParser` seam**
          (`(artifact, sheet, headerRowIndex) => {sheets, columns, rows, headerFingerprint}`,
          composed from `src/stores/common/spreadsheet-grid.ts` + the artifact opener) — the
          kernel cannot import a spreadsheet parser, but binding confirmation must validate
          `sourceColumnId` against the REAL layout and pin its `headerFingerprint`.
        · **Placeholder payloads amend** (D161/D167 rule — they were deferred-arm
          placeholders no producer ever sent): `inspect-intake` → `{sheet?, headerRowIndex?}`
          re-parse selection (artifact rides the session); `confirm-intake-mapping` →
          `{targetFieldId, sourceColumnId, headerFingerprint}` per-field (the kernel's
          `confirmBinding` is the ONE mint; suggestions stay client hints);
          `correct-intake-row` → `{sourceRow, field, correctedValue}`;
          `exclude-intake-row` keeps `{rowId, reason}` shape as `{sourceRow, reason}`;
          `validate-intake` stays payload-free (kernel runs `validateIntakeRows` over the
          re-derived rows + stored bindings, retains the validation arm + readAt).
        · Partition pins + COMMAND_FIXTURES move with the activation (five arms; enqueue
          stays deferred until E2); intake session wire + `GET /api/v1/intake/:sessionId`
          serving session + parse view + suggestions.
      - [x] **E2 — enqueue. LANDED 2026-08-09 as D171.** Normative text: doc 06 §5.2. The arm
        gates (state → CAS → source name → projection/descriptor → dry-run boundary), derives
        the plan through the new pure `src/domain/intake/enqueue.ts`, mints the D159 manifest and
        fans out N runs — manifest + runs + the session CAS to `enqueued` in ONE transaction, so
        a refusal on the last row leaves nothing. Notes E3 needs:
        · **The upload route now requires `?filename=`.** The D159 manifest requires
          `source.originalName` and a content-addressed artifact has no name, so the dropzone
          must send `file.name`; the session retains it as `sourceName` (optional on the record,
          required at the route, refused by name at enqueue).
        · **`enqueue-intake-manifest` payload is `{dryRun}`** and its target is
          `{intakeSessionId, expectedVersion}` — the wire's `expectedVersion` is the CAS basis,
          so Run must post the version the reviewed wire served, not a refetched one.
        · **The wire grew `sourceName?`, `intakeManifestId?` and `rerun?`**
          (`{intakeManifestId, createdAt, totals, diff}`) — that last one is the manifest +
          rerunDiff view E3 renders, present on the upload response and the session GET alike,
          and reading `same-plan` on the session that enqueued it.
        · **Runs are `single`/`bulk`, joined to the manifest by `itemId`.** Doc 06 §5's
          `operation` coordinator has no runtime; the deviation is recorded in §5.2.
        · **`createCommandKernel` gained a required `configIdentity`** — every kernel
          construction site passes one, and tests that never enqueue use
          `UNSTORED_CONFIG_IDENTITY` (it names a snapshot no database holds, so an accidental
          fan-out throws).
        · **`intakeProjectionRegistry` now refuses a projection built over a COPY of its
          descriptor's input schema.** person-lookup's declaration must reuse the descriptor's
          own schema object, which matters because its input is a union.
      - [x] **E3 — the grid UI. LANDED 2026-08-09 as D172 (projection) + D173 (surface).**
        Normative text: doc 06 §2.8 and doc 03 §11. **2i-E is now COMPLETE** — the route and
        all six arms stop refusing by name, because person-lookup finally declares a
        projection. Notes for 2i-F and beyond:
        · **A union input schema now resolves** (D172). `resolveSchemaPath` traverses every
          member and demands the SAME schema object wherever the path resolves; a member that
          lacks the path makes the target `omissible`, so `required` means "every valid input
          must supply this". person-lookup shares one `PersonNameSchema` (which IS
          `CANONICAL_FIELDS.fullName.schema`) across both arms and the canonical view.
          Its projection is `{emplId → eid, name → fullName}` and deliberately nothing else —
          `keepNonHdh`/`includeCrmDates` are recorded `execution-option` in the canonical scan.
          **The descriptor closure moved, so `contractFingerprint` moved**; that is why every
          parity `.meta.json` shows a new `descriptorHash`.
        · **NEITHER person-lookup target is `required`**, which is the union telling the truth.
          A row carrying neither identifier rejects as `cross-field`/`workflow-schema` with
          zod's root message — literally `Invalid input`, because `BoundaryIssueSchema` keeps
          only `{path, code, message}` and zod reports a failed non-discriminated union at the
          root. Legible enough to fix or exclude, but it does not NAME the missing identifier.
          Composing that message is `validate.ts`'s business — recorded in doc 06 §2.8.
        · **Two intake arms do not exist and the surface says so by omission.** Nothing sets a
          run-wide CONSTANT and nothing REMOVES a binding, so constants render read-only
          (always empty today) and the column control offers no "unbind". person-lookup does
          not need a constant, but **doc 06 §8's `effectiveDate` example does** — the first
          workflow with a required non-column field needs a seventh arm.
        · **The transport grew `requestJsonResponse`** because the upload's STATUS is the
          answer (`201` created / `200` joined / `422` refused). Any other status THROWS
          rather than being reported as a refusal. 2i-F's capture routes will want the same
          seam if a phone upload distinguishes created from joined.
        · **`Banner` (and any DS component with explicit props) forwards nothing else** — a
          spread `data-demo-enter` type-checks and is dropped at runtime, so an enter
          transition silently never runs. Wrap, do not spread.
        · **The parity lane dismisses the floating workflow window for intake states only**
          (`dismissWorkflowWindow`, a centred click on the panel header — NOT the body, where
          the dropzone would open a file chooser). The window covers a takeover's left edge
          and dismisses on the first click outside it anyway.
        · **Fixtures are DERIVED, not typed.** `tests/parity/helpers/fixture-intake.ts` feeds a
          cell grid through the real `detectColumns`/`rankHeaderRows`/`suggestBindings`/
          `validateIntakeRows`, so a screenshot of a suggestion score is a screenshot of what
          the scorer returns. Copy that shape for the capture corpus.
        · **RESIDUAL, pre-existing and NOT introduced here:** every `paper-ink` (light) parity
          reference actually renders DARK. `applyTheme` sets `data-demo-theme` on
          `<html>`/`<body>`, but `LoadedApp` writes its own `data-demo-theme={theme}` on the app
          root, which wins for the whole subtree — so the light theme has never been captured.
          Confirmed against references frozen before this slice. Fixing it re-freezes all 61
          pre-existing references for a reason unrelated to intake; it belongs with 2j's
          corpus work.
- [x] **2i-F — capture surface. DONE 2026-08-09 (D174/D175).** Token-scoped phone routes over a
      CLOSED union with fail-closed enumeration (one refusal for unknown/malformed/expired/
      discarded; the ingress Host gets a body byte-identical to an unrouted path); the token rides
      the QR's URL FRAGMENT and the `X-Capture-Token` header, never a URL the server sees. QR start
      renders from a pure in-process encoder (`src/domain/qr-code.ts`, ISO/IEC 18004, v1–40). The
      real PDF bundler is deterministic and dependency-free — digest re-verified per photo, JPEG
      `/DCTDecode` and PNG `/FlateDecode`+`/Predictor 15` with NO re-encode, everything it cannot
      decode refused by name, no date and a digest-folded `/ID`. The intake handoff derives its
      manifest/run ids from the outbox stable key and writes a real `IntakePlanManifest` with a new
      optional `capture` block. `capture.ingress` resolves to an origin or a NAMED result
      (`on-demand-ngrok` refuses `ingress-not-built` rather than serving a loopback QR).
      `capture-durability-and-scope` is ACTIVE. Notes for whoever comes next:
      · **No workflow can declare a capture intake binding**, so the production handoff refuses by
        name into durable `failed` + Retry Finalize — the D170-before-D172 shape. A photograph
        cannot yield an employee id or a document number without an OCR-backed workflow that does
        not exist. `tests/unit/server/capture-surface.test.ts` asserts `CAPTURE_INTAKE_BINDINGS` is
        empty ON PURPOSE: it is the thing that fails the day someone adds one.
      · **When that day comes, close this first:** a run the handoff enqueues emits **no
        `run.queued` span**, because spans come from the command service and this enqueue happens
        inside the finalize projector — so a capture-started run would not appear on the queue.
      · **A capture failure records its own reason durably.** D167's `failureId` can never resolve
        to a `FailureRecord` (that binds a run, which does not exist yet), so the projector writes
        its sentence onto the handoff and a stored failure with no reason THROWS rather than
        substituting prose.
      · The on-demand ngrok tunnel LAUNCHER is still not built; `forwarded` with an explicit HTTPS
        URL is the working path today.
      · **Pre-existing, not introduced:** the intake takeover renders a dark shell under the light
        theme (sibling of the `paper-ink`-renders-dark residual already deferred to 2j).
- [ ] **2i-G — PARTS 1 AND 2 LANDED 2026-08-09 (D176/D177, D178); the rest is still open.**
  - [x] ~~Read-only Workflow Explorer (doc 12 §5 Phase A)~~ — **DONE.** Projection derived from
        `WORKFLOW_MODULES` at `GET /api/v1/explorer`, surface at `?explore=<workflowId>`. Doc 12
        §5.7 is the as-built; doc 03 §13 owns placement. Two named exclusions: the §5.2 live-run
        overlay (doc 03's timeline already serves it per run) and scenario coverage *claims* (they
        live in the test corpus and `scenario-coverage` already audits them both ways).
  - [x] ~~Guard `workflow-editor-compile-integrity`~~ — **ACTIVATED, SCOPED.** It holds doc 10
        §3.10's round-trip sentence over the REAL registry in both directions, Phase A's read-only
        boundary, and D79a's no-DSL trim. **It has NO Phase-B arms** (§5.3/§5.4's draft union,
        stale-base apply, code-change brief) because none of that exists; the inventory entry says
        so and the guard gains them in the commit that builds them.
  - [x] ~~Generated UI catalog surface~~ — **DONE.** `GET /api/v1/ui-catalog` serves the COMMITTED
        `generated/ui-catalog.json` after asserting it still describes the drivers; a stale artifact
        throws with the generator's own remediation and the surface never regenerates. Surface at
        `?catalog=<term>`.
  - [x] ~~**AI advisories** (doc 12 §4.4)~~ — **DONE (D178).** Failure triage lands as
        `POST /api/v1/runs/:runId/advisory` behind an explicit button inside the failure record —
        deliberately NOT a run-detail section, because a section spends a provider budget every
        time an operator opens a failed run. Redaction is DECLARED per leaf and an undeclared leaf
        refuses by name; only `safe-diagnostic` leaves as a value, so `summary` (which is
        `error.message` verbatim and can name a person) is withheld and the closed vocabularies
        beside it are what the model sees. Guard `ai-advisory-no-authority` **ACTIVATED** over the
        module graph in both directions plus the declaration, the advice shape and the route.
        The normalization `ai` arm went live NARROWER than legacy's (classification decides, so
        `relationship` is never sent), and the bootstrap's `ai-advisory` entry now reports a real
        fact about the process instead of a milestone.
        · **Still without a producer, by design:** run summary over a `RunEvidenceReceipt`, the
          record sanity check, and the dev-only selector-suggestion brief. `AdvisorySurfaceIdSchema`
          carries no arm for them.
        · **Parity delta:** the six `run-failed` references re-frozen for the new panel; the whole
          corpus re-stamped once for the descriptor-hash change the domain edits caused.
        · **No live provider call was made.** The production adapter takes its `fetch` by injection
          and every fixture uses it; a live smoke is available but was not run.
  - [ ] **Archive / version-bump UI** (with task D80's model). Untouched.
  - [ ] **Activity report** (doc 13 §6.7). Untouched.
  - [ ] **Explorer Phase B** (doc 12 §5.3/§5.4) — the closed presentation/policy edit union, the
        stale-base apply refusal, the code-change brief. Not started; it is the other half of doc
        07's explorer exit criterion.
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
- [x] ~~Read-only explorer renders the as-built person-lookup graph accurately (2i)~~ — **MET
      2026-08-09 (2i-G, D176)**, proved by `workflow-editor-compile-integrity` over the real
      registry plus three parity states. The EDIT half of doc 07's same bullet is Phase B and
      remains open.
- [ ] Capture fixtures prove restart survival + no duplicate photos/handoffs (2h-F)
- [x] ~~AI-advisory fixtures prove redaction, strict output, provider exhaustion, zero authority
      edge (2i)~~ — **MET 2026-08-09 (2i-G, D178).** One fixture per arm:
      `tests/unit/advisory-redaction.test.ts` (a classified leaf never reaches the prepared
      request), `advisory-strict-output.test.ts` (malformed provider reply → typed refusal naming
      paths, never values), `advisory-provider-exhaustion.test.ts` (spent budget / no adapter /
      whole pool exhausted → typed `unavailable` with the reservation conservatively retained, over
      a REAL authority database), `advisory-zero-authority.test.ts` (a produced/refused/unavailable
      round trip leaves every authority family except provider admission byte-identical), plus the
      structural guard `ai-advisory-no-authority`.
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
