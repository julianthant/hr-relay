# I-9 signer lookup - unnumbered candidate evidence

**Status:** evidence only; not an admitted workflow and not authorized for implementation. The
workflow-specific intake and login/search observation completed 2026-09-02, before D319.

**Admission owner:** ref workflow-model §1.6.2 and Phase 4; this candidate remains unnumbered until
the operator admits it after Phase 3

**Inherited contracts:** ref charter §1/§3/§8; ref task-contract §2.7/§2.8/§3.1;
ref stores §1/§4; ref guards-and-tests §10.11;
ref operator-trust §3.2; ref clock-config-secrets §4

**Post-base authority amendment:** integration commit `1273c360`, ref workflow-model
§1.6.1/§5.6.1/§5.8 and D312–D316

This document preserves a proposed `i9-lookup` boundary and the evidence collected for it. D319
requires the operator to select the candidate, verify the complete admission packet and approve it
before this proposal receives a phase number or becomes implementation work.

The proposal answers who signed Form I-9 Section 2. It is a pure read of Tracker I-9 Complete through
the UCOP portal and UCSD SSO/Duo. The rebuild currently has only an unwired, zero-task `i9` store.
This intake applies the ratified D312–D318 authoring/runtime contracts without implementing this
candidate.

## 1. Workflow-specific decisions and §b completeness

There are no unresolved `you:` lines. The remaining unknowns are live evidence/canary inputs or
implementation facts with fail-loud answers already fixed by repository policy.

| §b item | Candidate answer |
|---|---|
| 1. Real commits | None. The signer lookup is a pure read. No prepare/commit pair, transaction lease, mutation capability, idempotency key, or external write is permitted. |
| 2. Completion check per submit | Not applicable: there is no submit. A signed/unsigned/historical/not-found/unable-to-access/error result is read evidence, not a commit proof. |
| 3. Double-submit probe and budget | Not applicable: there is no transaction node or fence. |
| 4. T1b live proof | **RESOLVED by D318; implementation open.** This zero-transaction workflow uses the explicit `live-read` arm with `dryRun=false`, graph admission proving no transaction node and exact zero deltas in all three write-authority tables. D209 still refuses transaction preview as `no-transaction-node`. |
| 5. Freshness maxAges | The write-feeding freshness question is not applicable within this workflow. Every I-9 page read still records its own read time and provenance and parses a strict fixed output. |
| 6. Workflow-specific gates/data | No operator gate, intake manifest, OCR approval, or test-vs-production instance choice. Canonical input is a strict person search shape (first and last name, with optional SSN only where needed to disambiguate); sensitive values stay outside committed artifacts. |
| 7. Reuse map | BUILD the `i9` store driver, verified login recipe, UI/page-state catalog, and two page-visit read tasks described in §2. REUSE common SSO/Duo and browser-store/session contracts. No legacy runtime import is allowed. |
| 8. Local artifact effects | None. The lookup neither downloads immutable bytes nor updates a mutable local file. A diagnostic screenshot is evidence, not an artifact side effect. |
| 9. Scenario inventory | §3 enumerates the required matrix. Paper/historical, unsigned, inaccessible, and true not-found are separate states; page uncertainty is never one of them. |
| 10. Delegation and queue | Register `i9-lookup` as a standalone, single-surface workflow with the standard `reject-active` enqueue policy and ordinary generic projections. D315 requires its own operations to be explicit stable-id `task(...)` entries; this workflow has no `parallel`, `delegate`, `gate`, or `transaction` entry. A later parent's explicit child edge belongs to that parent's workflow and does not change this workflow's role or identity. |
| 11. Trust contract | Inherit ref operator-trust §3.2 and ref guards-and-tests §10.11. The workflow-specific outcome/confidence predicates are in §3; notably a failed access/summary observation is `error` with `unknown` confidence, never not-found/unsigned. |
| 12. Authoring boundary | Source-authored. D312's strict four-artifact cap applies to a reuse-only workflow; I-9 is not reuse-only because §2 builds new behavior. Its workflow surface is `src/workflows/i9-lookup/workflow.ts`, the structural scenario, the live declaration, and this migration record, plus only the genuinely new driver/task/login/UI files that own that behavior. They may not carry descriptor/module/registry/dashboard glue. |

