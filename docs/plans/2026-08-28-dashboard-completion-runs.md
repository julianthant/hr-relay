# Run plan — current-workflow dashboard completion — 2026-08-28

| Run | Theme | Units | Roles | Base | Integration branch | Needs first | Exit evidence |
|---|---|---|---|---|---|---|---|
| R-DCF | Close demo-fidelity residue | DCF1–DCF6 | sup_terra · sup_sol review | `f89301df` | task worktree branch → coordinator merges to `integration/03b` | — | run branch green; C1–C4 closed or newly decision-gated by exact row; parity attributed |
| R-DCC | Editable dashboard control plane | DCC1–DCC6 | sup_sol · sup_terra | `f89301df` | task worktree branch → coordinator merges to `integration/03b` | — | strict executor/preflight/Explorer subset; UI proof; full gate |
| R-DCR | Reporting and search | DCR1 · DCR3–DCR6 | sup_sol · sup_terra | `f89301df` | task worktree branch → coordinator merges to `integration/03b` | — | Activity/search/export/diff authority + UI proof; full gate |
| R-DCA | Artifact reads and evidence viewers | DCA1–DCA5 | sup_sol · sup_terra | post-R-DCF integration | task worktree branch → coordinator merges to `integration/03b` | R-DCF merged | strict byte route plus screenshot/capture/archive viewers; full gate |
| R-DCT | Retire mobile document capture | DCT1–DCT6 | sup_sol · sup_terra | coordinator dispatch head | task worktree branch → coordinator merges to `integration/03b` | — | phone/operator capture product, authority, tests and plan promises removed; diagnostic/run evidence captures preserved; full gate |
| R-DDM | Current-workflow demo route | DDM1–DDM6 | sup_sol · sup_terra | post-R-DCT integration | task worktree branch → coordinator merges to `integration/03b` | R-DCT merged | real `/demo` route showing authority-derived Kuali separation scenario runs; browser/parity proof; full gate |

## Units

### DCF1 — close run-detail structural residue
- Scope: ledger 2's ten post-V1 rows: identity extras, rename refusal, focusable timeline/orphan gate, empty/paging states, Context-rail single ownership/chrome/refusal/preserved drafts.
- Acceptance: every row is ported or retains an already-ratified truthful exception; keyboard and unit tests prove behaviour; ledger C1 updated.
- Dependency: D273.
- Role: sup_terra; sup_sol reviews correctness and accessibility-sensitive ownership.
- Mode: sequential inside R-DCF.
- Review: Spec, correctness, tests, ui-review.

### DCF2 — close shell/queue structural residue
- Scope: ledger 1 workflow-panel spacing, theme/provider nesting, toast floor and remaining shell/layout groups that are neither already ruled nor producer-gated.
- Acceptance: live 1440/2000 measurements and parity references; no toast overlaps the Sessions bar; ledger rows updated individually.
- Dependency: D272.
- Role: sup_terra.
- Mode: parallel-safe with DCF3 after mapping.
- Review: Spec, performance, ui-review.

### DCF3 — close Start Run continuity and recovery residue
- Scope: plan card/table choice, conflict re-plan exit C69, conditional Safety numbering, input/shape continuity through plan review, invalid-result clearing and other current-workflow Start Run rows.
- Acceptance: separations start flow retains its typed document and shape through review; conflict has a truthful exit; focused tests and parity.
- Dependency: current separations start contract; no new input fields.
- Role: sup_terra.
- Mode: parallel-safe with DCF2 after mapping.
- Review: Spec, correctness, tests, ui-review.

### DCF4 — close archive and standing-surface non-copy residue
- Scope: Phase 4 C3, including AR39/AR59, only where the current authority can render the row; no OCR/capture producer additions.
- Acceptance: every surviving row is exact or cites a standing decision; harness-only attributes are either proven necessary and ruled or removed.
- Dependency: D275/D276.
- Role: sup_terra.
- Mode: sequential before DCF6.
- Review: Spec, accessibility, ui-review.

