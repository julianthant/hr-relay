# DCA joined Receipt phone observer — persistence preparation 06

Status: complete; source left as the corrected observer candidate. No stage, commit, merge,
cleanup, browser, parity, build, coverage, reference, or full gate was run.

## Exact identities

| Artifact | SHA-256 |
| --- | --- |
| Permanent `tests/parity/run-captures.spec.ts` baseline | `fc38171240cce9e478a06e5d65b2011f4f457b71114921d46e9c81078312ea1f` |
| Supplied observer-only patch `dca-joined-receipt-phone-observer-only.patch` | `2cff53dc519e0348930f7e67fbf21a106ff0f4b3ac5668175acf1cc82aa01521` |
| Exact prepared observer candidate (body attachments) | `f5903fa0c1846199bfbecba565547225c11a771038c9682bab5ae89f5ebd25dc` |
| Corrected active observer candidate | `083125910e8ff7d51c18f544ba27a49c70f2b7c59d4ebe2ba65fdf965b064ed7` |
| Generated complete corrected patch used for replay proof | `19a834d33c5ff79e23b50e89786739b1ff2f830f031d5a1a8a8ee8b0d55da901` |
| Reverse replay permanent restoration | `fc38171240cce9e478a06e5d65b2011f4f457b71114921d46e9c81078312ea1f` |
| Preserved diagnostic-05 log | `79f072beadd3c22d95b0133f5768a505c892a43dfd97dd984a334847c13e9f0c` |

The supplied patch applied conceptually from the permanent baseline reconstructs the exact
prepared `f5903fa0…d25dc` bytes. In `/tmp/hr-dca-joined-observer-proof.dRdYiq`, reversing only
the persistence correction then reversing the supplied patch reconstructed the permanent
`fc381712…12ea1f` bytes. A generated complete corrected patch was then applied forward and
reverse: forward reconstructed active `083125910e…b064ed7`, reverse reconstructed permanent
`fc381712…12ea1f`. The repository source stayed active/corrected throughout the reverse proof.

## Persistence and copy plan

For each diagnostic tag (`paper-tile`, `paper-footer`, `graphite-tile`):

- Population JSON: `test.info().outputPath("dca-joined-receipt-phone-${tag}-population.json")`.
- Control JSON: `test.info().outputPath("dca-joined-receipt-phone-${tag}-control-${index}.json")`.
- Viewport screenshot: `test.info().outputPath("dca-joined-receipt-phone-${tag}-viewport.png")`.

Each JSON is serialized with `JSON.stringify(..., null, 2)` and `writeFile(..., "utf8")` before
the unchanged assertion, then attached with `{ path: outputPath, contentType }`. The explicit
viewport screenshot uses `fullPage: false` before the unchanged geometry assertions. Existing
two-rAF settled sampling, predicates, assertions, viewport, waits, and diagnostic-05 evidence
were preserved. Existing rendered a11y evidence remains unchanged.

### Exact parent-owned post-terminal retention procedure

The diagnostic command's natural terminal releases the logical heavy slot. Before restoring the
observer, before another Playwright invocation, and before any runner cleanup, the parent will:

1. Create the unique durable destination
   `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-phone-diagnostic-06/`.
2. Recursively enumerate only files named `dca-joined-receipt-phone-*` under the just-completed
   per-test directories in `tests/parity/.output/`. The two expected tile failures must each have
   one population JSON, two control JSON files, and one viewport PNG (`paper-tile` and
   `graphite-tile`). `paper-footer` files are copied if emitted, but are not required when the
   earlier unchanged paper-tile geometry assertion terminates that test first.
3. Copy each source file byte-for-byte to a destination path that retains its source test-output
   directory basename and filename, so the two tests cannot collide.
4. Write `manifest.json` in the durable destination with the command terminal exit, every source
   path, destination path, byte count, and SHA-256 of both source and copied bytes. Refuse the
   receive if an expected tile file is absent, the copy size differs, or either digest differs.
5. Only after the manifest verifies will the parent restore the exact permanent spec bytes
   `fc38171240cce9e478a06e5d65b2011f4f457b71114921d46e9c81078312ea1f`, then run the required
   separately locked restored typecheck and lint. Copy or verification failure is reported as a
   diagnostic evidence failure and does not authorize a rerun or product edit.

## Gates and git receipt

- `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck` — exit `0`.
- `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint` — exit `0`.
- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
- Index: clean; `git diff --cached --quiet` exit `0`.
- Captured status aggregate immediately before this report: 763 total status lines; 89
  non-coordination lines (excluding `docs/coordinator/**`), SHA-256
  `a462c47b93feb14b9f0a772ea959f90c07793dd30b4cffe0ea24d29bb805b12f`.
- The target source remains intentionally untracked (`?? tests/parity/run-captures.spec.ts`)
  alongside the other shared dirty work; no unrelated path was reverted or staged.