## 2. Store, task, and driver seams

The store lands under `src/stores/i9/` in ref task-contract §3.1's normal browser-store layout.
New tasks follow D194: one rich fixed output per page visit, not a runtime-selected field list.

| Classification | Seam | Contract |
|---|---|---|
| REUSE | common UCSD SSO/Duo primitives, browser-session lease, retry taxonomy, provenance/redaction and diagnostic capture | The `i9` login recipe still owns its I-9-specific UCOP launch and WAYF navigation. Success requires two independent content facts—e.g. the Dashboard link and unique Search Options control—never only a URL (D120). |
| BUILD | `i9/search-employees` | One Search dialog visit. Strict input admits only the supported criteria. Rich fixed output records every useful result-row leaf, including profile/I-9 ids, next action and dates with explicit absence arms. A malformed row throws with row index/shape; it is not skipped. Zero rows plus a visible access alert is `unable-to-access`; failure to check that alert is `unknown/error`, not not-found. |
| BUILD | `i9/read-form-summary` | One summary page visit keyed by the selected profile/I-9 ids. Output distinguishes modern vs historical route, records the populated audit surface, and carries a typed Signed Section 2 observation. `unsigned` is valid only after the audit header is visibly rendered and no signed row exists. |
| BUILD | `workflow:i9-lookup/derive-signer-result` | Purely select the eligible signer row and derive the terminal union. It cannot use `""`, the first candidate, or a swallowed exception as a plausible result. |

Frozen provenance for the port is legacy HEAD
`9d19e4141d57617e2bf895e21e34a5bd8f15047c`: workflow
`src/workflows/i9-lookup/workflow.ts` at
`a6625306aa8ae8c59f1cf7db0dda8c7447eec8e2`; login
`src/systems/i9/login.ts` at `03355d70c6515468ad7b329a0e84843f631ef27a`; search/signer at
`597db3bd5cbdfc15f542c094e1b16cdbeb3153e2`; selectors at
`5b5bd4d88fdeb9f8e2ffbf70ef6ed0aef9934cfc`. Any admitted implementation ports only facts
re-verified live.

Two legacy behaviors are explicitly rejected by the rebuild's fail-loud contract:

- `src/systems/i9/search.ts` warns and skips a malformed short result row. The rebuild throws rather
  than shrinking a real result set into a false no-match.
- `src/systems/i9/signer.ts` converts an access-alert locator failure to count zero. The rebuild
  preserves `unknown/error`; it cannot report a genuine not-found from a failed distinction check.

### D312–D318 workflow-definition acceptance

Applied to I-9 Lookup, the owner text at `1273c360` means:

- its two browser reads and terminal computation are stable-id `task(...)` entries; no other entry
  kind is present;
- it declares no omission/replacement schema and has no write-sensitive assertion/verifier (a
  future writing parent owns its verifier);
- its driver/tasks/login/UI files are genuine behavior additions, so D312 does not classify I-9 as
  reuse-only and those files may not contain workflow glue; and
- I-9 is not a named D316 equivalence fixture; after Person Lookup/Separations delete the old path,
  I-9 cannot recreate it.

## 3. Proof and scenario matrix for a future admitted implementation

| Proof | Required cases |
|---|---|
| T1 structural | Signed modern record; rendered modern record with no Signed Section 2 row; historical redirect; true zero result; visible access-restricted zero result; multiple rows with one eligible action; only incomplete Section 1/2 actions; missing profile/I-9 id; malformed grid row; empty signer cell; audit table timeout; auth/page/schema transient retry; permanent failure; result/probe unknown; subject mismatch; crash after the search checkpoint and checkpoint-resume into summary; crash after summary checkpoint and checkpoint-resume into terminal derivation; restart from start as the same logical item/new attempt, ignoring old read/compute checkpoints and rerunning search, summary, and derivation from pristine input. |
| T1b live | Required by ref workflow-model §1.6.2/ref guards-and-tests under D318's `live-read` arm. Use at least one same-day `available` signer subject that reaches a modern summary and produces a non-empty signed observation, plus any additional truthful registry arms the manifest claims. |
| Generic projection | Start/queue/detail/archive/Explorer conformance rides the workflow compiler suite. I-9 adds no new dashboard capability and therefore no duplicate T2/T3 feature pair. |

