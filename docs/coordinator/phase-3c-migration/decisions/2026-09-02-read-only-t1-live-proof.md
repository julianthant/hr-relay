# Decisions — read-only workflow T1 live proof — 2026-09-02

_Answer positionally: `1 A`, `1 B`, or `1 C + "note"`. Unanswered items stay open._

## 1 · How read-only workflows satisfy T1 live proof

**Situation.** Phase 3c and ref guards-and-tests currently require every workflow to commit a T1 pair: one structural scenario and one live `dryRun=true` manifest. D209, owned by ref workflow-model, deliberately refuses `dryRun=true` when a graph has no transaction node because there is no external write to stop before; person-lookup Search/Match and I-9 lookup are read-only. These contracts cannot both be followed as written, so R3 needs one explicit rule before it can mark either workflow rebuild-ready.

**Options.**

- **A. Generalize T1b to a live execution manifest with two modes.** Transactional workflows keep `dryRun=true`; structurally read-only workflows run normally with `dryRun=false`, while the manifest proves the graph exposes no transaction/mutation capability and the write-safety tables remain at zero. This preserves D209's meaning but requires a small scenario schema/runner and documentation extension.
- **B. Allow `dryRun=true` on read-only graphs.** The kernel would accept the flag and execute the ordinary read-only graph, requiring broader start-plan/result/wire changes and making `dryRun` semantically inert for that class. This gives every T1b the same flag but weakens the current meaning that a dry run stops before a transaction.
- **C. Defer read-only T1b.** Keep both contracts unchanged and land only structural T1a until a later design pass. This avoids immediate platform work but blocks Order 1 rebuild-ready status and therefore the ordered Phase 3c migration sequence.

**Recommendation.** **A.** It preserves D209's safety semantics and still gives every workflow a real live proof; the distinction is explicit in the manifest instead of hidden behind a meaningless flag.

**Notes.** _(your notes here)_
