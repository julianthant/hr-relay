# Person lookup — Order 1 Search + Match migration intake

**Status:** implementation open; workflow-specific intake completed 2026-09-02  
**Plan owner:** `docs/rebuild/03c-migrate-the-remaining-workflows.md` §Order 1  
**Inherited contracts:** ref charter §1/§3/§8; ref workflow-model §1.6/§8; ref task-contract
§2.7/§2.8/§3.1; ref stores §2; ref dashboard-surfaces §9; ref guards-and-tests §10.11;
ref operator-trust §3.2

This record covers Order 1's two faces of the existing `person-lookup` workflow. It does not
describe or assume D311's unlanded compiler implementation. Order 0 remains the live-proven UCPath
Person Organizational Summary + CRM flow; Order 1 adds the legacy HR Tasks Match question without
minting a second workflow identity.

## 1. Workflow-specific decisions and §b completeness

There are no unresolved `you:` lines. The owning phase and inherited platform contracts settle the
workflow identity, effect class, proof tier, and authoring boundary. The items below record only the
Order 1 deltas.

| §b item | Order 1 answer |
|---|---|
| 1. Real commits | None. Search and Match are pure reads. No transaction, mutation capability, prepare/commit pair, lease, idempotency key, or external write is permitted. |
| 2. Completion check per submit | Not applicable: there is no submit. Terminal results are read evidence, not a receipt/save/upload proof. |
| 3. Double-submit probe and budget | Not applicable: there is no transaction node or fence. |
| 4. Dry-run preview | The T1b manifest must record the exact read nodes and terminal result for each live arm. No transaction node or write row may exist; do not invent a write-style preview for this read workflow. |
| 5. Freshness maxAges | The write-feeding freshness question is not applicable because no output feeds a write in this workflow. Each browser read still owes the normal task provenance/read-time evidence and strict output validation from ref task-contract §2.7. |
| 6. Workflow-specific gates/data | No identity/OCR/normalization gate and no test-vs-production instance choice. Preserve the existing typed name/EID ingress and spreadsheet intake for Search. Match gets its own mode-specific typed input/parser; a file or caller cannot select a mode by smuggling data into another field. |
| 7. Reuse map | REUSE `ucpath/search-person-org` and `ucpath/read-job-summary` unchanged. CUSTOMIZE the existing semantic-ready UCPath driver with an HR Tasks Search/Match operation and strict contracts; preserve the two distinct UCPath surfaces behind one workflow id. No copied selector or legacy function name becomes a new domain concept. See §2. |
| 8. Local artifact effects | None. Neither mode downloads bytes nor updates a mutable local file. |
| 9. Scenario inventory | §3 is the required structural/live matrix. Negative and impossible-world variants stay synthetic; live cases correspond only to truthful registry arms. |
| 10. Delegation and queue | Keep the existing standalone workflow and `reject-active` enqueue policy. There are no child edges or joins. Both modes remain rows of `person-lookup`, never child workflow identities. |
| 11. Trust contract | Strict task outputs, per-leaf provenance/redaction, screenshots on named error/no-result states, typed terminal outcomes, standard failure notification, receipt projection, and `explain run` are inherited from ref operator-trust §3.2 and ref guards-and-tests §10.11. A lookup/probe failure cannot be reported as not-found. |
| 12. Authoring boundary | Source-authored. The editor may apply only already-closed presentation/policy edits. Mode structure, input schemas, selectors, bindings, graph/result derivation, and proof remain code changes (doc 03c §b.12). |

## 2. Mode and task delta

One descriptor must expose two run-modal options (`ref dashboard-surfaces` §9, D15):