An admitted implementation may register a public canary label only after finding a current, access-visible record with an
eligible completed action. Name, SSN and any other person values live in ignored configuration via
`src/domain/secrets.ts`; profile/I-9 identifiers in durable live evidence are redacted according to
the owning field policy. A missing, inaccessible, incomplete, gone, or unknown candidate blocks
before the live workflow starts.

No gate/delegation/join, transaction/idempotency-probe/commit, download or mutable-file branch exists
in this workflow. Those variants are impossible by the declared pure-read graph and must not be
fabricated for coverage. The read-side access-restriction observation remains mandatory. D314
still exposes both recovery choices: checkpoint resume retries from the failed task with valid
ancestors replayed, while restart from start mints the same logical item's next attempt, ignores old
read/compute checkpoints, and reruns every read and computation. Both retain the admitted input;
neither is a different-input run.

### Outcome confidence

| Terminal outcome | Confidence | Required evidence |
|---|---|---|
| `signed` | `verified` | Modern summary, populated audit header, Signed Section 2 row and non-empty Created By cell. |
| `unsigned` | `verified` | Modern summary and populated audit header, with no Signed Section 2 row after the table is confirmed rendered. |
| `historical` | `partial` | Historical route is verified, but the electronic audit surface cannot identify a signer. |
| `not-found` | `verified` | Search completed with zero data rows, the access-restriction observation itself succeeded, and no restriction alert is visible. |
| `unable-to-access` | `partial` | Visible access-restriction alert proves a matching record may exist but prevents signer verification. |
| `error` | `unknown` | Auth, page, selector, schema, access-probe or audit-render failure prevented a trustworthy business outcome. The run fails with that evidence. |

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
  Signed Section 2 selectors were **not** re-verified. A future implementation needs a new same-day
  canary and must not treat the legacy observation as current proof.

## 5. D318 — read-only T1b contract resolved

The operator selected option A on 2026-09-02. I-9 Lookup's T1b declaration uses the explicit
`live-read` arm. Admission requires its compiled graph to contain zero transaction nodes, starts the
ordinary read execution with `dryRun=false`, records the ordinary terminal result/receipt and proves
exact before/after zero deltas in `write_intents`, `write_attempts` and `durable_outbox`. D209 remains
unchanged: requesting transaction preview still refuses `no-transaction-node`. Adding a no-op
transaction, using the preview-result schema or waiving live proof are forbidden. The decision is
ratified; the shared runner/result arm is built, while this unadmitted workflow's T1 pair remains
future implementation work.

## 6. Capability and close evidence

`legacy-workflow-i9-lookup` stays `open` during intake. Its current reason incorrectly calls this a
UCPath read; ref workflow-model §1.6.2 owns the correction: the workflow reads the I-9 system. An
admitted implementation updates the derived capability entry only with the native store/workflow, T1/live evidence, generic projection proof,
and proof that no superseded hand-authored assembly was reintroduced. Production routing remains on
legacy until D89/D93's all-at-once cutover.

## 7. Evidence log

- 2026-09-02 — workflow-specific intake completed; login/search locators verified live; source-pinned
  summary canary found ineligible, so summary/audit verification and implementation remain open for
  a future admitted run.
- 2026-09-02 — amended against ratified D312–D316 owner text at integration commit `1273c360`:
  four workflow artifacts plus behavior-owned store additions, task-only explicit entries, no
  omissions, both recovery choices, and no legacy-authoring escape are now explicit. At that date,
  D209/T1b remained unresolved.
- 2026-09-05 — current routing refresh: D318 resolved the shared T1b mechanism; I-9 remains an
  unnumbered Phase 4 candidate, with no implementation authorization or current canary claim.
