# I-9 signer lookup — Order 1 migration intake

**Status:** implementation open; workflow-specific intake and login/search verification completed
2026-09-02  
**Plan owner:** `docs/rebuild/03c-migrate-the-remaining-workflows.md` §Order 1  
**Inherited contracts:** ref charter §1/§3/§8; ref task-contract §2.7/§2.8/§3.1; ref stores §3;
ref guards-and-tests §10.11; ref operator-trust §3.2; ref clock-config-secrets §4

`i9-lookup` answers who signed Form I-9 Section 2. It is a pure read of Tracker I-9 Complete through
the UCOP portal and UCSD SSO/Duo. The rebuild currently has only an unwired, zero-task `i9` store.

## 1. Workflow-specific decisions and §b completeness

There are no unresolved `you:` lines. The remaining unknowns are live evidence/canary inputs or
implementation facts with fail-loud answers already fixed by repository policy.

| §b item | Order 1 answer |
|---|---|
| 1. Real commits | None. The signer lookup is a pure read. No prepare/commit pair, transaction lease, mutation capability, idempotency key, or external write is permitted. |
| 2. Completion check per submit | Not applicable: there is no submit. A signed/unsigned/historical/not-found/unable-to-access/error result is read evidence, not a commit proof. |
| 3. Double-submit probe and budget | Not applicable: there is no transaction node or fence. |
| 4. Dry-run preview | T1b executes the real read and records its terminal typed result. No transaction or write-style preview is declared, and all write-authority deltas remain zero. |
| 5. Freshness maxAges | The write-feeding freshness question is not applicable within this workflow. Every I-9 page read still records its own read time and provenance and parses a strict fixed output. |
| 6. Workflow-specific gates/data | No operator gate, intake manifest, OCR approval, or test-vs-production instance choice. Canonical input is a strict person search shape (first and last name, with optional SSN only where needed to disambiguate); sensitive values stay outside committed artifacts. |
| 7. Reuse map | BUILD the `i9` store driver, verified login recipe, UI/page-state catalog, and two page-visit read tasks described in §2. REUSE common SSO/Duo and browser-store/session contracts. No legacy runtime import is allowed. |
| 8. Local artifact effects | None. The lookup neither downloads immutable bytes nor updates a mutable local file. A diagnostic screenshot is evidence, not an artifact side effect. |
| 9. Scenario inventory | §3 enumerates the required matrix. Paper/historical, unsigned, inaccessible, and true not-found are separate states; page uncertainty is never one of them. |
| 10. Delegation and queue | The Phase 3c plan owns `i9-lookup` as one workflow with ordinary generic recipe projections. Its exact standalone/parent-consumer registration is an R3 source fact, not a second workflow identity. Any later parent edge must declare a stable item id, typed result and normal child failure/cancel/resume behavior. |
| 11. Trust contract | Terminal outcomes carry strict task outputs, per-leaf provenance/redaction, named page-state evidence, diagnostic screenshot references, and standard receipt/explain-run projection. `signed` requires the audit row plus non-empty Created By; `unsigned` requires a rendered audit table with no signed row; `historical` requires the redirected historical route; `unable-to-access` requires the visible access alert; page/selector/probe uncertainty is `error/unknown`. |
| 12. Authoring boundary | Source-authored. Login facts, selectors, task schemas, bindings, graph/result derivation, and proof remain code changes; the editor may apply only closed presentation/policy edits. |

## 2. Store, task, and driver seams

The store lands under `src/stores/i9/` in ref task-contract §3.1's normal browser-store layout.
New tasks follow D194: one rich fixed output per page visit, not a runtime-selected field list.

| Classification | Seam | Contract |
|---|---|---|
| REUSE | common UCSD SSO/Duo primitives, browser-session lease, retry taxonomy, provenance/redaction and diagnostic capture | The `i9` login recipe still owns its I-9-specific UCOP launch and WAYF navigation. Success requires two independent content facts—e.g. the Dashboard link and unique Search Options control—never only a URL (D120). |
| BUILD | `i9/search-employees` (final name subject to R3 contract naming) | One Search dialog visit. Strict input admits only the supported criteria. Rich fixed output records every useful result-row leaf, including profile/I-9 ids, next action and dates with explicit absence arms. A malformed row throws with row index/shape; it is not skipped. Zero rows plus a visible access alert is `unable-to-access`; failure to check that alert is `unknown/error`, not not-found. |
| BUILD | `i9/read-form-summary` (final name subject to R3 contract naming) | One summary page visit keyed by the selected profile/I-9 ids. Output distinguishes modern vs historical route, records the populated audit surface, and carries a typed Signed Section 2 observation. `unsigned` is valid only after the audit header is visibly rendered and no signed row exists. |
| BUILD | workflow mini-store/result fold | Purely select the eligible signer row and derive the terminal union. It cannot use `""`, the first candidate, or a swallowed exception as a plausible result. |

