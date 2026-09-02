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
| 4. Dry-run preview | **NEEDS COORDINATOR — contract conflict.** Doc 03c §4 and ref guards-and-tests §10.11 require a T1b live dry-run manifest for every workflow, but ref workflow-model §2/D209 makes a graph with no transaction node refuse `dryRun` as `no-transaction-node`. This intake does not invent an exception. The structural T1 half remains required; the live half waits for the owning contracts to resolve §4. |
| 5. Freshness maxAges | The write-feeding freshness question is not applicable because no output feeds a write in this workflow. Each browser read still owes the normal task provenance/read-time evidence and strict output validation from ref task-contract §2.7. |
| 6. Workflow-specific gates/data | No identity/OCR/normalization gate and no test-vs-production instance choice. Preserve the existing typed name/EID ingress and spreadsheet intake for Search. Match gets its own mode-specific typed input/parser; a file or caller cannot select a mode by smuggling data into another field. |
| 7. Reuse map | REUSE `ucpath/search-person-org` and `ucpath/read-job-summary` unchanged. CUSTOMIZE the existing semantic-ready UCPath driver with an HR Tasks Search/Match operation, then BUILD the missing reusable `ucpath/search-hr-tasks-person` read task and its strict contract. Preserve the two distinct UCPath surfaces behind one workflow id. No copied selector or legacy function name becomes a new domain concept. See §2. |
| 8. Local artifact effects | None. Neither mode downloads bytes nor updates a mutable local file. |
| 9. Scenario inventory | §3 is the required structural/live matrix. Negative and impossible-world variants stay synthetic; live cases correspond only to truthful registry arms. |
| 10. Delegation and queue | Keep the existing standalone workflow and `reject-active` enqueue policy. There are no child edges or joins. Both modes remain rows of `person-lookup`, never child workflow identities. |
| 11. Trust contract | Inherit ref operator-trust §3.2 and ref guards-and-tests §10.11. The workflow-specific delta is that each mode preserves its typed result/evidence, and a Match lookup/page failure is `unknown/failed`, never no-match. |
| 12. Authoring boundary | Source-authored. The editor may apply only already-closed presentation/policy edits. Mode structure, input schemas, selectors, bindings, graph/result derivation, and proof remain code changes (doc 03c §b.12). |

## 2. Mode and task delta

One descriptor must expose two run-modal options (`ref dashboard-surfaces` §9, D15):

| Mode | Question and surface | Input/subject | Task seam | Result obligation |
|---|---|---|---|---|
| `search` | Resolve a person and status through Person Organizational Summary, with the existing CRM cross-verification/date option. | Existing canonical name-or-EID union; queue subject remains the searched EID/name until verified replacement. | REUSE `ucpath/search-person-org`, CRM reads, and `workflow:person-lookup/read-active-status`; retain the Order 0 graph and behavior. | Preserve the existing selected/not-found/ambiguous refusals, CRM evidence, active-state result, and optional dates arm. |
| `match` | Answer the rehire-vs-new-hire matching question on UCPath HR Tasks Search/Match. This is not Person Organizational Summary. | A strict mode-specific person record: name plus DOB and/or SSN as the live surface requires; legacy `x` means unavailable and cannot become stored identity data. The final contract must reject when both match identifiers are absent. | CUSTOMIZE the UCPath driver with one typed HR Tasks Search/Match operation and BUILD `ucpath/search-hr-tasks-person`; reuse `ucpath/read-job-summary` wherever the recipe needs the already-rich Job Summary page rather than rescraping it. Pure interpretation belongs in a sessionless `workflow:person-lookup/derive-match-result` task. | Return a typed match/no-match/ambiguous/unknown result with the observed candidate evidence; never select the first candidate or convert a page/selector failure into no-match. |

Legacy evidence is frozen data, not a runtime dependency. Ported HR Tasks facts cite legacy commit
`9d19e4141d57617e2bf895e21e34a5bd8f15047c` plus the exact source blob used; current anchors are
`src/workflows/person-lookup/match.ts` at `a1191411148add3ea4b5c0e2fc970ae74d1f99b6`
and `src/systems/ucpath/navigate.ts` at
`773b52873f3c59ccc2498a51d60ac5834b2608e1`. Every selector is re-verified live before porting
(D150); the legacy value is provenance, not proof of current page state.

## 3. Proof and scenario matrix for R3

