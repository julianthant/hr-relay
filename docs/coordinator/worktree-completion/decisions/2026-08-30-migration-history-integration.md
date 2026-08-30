# Decisions — remaining shared integration — 2026-08-30

Status: OPEN. No option is selected or authorized. Branch-local work may continue.
Evidence: ../evidence/schema-history-intake.md and the three assigned supervisor inventories.

Answer positionally, for example `1 A, 2 A, 3 B`, or `all recommended` for the three items now
shown. Item1 and its options are unchanged from the earlier sheet; unanswered items stay OPEN.
Items2–3 were added after verified A9/G45 returns, not inferred from silence on item1.

## 1 · Combine the conflicting unmerged migration histories

**Situation.** Three unfinished branches used the same database version numbers for different
schema changes, while their guards call those migrations released and immutable. The inspected
root database is at v18, and all 95 retained authority backups are v18 or earlier; this does not
prove that a divergent database exists nowhere else. A single integrated v19 cannot mean three
different schemas, so clean merges and passing branch-local tests alone cannot settle this.

**Options.**

- **A. Authorize a bounded integration-only normalization after v18.** Preserve all original
  commits, SQL and digest evidence; keep the reporting suffix as the proposed primary sequence and
  append only still-required Settings schema changes in a reviewed suffix. Explicitly dispose of
  superseded Explorer schema rather than silently erasing its history. Ratify the exception in the
  owning migration contract and pin the final sequence. Validate v18 upgrades/fresh databases and
  fail loud for divergent pre-existing suffixes; do not convert a real database under this decision.
  Cost: a narrow exception to the branch guards' declared release history, plus dedicated review
  and refusal tests. This chooses no live runtime or HR gate.
- **B. Preserve all three suffixes as supported released lineages.** Design explicit lineage
  recognition and reviewed forward conversion for each before joining them. Cost: a larger
  authority/migration design and verification run, plus an inventory of any retained divergent
  databases; no claim that one simple renumbering suffices.
- **C. Finish branch-local work but defer shared integration.** Keep commits, worktrees and
  evidence intact while the histories remain separate. Cost: this cannot satisfy the requested
  all-worktree completion and cleanup yet.

**Recommendation.** A, subject to explicit operator approval: the bounded local metadata evidence
supports a narrow integration correction, while preserved source histories and fail-loud handling
keep unknown divergent databases from being silently treated as the selected lineage.

**Notes.** _(operator notes here)_

No approval here provisions R2 secrets, selects/copies a live authority database, approves an HR
ALWAYS-GATE, merges master, pushes to a remote, or authorizes automatic conversion of real data.

## 2 · Keep verified downloads in request-lifetime temporary storage

**Situation.** The current artifact reader loads the entire JSON/base64 file into memory before
returning a stream. Avoiding large payload allocations while checking every byte before success
requires a compatible incremental reader and somewhere private to retain the verified bytes.
This is additional temporary disk use, not a new durable artifact format or retention service.
Evidence: ../reports/dca-shared-proposals-receive.md and the received G45 proposal.

**Options.**

- **A. Approve narrowly private, request-lifetime scratch storage.** Keep the existing stored
  format and task put/open contract. Use exclusive private handles, unlink names before sensitive
  writes on the supported platform, and own cleanup through success, abort, failure and shutdown.
  Fail loud before sensitive writes if unlink fails; any crash-window empty entry is reported and
  retained for exact owned cleanup, not silently swept. Use path-safe INTERNAL_FAILURE/nonretryable
  500 for local preparation failures, never falsely label the source missing/corrupt. After headers,
  a later retained-file/socket fault terminates the transfer and is observed as a delivery failure,
  not a complete download or a retroactive JSON error. Cost: proportional transient disk/I/O and
  a tested platform/cleanup contract. The promised bound is payload buffers per read, not host RSS,
  disk capacity or concurrent-request admission; no invented artifact-size limit.
- **B. Defer this repair and retain both unfinished branches.** No new temporary-storage policy;
  the memory finding and full integration remain open. Cost: the requested completion/cleanup
  cannot finish under the current verified-before-serving requirement.

**Recommendation.** A: it preserves exact verification and the current durable format while
addressing the actual lower-reader allocation, with explicit disposal and failure behavior.

**Notes.** _(operator notes here)_

This does not authorize a persistent cache/spool, broad orphan sweep, altered producer writes,
canonical-JSON-only narrowing, real HR data inspection, or unbounded cleanup fallbacks. If exact
existing-envelope compatibility cannot be met at the agreed seam, return that concrete conflict.
After approval, the owner texts are task-contract §2.3 and frontend-backend-integration artifact
serving/lifetime paragraphs; implementation and tests follow a bounded supervisor brief.

## 3 · Show the origin of an image shared by multiple diagnostic bundles

**Situation.** The unfinished generic capture list deduplicates by artifact id, but drops the
bundle's recorded reason for the capture. The UI contract requires a red frame for a failure
capture. One identical image can belong to several bundles with different origins, so coloring
it from the run's current status or choosing one arbitrary origin would misrepresent evidence.
Evidence: A9's verified query/domain trace and dashboard-surfaces' D19 Receipt capture contract.

**Options.**

- **A. Keep one tile per artifact and show all verified bundle origins.** Add a strict minimal
  projection of bundle id plus closed origin kind for each verified membership; no new actor or
  failure details. Display every origin without an arbitrary winner. Use the required failure
  frame when at least one recorded origin is literally `failure`, while retaining the other
  origin labels and exact download identity. Cost: a small wire/UI extension and mixed-origin
  tests; no longer a lossy single-origin classification.
- **B. Show one tile per bundle/artifact occurrence.** Each tile carries only its own verified
  origin and applies the existing failure-frame rule independently. Cost: identical images can
  repeat and list counts/deduplication behavior change, but no aggregate-origin rule is needed.

**Recommendation.** A: it preserves the existing one-artifact list while exposing all supporting
provenance, instead of losing or guessing the fact that governs the failure frame.

**Notes.** _(operator notes here)_

Either choice is limited to the original DCA3 Receipt consumer and existing indexed authority,
not a new capture producer, a Screenshots tab, or changes to Archive/bundle Gallery colors.
Ratify the chosen presentation in dashboard-surfaces and its strict capture projection in
frontend-backend-integration before treating it as an approved product contract.