### DCF5 — restore semantic panel headings
- Scope: `PanelHeader` and call sites; settings/run-detail/takeover headings must be real headings at truthful levels without broadening unrelated primitives.
- Acceptance: role-based tests find every photographed pane heading; axe/parity green.
- Dependency: Phase 4 C4.
- Role: sup_terra.
- Mode: parallel-safe after primitive impact map.
- Review: accessibility, Standards, tests.

### DCF6 — re-audit and close C1–C4
- Scope: side-by-side demo/current screenshots at 1440×900 plus relevant wide/narrow views; ledgers, doc 04 carry table, parity attribution.
- Acceptance: zero unowned current-workflow fidelity row; deliberate parity changes attributed one by one; `npm run test:parity` assert mode green.
- Dependency: DCF1–DCF5.
- Role: sup_analyst for evidence judgment, sup_terra for any documentation close.
- Mode: sequential close.
- Review: Spec axis; no code in this unit unless a returned row proves the prior unit incomplete.

### DCC1 — implement the strict `apply-settings` authority
- Scope: command executor, atomic settings-file update, config resolver integration, crash-durable prepare/reconciliation, enforced runtime restart generation and tests; credentials/env remain non-editable.
- Acceptance: deferred arm removed in both directions; invalid complete candidates and malformed/partial/ambiguous writes fail loud; apply/replay names restart-required; restart/readback proves exact persisted leaves and mixed-generation starts refuse.
- Dependency: D169/D184/D282; existing strict command payload.
- Role: sup_sol.
- Mode: sequential foundation.
- Review: correctness, silent failures, security, tests.

### DCC2 — compose preflight and doctor rerun authority
- Scope: preflight service, bootstrap wire, rerun command and strict storage span/authority reconciliation authorized by D282.
- Acceptance: the doctor names missing/archived/malformed authority without selecting an alternate row; queue projection refusal unchanged; direct authority tests.
- Dependency: D282 item 2.
- Role: sup_sol.
- Mode: may parallel DCC1 only after interface mapping.
- Review: correctness, silent failures, security, tests.

### DCC3 — build the editable Settings surface
- Scope: server-listed editable sections, atomic N-leaf form, dirty/reset/saving/refusal/readback states, preflight and doctor-rerun controls.
- Acceptance: real BFF round-trip in a worktree state root; accessibility and parity references; no setting the resolver does not own.
- Dependency: DCC1/DCC2.
- Role: sup_terra with `/ui`.
- Mode: sequential after authority.
- Review: Spec, accessibility, ui-review, tests.

### DCC4 — implement Explorer's safe edit protocol
- Scope: closed subset already owned by ref operator-trust §5.4—presentation labels/order/grouping, notification preferences, allowlisted policy values and descriptor-allowlisted Edit Data fields; compile/apply integrity and versioning.
- Acceptance: strict draft/apply schemas, exact fingerprint/version conflict, no executable code authoring and no arbitrary values.
- Dependency: D186/D275 item 6; new-workflow authoring explicitly out.
- Role: sup_sol.
- Mode: sequential foundation.
- Review: security, correctness, silent failures, tests.

### DCC5 — build Explorer field-row editing UI
- Scope: edit affordance on the field row, draft review, conflict/refusal and applied readback; preserve read-only graph semantics.
- Acceptance: exact field ownership, keyboard/focus proof, parity references and command payload tests.
- Dependency: DCC4.
- Role: sup_terra with `/ui`.
- Mode: sequential after DCC4.
- Review: Spec, accessibility, ui-review.

### DCC6 — control-plane integration proof and closure
- Scope: settings/Explorer guards, pending-binding inventories, doc 04 and 03c cross-cutting rows, nearest AGENTS lessons.
- Acceptance: focused red-capable tests, full D191 gate, parity assert, roadmap fresh; new-workflow authoring stays named later scope.
- Dependency: DCC1–DCC5.
- Role: sup_sol review plus sup_terra fixes.
- Mode: sequential close.
- Review: all relevant axes.

