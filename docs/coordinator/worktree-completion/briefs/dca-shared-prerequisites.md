# Shared DCA prerequisites — bounded proposal assignments

2026-08-30. Coordinator re-sizing under the existing finish-all-worktrees request.
This supersedes the dependency that postponed all shared analysis until both DCA branches had
full green gates. Both component reports are now received; both have an actual generic-route
architecture failure. No gate is waived and no product checkpoint commit is authorized over red.

Profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md
Board: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/board.md
Run plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/run-plan.md
Board write-back: NONE. Existing supervisors and their assigned source checkouts remain the owners.

## Evidence and scope

Coordinator read the retained plan with
`git show integration/03b:docs/plans/2026-08-28-dashboard-completion-runs.md`, DCA1–DCA5
(tool526026). DCA3 explicitly requires run-detail Captures tiles/downloads for already-indexed
artifacts, with verified availability and distinct absence/corruption. This is existing scope,
not permission to add OCR, phone capture or another producer.

Retained DCA3 tip is 7a85bbd596f00ba4052ce1dddd13cd40c8a897ac, based on
eda17b2708286e36542e1e18e9f8ef6a06cf3187. The complete delta changes 63 files, including
historical reference changes, but its ONLY dashboard source change is client/queries.ts
(main1ea059). Source reads5bc5c4/90d672 show verified run-indexed capture queries, availability,
lazy section and an artifactUrl builder, not a delivered surface consumer. Do not treat the
builder/scanner extension as UI completion. Retained commits must survive final integration.

Assigned DCA2 frontend-backend-integration §3.6 explicitly keeps DCA1 generic and DCA2
bundle-bound artifact identities distinct (main8f0df7). Its operator-trust §2.2 requires full
bundle/index/content verification plus selected-artifact re-verification before success and
verified Range416 without bytes. Those guarantees, route-specific errors and Host separation
remain fixed. Current materialization is explicitly not a memory cap.

Main9e60b6 reread shared artifact-bytes.ts: the full authoritative length is allocated before
open/verification. DCA2 selected-byte read and DCA4 archived download both consume it; DCA4
metadata-only verification already avoids assembling a body. No diagnostic-size policy exists
here; the phone-capture cap is not authority to introduce one.

G45 interim source correction, verified by main312029/a26016/2f1821: the real writer itself reads
and decodes the entire stored JSON/base64 payload before returning Readable.from. Spooling that
existing open result cannot bound payload memory. The same READ-ONLY proposal must cover minimum
compatible stored-format reading and actual HTTP abort/HEAD/body lifetime/cleanup; no persistent
format, retention, put-path or public-capability change is implicitly approved. Exact source
hashes and unrun-behavior limits in reports/dca-shared-bytes.md.

## dca-wire-connectivity — DCA4 owns the integration proposal

Assigned source: /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4
Existing supervisor: 01a052ed-f880-7f20-8c9e-8a2f356b9c35
Unique report: docs/coordinator/worktree-completion/reports/dca4-a9-dca3-join-proposal.md

Reuse one appropriate existing native unit under /supervise for READ-ONLY mapping and a bounded
implementation proposal. No new supervisor, checkout, execution batch or review campaign.

- Re-pin received A5–A8 candidate and preserved evidence. Compare retained DCA3 exact delta
  against current DCA4 and READ-ONLY current DCA2 source where overlap matters.
- Trace plan and owning surface contracts to the real run-detail parent/section hook. State
  precisely what retained DCA3 delivers and what remains missing; distinguish native generic
  download/image use from unused URL construction and from Archive or bundle-scoped consumers.
- Propose the smallest completion of the original DCA3 surface and its authority/client join,
  with available/absent/corrupt/missing-byte states and exact run/artifact identity. Do not
  synthesize screenshot dimensions, redaction facts or new producer authority.
- List exact retained commits/files to reconcile by intent, current overlaps, missing tests,
  mounted-consumer/HTTP/browser proof, and the smallest reviewed guard recognition needed.
  Preserve A8 actual Archive credit and complete both-direction accounting. No dummy caller,
  pending exception, route removal, Gallery redirection or literal-only credit.
- Separate historical reference changes from source porting; propose attributable browser
  verification, not blanket snapshot adoption. Preserve current accepted Archive evidence.
- Identify the receive order into BOTH existing DCA checkouts and eventual Git ancestry. No
  merge/cherry-pick, stage, commit, file-copy implementation or foreign-tree write now.

Return a concrete seam/file/proof proposal and any genuine owner conflict. Source, tests,
references, runtime, guards and configuration are READ-ONLY; no tests/lint/build/browser/gate.
Only the supervisor may persist its unique coordination report. No heavy OPEN/NEXT.

## dca-shared-bytes — DCA2 owns the shared-serving proposal

Assigned source: /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca2
Existing supervisor: 01a052ed-f30f-7a53-8afc-e622d361b694
Unique report: docs/coordinator/worktree-completion/reports/dca2-g45-shared-serving-proposal.md

Reuse one appropriate existing native unit under /supervise for READ-ONLY mechanism analysis.
Current G43/G44 receipt is accepted within its stated limits; no new gallery review campaign.

- Map generic, bundle-bound and archived selected-byte consumers, actual HTTP adapter/body
  lifetime, verification-only reads, errors, cancellation and cleanup. Read DCA4 current source
  only as needed; do not write there or overlap its DCA3 consumer proposal.
- Propose bounded-memory serving without an invented diagnostic-size limit and without sending
  success headers/body before required whole-byte/digest checks. Explain the verified-byte
  ownership/lifetime through response completion, read failure and cancellation. Distinguish
  a proven bound from merely replacing one eager allocation with accumulated chunks.
- Preserve complete E29 bundle verification, selected second-pass verification, exact digest,
  size/MIME, route-specific missing/corruption behavior, private cache/Host semantics and verified
  Range416 with no bytes. Do not add live state, migration format or credentials.
- Include the existing Standards-low duplicate success/Range416 response shaping: either one
  shared response seam with exact route parity proof or a justified explicit disposition.
- Name the minimum public/internal contract changes and isolated red-capable tests needed,
  including allocation observation without OOM, corruption/missing/stream errors and cleanup.
  Avoid committing a mechanism before its storage/lifetime authority is established.
- Specify how one implementation owner can prove all three consumers and be received into the
  other branch without parallel shared-file writers. Keep fixture-BFF reconciliation separately
  identified; no full-file fixture copy or changes to Gallery's bundle identity.

Return the concrete mechanism/seams/proof and any unresolved authority choice. No source/test/
guard/reference/config edits, instrumentation, tests/lint/build/browser/gate, stage or commit.
Only the supervisor's unique coordination report may be written. No heavy OPEN/NEXT.

## Continuation boundary

These two READ-ONLY proposals may proceed concurrently in existing isolation. They clear the
mechanism/port-order question; they are not implementation or integration acceptance. Coordinator
receives both, assigns non-overlapping implementation/receive order and explicit test seams, then
required component gates can run on the joined inputs. Full source-preserving integration still
targets integration/03b, not master. Migration history and D75 remain separately unapproved/open.
