# R-DCR authority close report

**Status:** closed on `codex/r-dcr-authority-close`  
**Implementation integration:** `3b36592b89725c5b537d117a15d9cffbc83080d8`  
**Authority reconciliation:** `a6c29d76`  
**Pushes:** none

## Outcome

R-DCR received the prepared reporting/search run and closed DCR1 plus DCR6 under D288/D289. The
integrated result provides bounded current-corpus Separations search, its responsive dashboard
surface, actor-attributed evidenced XLSX export, generation-bound Activity distinct-person
measurement, and strict immutable-receipt rerun comparison.

DCR1 is implemented but honestly unavailable for the present live corpus: all seven current
non-archived Separations rows are ineligible for a D288 backfill (six terminal failures have no
result, and the one completed legacy-preview result has no canonical `approved.emplId`). The
backfill wrote no substitute evidence. Strict storage fixtures prove the populated arm for future
eligible canonical rows.

## Receive and unit ledger

| Seam | Unit evidence | Integration evidence | Result |
|---|---|---|---|
| Prepared receive | prepared tip `1a683c83`; DCR3 `1a8cdc3a`; DCR4 `289b60ad`; DCR5 `1082113c` | `52fd7a47` (`--no-ff`) | Received reviewed search authority/transport, UI and XLSX implementation before authority-close work. |
| DCR1 · D288 authority | final authority `06db1e64` | `17209df6` | Secret-keyed, generation-bound, insert-only pseudonym evidence; strict replay, rotation and backfill refusal arms. |
| DCR1 · Activity projection/UI | UI `cf786082`; real-SQLite scope proof `741a2aca` | `d9b467e5` | Complete-range distinct count only when every served current row has one compatible generation; otherwise a reasoned unavailable arm. `Unread` is unchanged. |
| DCR6 · D289 authority | final authority `eb5c863f` | `d26d1c83` | Closed Separations fact registry and strict selected-run / `retryOf` / prior-current receipt comparison. |
| DCR6 · comparison UI | UI `1d4a32e6`; matrix `1d8346b0`; refusal fix `90cd2ffd`; selected-receipt fix `2368c869` | `8bc658d9` | Responsive, keyboard-reachable `added`, `removed`, `changed`, and relation-free `withheld` states with loud refusal. |
| D75 request identity | authority and migration `80eea7cd` | `3b36592b` | One server-derived `local-operator` checkpoint; command actor mismatches refuse before effects; new XLSX evidence is actor-attributed. |

## Migrations and backfill

- D288 migrations v20–v23 add the generation authority and insert-only
  `activity_person_pseudonyms` evidence. Uniqueness is `(runId, keyGeneration)`; exact replay may
  return canonical evidence, divergent replay refuses, and rotation appends rather than rewrites.
- The reviewed current-corpus backfill found no eligible canonical binding among the seven current
  rows and persisted no pseudonym evidence. Missing, ambiguous, mixed-generation, duplicate and
  incomplete ranges remain visibly unavailable.
- D75 migration v24 adds actor attribution to new XLSX evidence. Historical v1 evidence remains
  explicitly unattributed; v2 requires `requestedBy`. The migration digest is
  `71dd383d16518b329ab1e5d64071646c43bf115619bec8093cc087e08fff511a`.
- The inspected local runtime database remained at schema v18 during review. No ad-hoc migration or
  backfill was forced; ordinary runtime startup owns forward migration.

## Privacy and authority proof

- D288 output carries only aggregate availability/count evidence. Full EIDs, suffixes, pseudonyms,
  key generations, key commitments and secret material do not cross the Activity wire.
- D289 binds comparison to the selected run, its exact `retryOf`, workflow, current receipt and
  server-resolved prior receipt. Only registry-reviewed safe values may cross.
- Protected facts emit `withheld` without a value or an equality/absence relation. Missing,
  duplicate, foreign and mismatched receipt evidence refuses instead of falling back.
- Search and XLSX output omit person identifiers and authority identifiers such as run, trace,
  retry and receipt ids.
- The D75 checkpoint derives one request actor at the BFF boundary. Actor-bearing commands must
  match it; the XLSX request body remains actor-free and the server supplies the evidence actor.

## Gates

The independent final reviewer ran the exact integrated implementation at `3b36592b` and returned
zero findings:

| Gate | Evidence |
|---|---|
| Typecheck | `npm run typecheck` passed. |
| Lint | `npm run lint` passed with zero warnings. |
| Full coverage suite | `npm run test:coverage`: 353/353 files and 3,831/3,831 tests; 84.74% statements, 75.01% branches, 88.43% functions, 86.69% lines. |
| Focused privacy/authority | 115/115 tests passed. |
| D75 focused loop | 74/74 tests passed. |
| Manifest | `npm run build:manifest` completed with zero diff. |
| Rendered parity | `npm run test:parity`: 265/265 references passed. |
| Roadmap | `npm run roadmap:check` passed after authority reconciliation; `docs/roadmap/index.html` is fresh. |
| Diff/worktree | `git diff --check` passed; integration worktree was clean before close docs. |

Representative inspected parity references:

- `tests/parity/references/activity-report--paper-ink--1440x900.png`
- `tests/parity/references/activity-report-unavailable--paper-ink--narrow-1024x768.png`
- `tests/parity/references/run-receipt-comparison--paper-ink--1440x900.png`
- `tests/parity/references/run-receipt-comparison-refused--paper-ink--narrow-1024x768.png`

## Reviews

- D288 and D289 authority units received independent correctness/privacy review; follow-up reviews
  were zero-finding after the selected-receipt and typed-refusal fixes.
- Activity received a separate real-SQLite storage-scope proof and zero-finding review.
- Both frontend units used the UI playbook, complete wide/narrow parity matrices and rendered
  inspection; their final re-reviews were zero-finding.
- D75 received two independent zero-finding reviews.
- The final `sup_sol` integration review covered correctness, silent failure, security/privacy,
  performance, tests and rendered UI, and returned **PASS / CLOSEABLE** with zero findings.

## Sweep and close pointers

The required worktree sweep first classified the five R-DCR/D75 unit worktrees as clean and merged,
then removed those worktrees and deleted their merged branches. No R-DCR/D75 feature worktree or
branch remains. Unrelated DCA, DCC and `a1da` worktrees were left untouched.

The reconciled authority pointers are in `docs/roadmap/roadmap.md` and
`docs/rebuild/reference/operator-trust.md` at `a6c29d76`. The close-only unit ledger is
`docs/plans/dashboard-reporting-board.md`.

## Remaining residue

- Artifact byte serving and screenshot retrieval remain open outside R-DCR.
- DCR1 remains unavailable for the current seven-row corpus by design; a future eligible
  terminal/done row with one exact canonical result may append D288 evidence.
- A credential-derived second actor remains Phase 3d work. D75's current solo-operator authority is
  complete and no longer blocks DCR5.
- Later-workflow facets and exports remain Phase 3c work and must not be inferred from Separations.