### DCR1 — complete Activity's served axes
- Scope: keep `Unread` in `BY WORKFLOW` per D282; under D288, serve distinct people from insert-only keyed, generation-bound pseudonym evidence without full/suffix person ids or unkeyed digests.
- Acceptance: category/workflow totals reconcile; zero/absent arms distinct; current populated day and strict fixture prove both axes; unique-binding backfill is reviewed; mixed/incomplete generations and ambiguous bindings remain unavailable by name.
- Dependency: D282 item 1 and D288.
- Role: sup_sol.
- Mode: parallel-safe with DCR3 after authority map.
- Review: correctness, privacy/security, tests.

### DCR3 — build strict cross-date search authority
- Scope: bounded query, ranking/facets derived from the current corpus, pagination/cursor and redaction; no search over artifact bytes.
- Acceptance: exact search scopes and stable ordering over real current-workflow rows plus fixtures; malformed cursor refuses.
- Dependency: D283; current run corpus measurement recorded.
- Role: sup_sol.
- Mode: foundation for DCR4.
- Review: correctness, performance, privacy, tests.

### DCR4 — build the cross-date search surface
- Scope: Top Bar search becomes corpus search with day filtering retained as a scoped option; empty/loading/refusal/paging and navigation to exact run/day.
- Acceptance: keyboard/focus/a11y proof, responsive screenshots and parity; no cached-latest fallback.
- Dependency: DCR3.
- Role: sup_terra with `/ui`.
- Mode: sequential after DCR3.
- Review: Spec, accessibility, performance, ui-review.

### DCR5 — compose operator XLSX export for the current corpus
- Scope: operator-facing workbook schema and download command over Activity/search selection; keep retention sink distinct.
- Acceptance: workbook opens with exact documented columns, deterministic ordering/redaction, content-addressed artifact and download evidence; spreadsheet verification test.
- Dependency: current separations corpus only; I-9-specific export later.
- Role: sup_sol.
- Mode: parallel-safe after DCR3 query model.
- Review: correctness, privacy, tests.

### DCR6 — implement field-level rerun comparison
- Scope: under D289, compare prior/current immutable receipts through the closed Separations fact registry, with explicit added/removed/changed/withheld arms and values only where the reviewed disclosure posture permits.
- Acceptance: prior is exactly `retryOf` with the same workflow/item id; exact-id authority and unique registry matches hold at every boundary; missing/duplicate/mismatched authority refuses; run-detail surface and tests prove no identifier, suffix, sensitive value, or digest leakage.
- Dependency: existing receipt/retry authority and D289; no OCR facts.
- Role: sup_sol with sup_terra UI.
- Mode: sequential close.
- Review: correctness, privacy, silent failures, ui-review.

### DCA1 — serve content-addressed artifact bytes strictly
- Scope: authenticated/allowlisted artifact route, content type, digest/size verification, range posture and traversal refusal.
- Acceptance: damaged/missing/foreign bytes refuse before response; direct route and security tests.
- Dependency: R-DCF integrated to minimize run-detail conflicts.
- Role: sup_sol.
- Mode: sequential foundation.
- Review: security, correctness, silent failures.

### DCA2 — build screenshot gallery authority and surface
- Scope: diagnostic attachment index to exact screenshot resources; gallery/lightbox/download with purged/damaged states.
- Acceptance: exact bundle identity, keyboard/mobile proof and parity; no client reconstruction.
- Dependency: DCA1.
- Role: sup_terra with `/ui`.
- Mode: sequential after DCA1.
- Review: security, accessibility, ui-review.

### DCA3 — serve the run-detail Captures section for existing artifacts
- Scope: strict generic capture/download tiles only for artifacts current authority already indexes; no OCR Review or capture→workflow producer.
- Acceptance: `availableSections` advertises captures iff exact indexed artifacts verify readable; absent and corrupt stay distinct.
- Dependency: DCA1.
- Role: sup_sol + sup_terra UI.
- Mode: parallel-safe with DCA2 after DCA1.
- Review: correctness, security, accessibility.

