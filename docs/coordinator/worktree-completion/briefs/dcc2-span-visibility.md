# Supervisor brief — DCC2 storage span visibility

Date: 2026-08-31

Base: `integration/03b` at or after `07cddc88`

Owning authority: `docs/rebuild/reference/dashboard-surfaces.md` §2.5 and §9.8. Read
`docs/coordinator/worktree-completion/reports/dcc2-ui-disposition.md` from the primary checkout for
the accepted provenance if that coordinator-only file is absent from this branch.

## Objective

Close `dcc-storage-span-visibility`. The storage doctor already serves the strict
`StorageDoctorWire.spanAuthority` union, but `DoctorReport` does not render it. Add the smallest
operator-facing presentation that preserves every served arm and never makes degraded or
unavailable evidence look reconciled.

## Required behavior

- Render `reconciled`, `degraded`, and `unavailable` distinctly in the loaded read-only doctor.
- Always show the exact stream/live run counts when the arm carries them and make the archived-run
  accounting reachable.
- For `degraded`, render every problem with its discriminant and safe identifying facts. Preserve
  `missing`, `missing-span`, `malformed-authority`, and `malformed`; preserve source/table,
  `recordKey`/`runId`, and the server-provided redacted summary where present.
- For `unavailable`, name the exact cause code and summary. Do not substitute an empty list,
  reconciled copy, or generic healthy sentence.
- Keep the surface read-only. Add no repair command, restore action, new endpoint, second wire,
  fallback, or backend re-derivation.
- Preserve the existing strict wire schema and identifier/redaction guards.

## Scope and ownership

This is a `/ui` task. Own only the Settings storage-doctor presentation/model seam, its focused
tests and parity/browser proof, the nearest `src/dashboard/AGENTS.md` lesson, and the §9.8 text that
states what the operator sees. Avoid unrelated visual restyling and do not touch DCA Gallery,
Receipt, Archive, diagnostic-bundle, or Run-modal code.

Use `/supervise` for the bounded implementation and review. One writer at a time. You are not alone
in the repository: preserve other sessions' edits and do not reset, rebase, or rewrite shared
history. Keep a clean logical local commit sequence and write the final report to
`docs/coordinator/worktree-completion/reports/dcc2-span-visibility.md`.

## Proof

- Establish a red focused renderer/interaction test before the product edit.
- Pin all three union arms and each degraded problem discriminant. Prove no problem disappears.
- Run focused tests, typecheck, lint, manifest/roadmap freshness where applicable, and
  `git diff --check`.
- Render and inspect the loaded doctor at desktop and narrow/mobile sizes in both themes when the
  changed surface is theme-sensitive. Use the repository parity lane; refresh references only when
  the reviewed source intentionally changes them, then rerun assert mode.
- Coordinate the full-gate lock. If DCA owns the heavy lane, finish focused/light/browser proof and
  wait rather than competing. The coordinator may use final combined integration coverage/parity as
  the full acceptance gate.

## Boundaries

No push, deployment, live HR action, real database conversion, ALWAYS-GATE approval, master merge,
integration merge, branch cleanup, or worktree removal. Return `NEEDS COORDINATOR` only for a real
authority conflict that cannot be resolved from the two owning sections and this brief.