Frozen provenance for the port is legacy HEAD
`9d19e4141d57617e2bf895e21e34a5bd8f15047c`: workflow
`src/workflows/i9-lookup/workflow.ts` at
`a6625306aa8ae8c59f1cf7db0dda8c7447eec8e2`; login
`src/systems/i9/login.ts` at `03355d70c6515468ad7b329a0e84843f631ef27a`; search/signer at
`597db3bd5cbdfc15f542c094e1b16cdbeb3153e2`; selectors at
`5b5bd4d88fdeb9f8e2ffbf70ef6ed0aef9934cfc`. R3 ports only facts re-verified live.

Two legacy behaviors are explicitly rejected by the rebuild's fail-loud contract:

- `src/systems/i9/search.ts` warns and skips a malformed short result row. The rebuild throws rather
  than shrinking a real result set into a false no-match.
- `src/systems/i9/signer.ts` converts an access-alert locator failure to count zero. The rebuild
  preserves `unknown/error`; it cannot report a genuine not-found from a failed distinction check.

## 3. Proof and scenario matrix for R3

| Proof | Required cases |
|---|---|
| T1 structural | Signed modern record; rendered modern record with no Signed Section 2 row; historical redirect; true zero result; visible access-restricted zero result; multiple rows with one eligible action; only incomplete Section 1/2 actions; missing profile/I-9 id; malformed grid row; empty signer cell; audit table timeout; auth/page/schema transient retry; permanent failure; result/probe unknown; subject mismatch. |
| T1b live | At least one same-day `available` signer subject that reaches a modern summary and produces a non-empty signed observation, plus any additional truthful registry arms the manifest claims. Record reached/excluded nodes, checkpoints, result/receipt evidence and zero write deltas. |
| Generic projection | Start/queue/detail/archive/Explorer conformance rides the recipe compiler suite. I-9 adds no new dashboard capability and therefore no duplicate T2/T3 feature pair. |

R3 must register a public canary label only after finding a current, access-visible record with an
eligible completed action. Name, SSN and any other person values live in ignored configuration via
`src/domain/secrets.ts`; profile/I-9 identifiers in durable live evidence are redacted according to
the owning field policy. A missing, inaccessible, incomplete, gone, or unknown candidate blocks
before the live workflow starts.

## 4. 2026-09-02 live verification

Read-only verification used `playwright-cli` with Duo Autopilot and closed its owned `r2i9` session.
No employee record was changed and no create/save/submit action was available to the pass.

- UCOP launch link, WAYF campus chooser, UCSD SSO and Duo completed to Tracker I-9 Complete.
- The required-training notification was present and its existing Dismiss → Yes path reached the
  Home Page.
- Login success has two current content facts: the Dashboard link and exactly one
  `#divSearchOptions` control.
- After closing the unrelated current-product announcement overlay, the named Search for Existing
  Employee dialog and its clear-filter link, last/first/SSN/profile/employee inputs, and Search button
  each resolved exactly once.
- The source-pinned 2026-06-06 signer subject now returns one nine-cell row whose next action is an
  incomplete Section 1/2 action. It is no longer eligible signer evidence; direct summary navigation
  yields the application's System Warning page. Therefore the summary heading, audit header and
  Signed Section 2 selectors were **not** re-verified. R3 needs a new same-day canary and must not
  treat the legacy observation as current proof.

## 5. Capability and close evidence

`legacy-workflow-i9-lookup` stays `open` during intake. Its current reason incorrectly calls this a
UCPath read; doc 03c owns the correction: the workflow reads the I-9 system. R3 updates the derived
capability entry only with the native store/workflow, T1/live evidence and generic projection proof.
Production routing remains on legacy until D89/D93's all-at-once cutover.

## 6. Evidence log

- 2026-09-02 — workflow-specific intake completed; login/search locators verified live; source-pinned
  summary canary found ineligible, so summary/audit verification and implementation remain open for
  R3.