### DCA4 — finish archive evidence viewing
- Scope: non-byte capture record viewer, archived attachment metadata and exact downloadable bytes when retained; honest purged state.
- Acceptance: archive snapshot identity cannot be replaced by live/current data; strict tests and parity.
- Dependency: DCA1 and R-DCF archive close.
- Role: sup_terra.
- Mode: sequential after dependencies.
- Review: correctness, accessibility, ui-review.

### DCA5 — artifact/viewer proof and deferral closure
- Scope: pending wire bindings, doc 04 search/screenshots row, guard inventory, parity attribution and nearest AGENTS lessons.
- Acceptance: focused route/UI tests, full gate, parity assert and roadmap fresh; phone production path remains explicitly Phase 3c.
- Dependency: DCA1–DCA4.
- Role: sup_sol review plus sup_terra fixes.
- Mode: sequential close.
- Review: all relevant axes.

### DCT1 — map and name the retired product boundary
- Scope: distinguish mobile document capture (`capture.html`, phone/operator session UI, capture commands, session/outbox authority and OCR handoff) from generic diagnostic screenshots, artifact evidence and run-detail capture records.
- Acceptance: an exact keep/delete inventory is committed in the run evidence before deletion; no generic evidence is removed by name collision.
- Role: sup_scout mapping with sup_sol authority judgment.
- Mode: sequential foundation.
- Review: Spec, correctness, security.

### DCT2 — remove the capture UI and browser entry
- Scope: operator Start Capture/session panels, phone bundle, `capture.html`, Vite entry, capture-specific client/state and parity references.
- Acceptance: no visible Capture Mode door or dead route remains; the ordinary intake surface reflows without a capture-session branch; built bundle has only intended entries.
- Dependency: DCT1.
- Role: sup_terra with `/ui`.
- Mode: parallel-safe with DCT3 after inventory.
- Review: accessibility, performance, ui-review, tests.

### DCT3 — remove capture transport, command and authority seams
- Scope: capture-only BFF routes/services, phone ingress policy, domain wire/contracts, durable session/outbox authority and composition bindings that exist solely for the retired product.
- Acceptance: no inert endpoint, command arm, configuration capability, pending binding or schema consumer remains; migrations/compatibility receive an explicit rebuild-safe disposition rather than accidental orphaning.
- Dependency: DCT1.
- Role: sup_sol.
- Mode: parallel-safe with DCT2 after inventory.
- Review: correctness, silent failures, security, tests.

### DCT4 — remove capture-to-intake/workflow plans and deferred obligations
- Scope: capture handoff/binding code and every active phase/ref/roadmap promise for mobile capture, including D278/D279 residue, while preserving historical records as historical.
- Acceptance: owning normative docs and the decision pointer ratify retirement in one commit; active roadmap/phase rows cannot schedule capture later; generated roadmap is fresh.
- Dependency: DCT1–DCT3 facts.
- Role: sup_sol for authority reconciliation; sup_terra for documentation.
- Mode: sequential after code boundary is proven.
- Review: Spec, docs, roadmap governance.

### DCT5 — prove absence without damaging evidence features
- Scope: architecture guards, manifests, capabilities, test fixtures and searches proving the mobile feature is absent and generic diagnostic/run evidence still works.
- Acceptance: violating fixture or equivalent red-capable test catches reintroduction of the retired browser/route surface; artifact screenshot and run-detail evidence tests remain green.
- Dependency: DCT2–DCT4.
- Role: sup_sol review plus sup_terra fixes.
- Mode: sequential.
- Review: tests, security, regression.

### DCT6 — capture-retirement integration close
- Scope: full gate, parity attribution, plan/roadmap freshness, nearest AGENTS lessons and branch/worktree sweep.
- Acceptance: full D191 gate and parity green; zero active capture-product promise; no unrelated evidence/capture deletion; immutable review clean.
- Dependency: DCT1–DCT5.
- Role: sup_sol immutable review.
- Mode: sequential close.
- Review: all relevant axes.

