_Superseded by `docs/rebuild/reference/operator-trust.md` §5.4, which states what remains after D79a's
trim: two apply levels, presentation-only overrides and a reviewed code-change brief. **Do not implement
anything below.**_

# operator-trust §5.4's rejected DSL-authoring pipeline (design text, trimmed by D79a 2026-07-24)

Was the paragraph headed *(Historical rejected DSL design—do not implement.)* inside §5.4 of
`docs/rebuild/12-operator-trust-and-authoring.md` (later `reference/operator-trust.md`). D79a cut the
DSL authoring mode entirely — every workflow is source-authored, and reconsideration requires a new
explicit operator architecture decision. The design text is kept here so the trim's subject is
legible; it describes a pipeline that was never built and must not be.

*(Historical rejected DSL design—do not implement.)*
A DSL draft runs codegen, typecheck, graph guards, the impacted scenario set, and a clean build in an
isolated output directory. Apply atomically stores the prior DSL/version for rollback, writes the new
DSL+generated artifacts, and requires a controlled server restart; it never loads arbitrary code or
hot-switches execution classes. Rollback restores the exact prior DSL/generated hash and re-runs the
same gates. The editor never rewrites handwritten task/driver code. Enqueued runs retain their
stamped descriptor/config snapshot; only new runs after restart use the activated version. A stale
base fingerprint conflicts and must be rebased.
