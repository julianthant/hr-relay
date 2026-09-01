# Joined DCA integration — DCA4 supervisor report

## Scope and ownership

- Assigned checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- Branch: `feature/dca4-archive-evidence`
- Base HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Index: empty
- Governing skills: `/supervise`, `/ui`, `/review`; Playwright CLI reference read completely.
- No live HR workflow, auth provisioning, migration, push, foreign-tree write, root/integration merge,
  shared materializer weakening, threshold change or broad fallback occurred.

The joined candidate reconciles DCA2's Gallery/Receipt delta with DCA4's Archive evidence work,
preserves generic exact-id, exact diagnostic-bundle and Archive two-id authorities, and includes the
received D291/D292 serving and consumer contracts. J1/J2 merge and authority receipts live at
`evidence/dca-joined-j1-merge-map.md` and `evidence/dca-joined-j2-authority-map.md`.

## Fresh-supervisor intake receipt — 2026-08-31

- Resumed only in the assigned checkout on `feature/dca4-archive-evidence` at exact HEAD
  `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; the index was empty.
- The live 95-entry porcelain status matched the handoff's complete pre-handoff snapshot with no
  differing row. The handoff itself was the one expected new path inside the already-untracked
  `docs/coordinator/` directory.
- The six cited report SHA-256 values were re-derived and matched exactly: fixture owner
  `f9bd2a1f…a927`, oracle `72e91054…92b2`, joined integration `a2cdb0ef…cab6`, Browser13
  `285a0bc4…fba`, Repair16 `75035dfc…8af`, and Repair17 `aff29ddb…4946`. Each exact report was read
  before resuming work; Repair17 is the latest repair authority.
- No surviving process command named this checkout. The checkout-scoped canonical
  `.tracker-rebuild/locks/parity-json-report.lock` and shared `/tmp/hr-dashboard-full-gate.lock`
  both accepted a non-blocking `lockf` probe, so neither an old DCA writer/browser lane nor a full
  gate retained ownership.
- Board mode is `standalone(no board)`. The established coordination workspace is
  `docs/coordinator/worktree-completion/`; this joined report remains the supervisor report. No
  second DCA worktree will be created, and all preserved candidate bytes remain shared work.

## Joined review and light proof

- Initial joined focused lane: 24 files / 494 tests, exit 0.
- Repaired joined focused lane: 25 files / 536 tests, exit 0.
- Final typecheck and lint before the Receipt browser seam: exit 0 under the global light lock.
- Manifest and roadmap freshness, whitespace and index checks: exit 0.
- Complete joined independent axes closed after exact affected re-review. The substantive repairs
  were exact archived-run identity refusal, the Archive evidence opener's coarse target,
  red-capable regressions and four owning-doc accuracy corrections.

Primary logs: `evidence/dca-joined-focused-final.log`,
`evidence/dca-joined-typecheck-final.log`, `evidence/dca-joined-lint-final.log`.

## Receipt browser seam

New test-only files/seams:

- `tests/parity/run-captures.spec.ts`
- `tests/parity/helpers/fixture-run-captures.ts`
- the opt-in receipt route in `tests/parity/helpers/fixture-bff.ts`

The seven scoped cases use the mounted built application, real strict client/parser and ephemeral
HTTP fixture. They cover full and short Receipt, PNG/JPEG/data native downloads against independent
byte-length/SHA-256 oracles, all five closed origin kinds, literal failure framing, exact decoded
dimensions, load/refusal geometry, close-during-load invalidation, keyboard focus-visible/Escape
restoration, coarse 44px ownership/edge/non-overlap, absence without speculative capture fetch, and
Paper Ink/Graphite Warm at desktop and phone. Screenshot and a11y artifacts are ordinary test output,
not new goldens; each a11y output must contain the exact expected region or dialog root.

Independent Receipt test and UI reviews both ended `PASS`; durable receipts are
`reports/dca-joined-receipt-parity-tests-review.md` and
`reports/dca-joined-receipt-parity-ui-review.md`. Focused fixture/UI proof passed 53/53; repeated
locked typecheck/lint passed on the reviewed seam.

The first heavy-lock attempt exited 75 before build/browser because another worktree's healthy full
coverage owned `/tmp/hr-dashboard-full-gate.lock`. This is queue evidence only, not a product result:
`evidence/dca-joined-receipt-parity-01.log`.

## Frozen candidate before browser allocation

At the last pre-browser freeze the candidate had 89 non-coordination changed files. Aggregate recipe:
locale-sort every changed tracked/untracked non-coordination path; hash each row as
`path + NUL + SHA256(file)`; join rows with LF; hash the joined bytes. Result:
`45a2cb93aca3881e3daf2e2ba1b1e4905c38c76285a3ef1ca4b9ec3cba4d866a`.
`git diff --check` passed and the index remained empty.

Receipt-specific reviewed hashes will be refreshed after the final minor review closure and before
the successful scoped command. No product commit is permitted until required full coverage and full
asserted parity are green.

## Completion sequence

The separately locked scoped Receipt, Gallery and Archive browser lanes completed, their screenshot
and a11y output was independently reviewed, and the full ordered acceptance sequence completed with
update mode unset. The candidate was then divided into explicit-path logical local commits. No push,
root merge, live HR action or worktree cleanup occurred.

## Fresh-supervisor completion attempt — 2026-08-31

- Repair18 canonicalized the parity wrapper entrypoint through symlinked checkout paths with a real
  child-process regression. Repair19/20 replaced a comment-bypassable declaration scan with an exact
  TypeScript AST inventory. Repair21 moved wrapper freshness time through `systemClock`. Independent
  Tests, Standards, Correctness, Silent Failures and Security review ended PASS after those repairs.
- Browser22 ran one real asserted Gallery case and proved the JSON reporter retained the body-backed
  required a11y attachment: decoded bytes were valid UTF-8 and the computed digest exactly matched the
  producer annotation. Browser23 then passed the complete scoped Gallery/Archive/Receipt lane, 37/37,
  with 10/10 required a11y bodies digest-matched and 36 scoped references byte-identical. The
  supervisor inspected every distinct preserved desktop/phone render and the named semantic roots;
  no visual or accessibility defect was found. See
  `reports/dca-fresh-browser22-json-recovery.md` and
  `reports/dca-fresh-browser23-scoped-parity.md`.
- Gate24 exposed the closed runtime-environment inventory omissions and one full-suite socket-test
  race. Repairs25/26 registered the exact test-only `TMPDIR`/parity-child environment authority and
  made the real-socket test await the lease-close authority rather than one timing-specific transfer
  observer. Fresh Standards, Tests and Correctness reviews passed.
- Gate27 passed full coverage (338/338 files, 3996/3996 tests; 85.16% statements, 75.43% branches,
  88.57% functions, 87.22% lines), typecheck, lint, roadmap freshness and manifest freshness. Full
  asserted parity ran 271 tests with the update variable unset: 229 expected, 42 unexpected, 0
  skipped, 0 flaky. The JSON body-evidence verifier passed and all 591 reference files remained
  byte-identical. See `reports/dca-fresh-gate27-final-acceptance.md`.
- Independent triage accounts for all 42 failures: 10 descriptor-set metadata hash drifts, 12
  Explorer implementation-fingerprint text drifts, 18 D292 capture-region additions on standard
  Receipt fixtures, and 2 D292 additions on populated Receipt fixtures. The first 22 are a
  pre-existing non-ancestor reference/source mismatch outside this candidate's import closures; the
  latter 20 are the ratified fail-loud live-availability behavior. Stored-reference updates are
  forbidden, and reverting either group would discard unrelated diagnostics or ratified behavior.

Completion is paused before staging or commits on decision sheet
`decisions/2026-08-31-dca-full-parity-authority.md` item 1. The index remains empty and no push,
merge, reference update, live HR action, or cleanup occurred.

Decision item 1 was answered **A** on 2026-08-31. The operator authorized one deliberate exact
reference refresh, review of every resulting delta, and a complete asserted rerun with update mode
unset. That authorization does not permit unrelated reference changes, source reversion, a push,
merge, live HR action, or worktree cleanup.

## Final acceptance and packaging — 2026-08-31

- Refresh28 was the one authorized update-mode run. It produced 81 tracked reference deltas, and
  independent authority plus visual review identified exactly one contaminated transient pair:
  narrow Paper Ink Receipt had captured `Reconnecting` instead of `Live`.
- Repair29 restored that pair to its independently asserted stable state without removing D292's
  capture region. The accepted reference set is exactly 80 modified tracked paths — 50 a11y,
  12 PNG and 18 metadata — plus the 12 new Gallery/Archive feature references. Independent semantic
  and visual review passed the complete set.
- Gate30 ran the full ordered sequence once under one lock with `PARITY_UPDATE` unset. Coverage passed
  338 files / 3,996 tests at 85.15% statements, 75.43% branches, 88.57% functions and 87.21% lines;
  typecheck, lint, roadmap and manifest freshness passed; full parity passed 271 expected with zero
  skipped, unexpected or flaky tests, and its body-backed evidence verifier passed.
- Gate30's first inventory comparison used refresh28's pre-Repair29 inventory. The gate's after
  hashes exactly equal Repair29's reviewed pre-gate hashes, proving this was a baseline-methodology
  error rather than assert-mode mutation. The corrected acceptance report is
  `reports/dca-fresh-gate30-final-acceptance.md`.
- Product and proof were packaged as three logical local commits: `14c259b1` (verified capture
  authority and serving), `da755197` (Archive/Gallery/Receipt presentation and browser proof), and
  `568174e9` (parity evidence authority plus reviewed reference refresh). The coordination record is
  committed separately after this report is finalized.

The parity-authority handoff has been fully consumed: decision 1A is ratified, the authorized path
is complete, all required gates are green, and the surviving state is committed and reported.