### DDM1 — define the `/demo` authority and route contract
- Scope: map the current Kuali separation workflow's declared executable scenarios and any durable dry-run result authority; define a strict demo projection without importing `tests/**` into production or presenting fixtures as operator authority.
- Acceptance: exact included scenario ids and source are test-pinned; empty/unavailable/result arms are distinct; `/demo` is a real pathname, not an overloaded query-string takeover.
- Dependency: R-DCT merged.
- Role: sup_sol.
- Mode: sequential foundation.
- Review: correctness, truthfulness, security.

### DDM2 — serve the current-workflow demo catalog
- Scope: strict BFF/wire/client read for the currently supported Kuali separation scenario set and representative run states justified by repository authority.
- Acceptance: scenario ordering and labels derive from the descriptor/executable manifest; no source-file contents, identifiers or test-only secrets cross the wire; later workflows require registration, not UI edits.
- Dependency: DDM1.
- Role: sup_sol.
- Mode: sequential.
- Review: correctness, privacy, tests.

### DDM3 — build the `/demo` scenario gallery
- Scope: an Operate-mode product page using the existing design system, with workflow context, scenario list, selected run/story, state/evidence summary and a clear route back to the live dashboard.
- Acceptance: Kuali separation is the sole visible workflow for this instance; no Capture Mode; loading/empty/error/long-label/responsive states and semantic navigation are complete.
- Dependency: DDM2.
- Role: sup_terra with `/ui`.
- Mode: sequential after wire.
- Review: Spec, accessibility, ui-review.

### DDM4 — scenario-run detail and deep-link behavior
- Scope: stable scenario selection/deep links under `/demo`, keyboard/focus behavior, back/forward navigation and truthful handling when a declared scenario has no durable result.
- Acceptance: refresh and copied URL restore the same scenario; no stale-latest or invented successful run; focus and browser history tests pass.
- Dependency: DDM3.
- Role: sup_terra with `/ui`.
- Mode: sequential.
- Review: correctness, accessibility, tests.

### DDM5 — browser, parity and hostile-state proof
- Scope: built-browser verification at the project viewport matrix, long ids/labels, empty and refusal responses, light/dark themes and coarse/fine pointer where interactive controls differ.
- Acceptance: `playwright-cli` screenshots plus parity/a11y references are attributed; no overflow, dead door or inaccessible state.
- Dependency: DDM3–DDM4.
- Role: sup_terra with sup_sol review.
- Mode: sequential.
- Review: accessibility, performance, ui-review.

### DDM6 — demo-route integration close
- Scope: route/entry guards, docs/roadmap/AGENTS updates, full gate and sweep.
- Acceptance: `/demo` is built and served by the same supported dashboard runtime; only Kuali separation is registered; adding a workflow is authority-driven; full D191 gate, parity and roadmap check green.
- Dependency: DDM1–DDM5.
- Role: sup_sol immutable review.
- Mode: sequential close.
- Review: all relevant axes.

## Decisions gating runs
- D282 clears Activity/storage and activates cross-cutting work.
- D283 excludes OCR Review, Group People, capture→workflow and later-workflow-only export shapes.

## Residue carried in
- Phase 4 C1–C4 → R-DCF.
- Phase 4 editable settings + Explorer edit → R-DCC.
- UI board Activity residue + cross-cutting search/export/rerun → R-DCR; storage diagnosis → R-DCC DCC2.
- Phase 4 artifact-bytes/screenshots and current-artifact viewers → R-DCA after R-DCF.
- Operator-retired mobile document capture and every active promise for it → R-DCT.
- Current-workflow scenario showcase at a real `/demo` path → R-DDM after R-DCT.
- Phase 4 C5/C6 and Review/People workflow-specific producers → Phase 3c by D283.