| Mode | Question and surface | Input/subject | Task seam | Result obligation |
|---|---|---|---|---|
| `search` | Resolve a person and status through Person Organizational Summary, with the existing CRM cross-verification/date option. | Existing canonical name-or-EID union; queue subject remains the searched EID/name until verified replacement. | REUSE `ucpath/search-person-org`, CRM reads, and `workflow:person-lookup/read-active-status`; retain the Order 0 graph and behavior. | Preserve the existing selected/not-found/ambiguous refusals, CRM evidence, active-state result, and optional dates arm. |
| `match` | Answer the rehire-vs-new-hire matching question on UCPath HR Tasks Search/Match. This is not Person Organizational Summary. | A strict mode-specific person record: name plus DOB and/or SSN as the live surface requires; legacy `x` means unavailable and cannot become stored identity data. The final contract must reject when both match identifiers are absent. | CUSTOMIZE the UCPath driver with one typed HR Tasks Search/Match operation; reuse `ucpath/read-job-summary` wherever the recipe needs the already-rich Job Summary page rather than rescraping it. Pure interpretation belongs in a sessionless workflow mini-store. | Return a typed match/no-match/ambiguous/unknown result with the observed candidate evidence; never select the first candidate or convert a page/selector failure into no-match. |

Legacy evidence is frozen data, not a runtime dependency. Ported HR Tasks facts cite legacy commit
`9d19e4141d57617e2bf895e21e34a5bd8f15047c` plus the exact source blob used; current anchors are
`src/workflows/person-lookup/match.ts` at `a1191411148add3ea4b5c0e2fc970ae74d1f99b6`
and `src/systems/ucpath/navigate.ts` at
`773b52873f3c59ccc2498a51d60ac5834b2608e1`. Every selector is re-verified live before porting
(D150); the legacy value is provenance, not proof of current page state.

## 3. Proof and scenario matrix for R3

| Proof | Required cases |
|---|---|
| T1 structural — Search | EID and name ingress; unique selection; no result; multiple/ambiguous result; CRM found/missing; CRM transient retry and permanent failure; UCPath drill subject mismatch; optional CRM dates included/not requested; every declared conditional/refusal/result arm. Reuse and relocate current useful scenarios rather than freezing legacy implementation trivia. |
| T1 structural — Match | DOB+SSN, DOB-only, and SSN-only accepted forms that the final strict schema admits; both identifiers absent rejected at ingress; unique match; no-match; multiple/ambiguous candidates; malformed result grid; subject mismatch; transient retry; permanent auth/page/schema failure; result/probe unknown. |
| T1b live — Search | At least one current registered Search subject for each truthful input arm exercised by the manifest. Record reached/excluded nodes, checkpoints, receipt verdict, and zero `write_intents` / `write_attempts` / `durable_outbox` deltas. |
| T1b live — Match | A dated current HR Tasks record whose stored secret-backed name/DOB/identifier inputs can exercise one eligible Match result without exposing values in the registry or evidence. The manifest records the mode and zero write deltas. |
| T2 — mode chooser | The run modal serves Search and Match as two options of the one `person-lookup` workflow, with mode-specific labels, input instructions/parsers, and no duplicate registry/archive/Explorer identity. |
| T3 — live mode condition | Start each mode through the real ceremony and prove the selected mode controls the expected title/input contract and timeline/result while the durable workflow id remains `person-lookup`. Ordinary generic surfaces need no duplicate feature proof. |

R3 must add public labels to `config/test-subjects.json` only after same-day availability checks.
All person values that feed live identity/search remain in ignored configuration through
`src/domain/secrets.ts`; the committed registry contains references, availability, purpose, and
cleanup/read-only obligations only. A missing, gone, unknown, or incomplete subject is `blocked`
before browser start, never converted into a fixture or a failed run.

## 4. Capability and close evidence

`legacy-workflow-person-lookup` stays `open` during intake. It may close only after R3 lands both
modes, T1/T2/T3 and live evidence, updates the derived capability entry with those commits/results,
and proves the generic recipe projections. Production routing remains on legacy until the all-at-once
cutover (D89/D93).

## 5. Evidence log

- 2026-09-02 — intake reconciled against doc 03c §Order 1/§b, the current mode-less
  `src/workflows/person-lookup/descriptor.ts`, ref stores and the frozen legacy sources above.
  Implementation and live mode proof remain open for R3.