| Proof | Required cases |
|---|---|
| T1 structural — Search | EID and name ingress; unique selection; no result; multiple/ambiguous result; CRM found/missing; CRM transient retry and permanent failure; UCPath drill subject mismatch; optional CRM dates included/not requested; crash after a checkpoint followed by replay/resume; every declared conditional/refusal/result arm. Reuse and relocate current useful scenarios rather than freezing legacy implementation trivia. |
| T1 structural — Match | DOB+SSN, DOB-only, and SSN-only accepted forms that the final strict schema admits; both identifiers absent rejected at ingress; unique match; no-match; multiple/ambiguous candidates; malformed result grid; subject mismatch; transient retry; permanent auth/page/schema failure; result/probe unknown; crash after the read checkpoint followed by replay/resume. |
| T1b live — Search | Required by doc 03c/ref guards-and-tests but blocked by the D209 conflict in §4. After an owning-contract resolution, use current registered Search subjects only for truthful input arms and record reached/excluded nodes, checkpoints, verdict and zero write-authority deltas. |
| T1b live — Match | Required but blocked by §4's D209 conflict. After resolution, use a dated current HR Tasks record whose secret-backed name/DOB/identifier inputs exercise one eligible Match result without exposing values in committed evidence. |
| T2 — mode chooser | The run modal serves Search and Match as two options of the one `person-lookup` workflow, with mode-specific labels, input instructions/parsers, and no duplicate registry/archive/Explorer identity. |
| T3 — live mode condition | Required for the new mode interaction but blocked by §4 because T3 attaches to a dry-run scenario. After resolution, start each mode through the real ceremony and prove the selected mode controls the expected title/input contract and timeline/result while the durable workflow id remains `person-lookup`. Ordinary generic surfaces need no duplicate feature proof. |

No transaction/probe/commit crash window exists because neither mode has a transaction node. Gate,
delegation/join and commit-proof branches are also impossible by declared graph shape; they are not
manufactured as scenarios. The applicable crash case is interruption between read checkpoints and
terminal derivation, with normal task replay/resume behavior.

R3 must add public labels to `config/test-subjects.json` only after same-day availability checks.
All person values that feed live identity/search remain in ignored configuration through
`src/domain/secrets.ts`; the committed registry contains references, availability, purpose, and
cleanup/read-only obligations only. A missing, gone, unknown, or incomplete subject is `blocked`
before browser start, never converted into a fixture or a failed run.

### Outcome confidence

| Mode/outcome | Confidence | Required evidence |
|---|---|---|
| Search `active` / `inactive` | `verified` | Resolved UCPath candidate, CRM observation and the typed active-status fold agree on identity and produce the stated result. |
| Search `undetermined` | `partial` | The successful reads and the reason for the missing/conflicting conclusion are retained, but the workflow cannot verify active status. |
| Search `not-found` | `verified` search outcome; run refuses | UCPath search completed with zero candidates. Downstream bindings do not fabricate a selected person. |
| Search `ambiguous` | `partial`; run refuses | UCPath returns two or more candidate EIDs and no selected person; evidence proves ambiguity, not identity. |
| Match `match` / `no-match` | `verified` | The live HR Tasks result grid or definitive no-matching-person dialog settled, and the task retained the observed subject/candidate evidence. |
| Match `ambiguous` | `partial`; run refuses | More than one plausible candidate is retained with no automatic first-row selection. |
| Either mode `unknown` / failure | `unknown` | Auth, page, selector, schema, subject, or outcome-race evidence did not support a trustworthy business result. The run fails with that evidence. |

## 4. NEEDS COORDINATOR — read-only T1b contract

Authority conflict, preserved without resolution:

- doc 03c §4 and ref guards-and-tests §10.11 require a live T1b dry-run manifest for every workflow;
- ref workflow-model §2/D209 requires `dryRun` to refuse when the graph has no transaction node,
  because it would otherwise be byte-identical to an ordinary run; and
- Search and Match must remain structurally read-only, so a transaction node cannot be added merely
  to satisfy the runner.

The coordinator's operator decision sheet should compare: **A (recommended)** add an explicit
`live-read` T1b admission/result arm for transaction-free graphs while leaving D209's `dryRun`
meaning unchanged; **B** record an ordinary live run outside the T1b dry-run runner, accepting a
second evidence path; or **C** waive the live half for read-only workflows, reducing the every-
workflow proof promised by doc 03c. A no-op transaction is not a valid option because it would lie
about effect and graph semantics.

## 5. Capability and close evidence

`legacy-workflow-person-lookup` stays `open` during intake. It may close only after R3 lands both
modes, T1/T2/T3 and live evidence, updates the derived capability entry with those commits/results,
and proves the generic recipe projections. Production routing remains on legacy until the all-at-once
cutover (D89/D93).

## 6. Evidence log

- 2026-09-02 — intake reconciled against doc 03c §Order 1/§b, the current mode-less
  `src/workflows/person-lookup/descriptor.ts`, ref stores and the frozen legacy sources above.
  Implementation and live mode proof remain open for R3.
