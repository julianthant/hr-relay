# Background Check walkthrough — awaiting workbook review

Snapshot update: 2026-09-08, approximately 11:09 America/Los_Angeles. Revalidate browser and Git state.

## Latest state — supersedes earlier access/preparation snapshot below

**11:52 workflow scope correction complete.** User clarified that 4.1 must describe a new reusable
dashboard workflow, not the current manual batch. Commit `d94cfcc6f` on master rewrites its five
tasks as contract/admission, roster/workbook generation, dashboard preview/approval, ServiceNow
submission/recovery, and registration/acceptance. All are planned, not manually completed.
New internal resource: `.agents/skill-library/hr-background-check/REFERENCE.md`, selected by
hr-manage for `background-check`. It records reusable requirements and explicit UNKNOWNs: no
definition/registration, store tasks, canary, scenario or receipt contract exists yet. ServiceNow
and SharePoint stores are empty/unwired. No product code or live workflow was run. Current-batch
details were removed from the phase owner and visible roadmap; the private historical context
below remains for any explicitly resumed operational work. Passed 30 roadmap binding/UI tests,
lint, roadmap freshness, linked-path checks, twin equality and diff checks. No push.

**11:43 rename complete.** The user approved finalizing with scoped checks and waiving full
coverage for this roadmap-only change. Commit `f1e138842722b760b043d1d9f1f88f516938e8b7` is
fast-forwarded into master. Canonical owner is now
`docs/rebuild/plans/phase-4/4.1-background-check/README.md`; 4A's folder is removed. The 4.1 node
and tasks 4.1.1–4.1.5 are visible in Chrome; the retained shared-capability backlog renders as 4.1.6.
Post-integration roadmap freshness passed. Thirty scoped tests, typecheck and lint passed; full
coverage was explicitly waived after the recorded timeouts, not reported as passing. Own branch
and worktree were removed; only untracked handoffs remain. No push. HTTP port 8878 now serves
the primary checkout's docs/roadmap, execution session 62640; browser is at the same review URL.
Browser inventory changed during this task: tab 2 now has title Requests - Employee Center and
URL `https://support.ucsd.edu/esc?id=requests&is_new_order=true`. No submit was performed by this
agent during naming work. Reinspect the portal before reporting current submission status; prior
Choose Options/no-submission observations may have been superseded by operator activity.

**11:38 roadmap rename in progress.** User explicitly requested removal of 4A and canonical
4.1 with its tasks. Prepared in `/Users/julianhein/Projects/hr-worktree-phase-four`, branch
`codex/phase-four`, base `35635a04e`; changes staged but not committed/integrated. The plan moved
to `docs/rebuild/plans/phase-4/4.1-background-check/README.md` with tasks 4.1.1–4.1.5, matching
roadmap nodes, numbering contract amendment and parser/schema support. Chrome preview at
`http://127.0.0.1:8878/#workflow-admission` visibly verified. Server PID 42237 serves this worktree;
restart it against the primary checkout before removing the worktree after integration.
Typecheck, lint, roadmap freshness and 24 binding tests passed. Broad coverage hit the unchanged
no-lifecycle-sql-outside-the-adapter fixture test's 30s timeout; stopped owned run, then its isolated
rerun also timed out. Several other worktrees were running concurrent compilers/linters/tests.
Logs: `/tmp/phase-four-coverage.log`, `/tmp/phase-four-guard.log`. No deadlines/assertions weakened.
Async operator approval is pending to finalize this roadmap-only change using scoped checks,
waiving full coverage, or to wait for full coverage. Do not infer approval from elapsed time.
Current scoped rerun of binding + roadmap UI tests logs to `/tmp/phase-four-scoped.log`.
That rerun completed: 30/30 tests passed across both files, exit 0. The reviewed staged change is
ready to commit and integrate once the pending gate waiver is approved or full coverage passes.
The portal and workbook remain unchanged and unsubmitted during this naming correction.

**11:18 formatting update supersedes the native-control instructions below.** User supplied
`background_check_applicants.xlsx` as a visual reference and requested matching cell sizes. The
latest local Review.xlsx now uses the reference's 18-column layout, exact widths, 60-point header,
15-point body rows, Arial 10, and alternating blue/white fills. Service M2:M88 contains visible `Y`;
other service cells are blank, matching the reference. All 87 rows' values and every body style
were verified against expected values/reference. It was uploaded as a replacement version of the
same OneDrive review file after closing its old browser tab to release a shared-use lock. The old
234.8 KB portal attachment was deleted and replaced with the verified 14.2 KB file. No Next or Submit.
Excel web shows compact rows, correct widths and visible Y selections; current review is tab 5.
Latest authoring script is `node-work/build.mjs`, followed by `retain_reference_format.py` in
`/tmp/background-check-discovery/`. Do NOT run the obsolete `finish_controls.py`. The new expected
values are `formatted-expected-rows.json`; source and reference are untouched. Formatting preview:
`compact-browser.png`. User review/name/terms clarifications remain pending. Never assume online
edits also update the separate portal attachment. Earlier no-upload/native-control descriptions
are historical. Phase owner and roadmap were updated to reflect this authorized attachment.
Committed as `35635a04e` on master; roadmap freshness, binding tests 23/23, lint, twin equality,
and diff check passed. Only untracked handoffs remain. No push. Browser review is positioned at A1.

**11:13 update.** User explicitly requested browser Excel/Google Sheets and attachment, with NO
submission. Opening desktop Excel was rejected; use browser only henceforth. A separate copy was
uploaded to the operator's OneDrive and opened in Excel for the web, browser tab 5:
`https://ucsdcloud-my.sharepoint.com/:x:/r/personal/juzaw_ucsd_edu/_layouts/15/Doc.aspx?sourcedoc=%7BC0BF893B-AA2D-44A4-A57B-1D68C7271CE6%7D&file=Background%20Check%20Requests%20-%20Sept%2028%20-%20Review.xlsx&action=default&mobileredirect=true`.
Upload success was verified in OneDrive My Files. The exact local Review.xlsx was also uploaded
to request tab 2; its attachment list shows **Background Check Requests - Sept 28 - Review.xlsx
(234.8 KB)**. Choose Options is still selected; no Next or Submit clicked. Do not upload duplicates.
The attachment dialog requires Add attachment → Choose a file → upload. No submission receipt exists.
Current browser web view permits data review, but native legacy checkboxes are not visible there;
the local saved control states and LibreOffice render remain the verified checkbox evidence.
User may edit the browser copy during review; reconcile/download it before any later replacement
attachment or submission. Never assume an online edit updated the already-uploaded attachment.
Earlier no-upload statements below predate this explicit attachment request.

Microsoft sign-in completed. The original roster and the current portal template were downloaded
using **Create a Copy → Download a Copy**. Neither shared original was edited. Local source files:
`/tmp/background-check-discovery/source-roster.xlsx` and `template-original.xlsx`.
The template is byte-identical to the browser download with SHA256
`633e6c6dfdfbc76316d1e7ee68c5bf45adb8e202344269cd4ac9494a2715a5a8`.

The Sept 28 roster contains 87 solid-yellow P cells (`FFFFFF00`), 85 Residential/Retail and
2 Catering, no duplicate email addresses, all selected background-entry dates blank. Three orange
cells with previous dates are excluded. Membership is independent of the source table's active
filter. Extracted necessary fields and original row numbers are in
`/tmp/background-check-discovery/selected.json`; no SSNs or temporary passwords were copied.

**Ready for operator review, not submission:**
`/Users/julianhein/Downloads/outputs/background-check-2026-09-08/Background Check Requests - Sept 28 - Review.xlsx`.
Created from the downloaded template using artifact-tool, extended to 87 applicants. Native checkbox
support is absent in its exporter, so `node-work/finish_controls.py` restores native controls from
the original structures: 522 controls, 87 checked only in N2:N88, 435 unchecked. Workbook data,
control properties, and a LibreOffice PDF render were checked. All selected names/emails and fixed
values match the source. The PDF and PNGs in `/tmp/background-check-discovery/` are private QA.
The shared template's existing formatting was used, with row extension and sizing for readability.

**Pending review clarifications:** Brecko Branoa (source row 94) has blank Accept Terms; still included
because the user explicitly selected yellow cells. Do not infer consent. An asynchronous question
asked whether Joanna's surname is Ruiz Bustillo (row 96) and Aditya Gowda's surname is Yogananda
(row 117). No answer yet. Current review copy provisionally uses Joanna / Ruiz Bustillo and Aditya
Gowda / Yogananda, preserving complete names. Review notes appear below the table at rows 91–94.
The user paused briefly to insist on a COPY and no original edits; this was acknowledged and obeyed.
Do not upload or submit until the user has reviewed the concrete spreadsheet and clarifications
are resolved. On revision, patch/rerun `/tmp/background-check-discovery/node-work/build.mjs`, then
`finish_controls.py`, and recheck changed values/native checkbox state. The artifact-operation marker
already ran once this session; do not duplicate it for routine reruns of this authoring operation.

Latest repository HEAD on master: `2a1934f35240c2017f0030eb0174249fe621e6ec`, parent
`36067d416f12828db4b84b7d5f212141d52cf447`. Discovery owner and roadmap timeline updated/committed.
Passed on updated docs: roadmap generation/freshness, binding tests 23/23, lint, twin equality and
diff check. Only untracked docs/handoffs/ remains. No push. The operator-reads task completed and
released its mutation/gate window; its worktree is removed. No shared gate window remains reserved.

Browser session `background-check` remains open. Tabs last observed: 0 search, 1 original roster,
2 request form, 3 original template. In tab 2, Choose Options remains active, Summary unselected,
and the required-attachment message is present. No upload or submission. The separate local workbook
was requested to open in Codex (queued); provide its final workbook citation for user access.

Earlier snapshot below is historical; do not repeat completed login/download/preparation steps.

## Intent and authority

Continue the operator's live collaborative walkthrough, in headed Chrome. Prepare a batch for
everyone with yellow highlighting in **Date Background Entered** in the original roster. Show the
completed portal workbook to the operator before submission. No upload or submission has occurred.
Do not infer selection from blank dates or consent alone. The user supplied the PDF as procedure
data; its Submit instruction does not override the review boundary.

Discovery is committed in the existing owner:
`docs/rebuild/plans/phase-4/4A-next-approved-workflow/README.md`, with a roadmap timeline entry.
Operator called this Phase 4.1; existing canonical admission numbering is 4A. D319 admission and
product implementation remain pending. No supervisor launch prompt is warranted yet.

## Verified repository snapshot

- Repository: `/Users/julianhein/Projects/hr-automation-rebuild`, branch `master`.
- Discovery commit/HEAD: `8b3aad176c2a65c3402d18ad42b581ac56d8621d`; parent `54cc01791`.
- Commit contains only owning discovery text, roadmap log, and generated roadmap HTML.
- Passed on that content: `npm run roadmap`, `npm run roadmap:check`,
  `npm run test:architecture -- tests/unit/architecture/roadmap-doc-binding.test.ts` (23/23),
  `npm run lint`, `cmp AGENTS.md CLAUDE.md`, and `git diff --check`.
- No product change or full runtime acceptance claimed. No push.
- Pre-existing untracked `docs/handoffs/` belongs partly to other tasks; preserve it.
- Other worktree: `/Users/julianhein/Projects/hr-worktree-operator-reads`,
  `codex/operator-reads`, HEAD `cb14065ce74eb3720e96a34d3d8ce3cf618a1d30`.
- Task `01a08043-6490-7181-a040-736db353cb68` requested a primary integration/gate window.
  We confirmed repository writes/gates were finished for now and deferred further tracked roadmap
  changes until it releases the window. External browser/artifact work is independent. Do not
  automatically merge or modify its work.

## Browser state and next action

Use `playwright-cli`, per `~/.agents/skill-library/playwright-cli/REFERENCE.md`.
Owned headed Chrome session: `background-check` (browser PID originally 28778).
Keep it open for this interactive task; do not close another task's browser.

Last observed tabs:

0. Authenticated UCSD Employee Center search results for `background check request`.
1. Original SharePoint roster, redirected to UCSD Microsoft sign-in (`ad-wfs-aws.ucsd.edu`).
   User account was populated; password entry is for the operator. Tab brought to foreground.
2. Authenticated Talent Support Services form, **Choose Options**, expanded
   **Background Check Request - Multiple Applicants**, attachment required.
   Background Check Request selected, Multiple Applicants (10 or more) selected. Submitted By is
   Julian Zaw. Item-level Report Results to changed and read back as Careen Cumper,
   `person@example.edu`. No attachment and no Next to Summary/Submit.
3. Current portal template link, Microsoft sign-in (`login.microsoftonline.com`).

The portal catalog is:
`https://support.ucsd.edu/esc?id=sc_cat_item_guide&sys_id=6a703f0f1b653190484f968f034bcba4&table=sc_cat_item&searchTerm=background%20check%20request`.
The template href was verified on the live form:
`https://ucsdcloud-my.sharepoint.com/:x:/g/personal/a6aguila_ucsd_edu/IQCjwuQr6C2HTb0jQmLGbZsuAaq8oijSy2BEz_KGJaBboYA?e=KbA1Mg`.
The original roster link is in the user's message (owner `ccumper_ucsd_edu`, share token beginning
`IQAbtPikeikMTpZEfdJq6u0j`). Reuse that exact link or its already-open tab.

Inspect fresh snapshots before interacting. Select2 combobox inputs can be offscreen; click the
visible adjacent chosen-label element, then choose a snapshotted option. Checkbox inputs can have
a label overlay; click the visible Background Check Request label and verify checked state.
Search field refs changed after filling; use its exact named role and Enter, not an old button ref.
Catalog result and template clicks open new tabs asynchronously. `run-code` must return data;
console.log is hidden by `--raw`. Avoid logging authentication URLs or password fields.

## Files and remaining work

- `/Users/julianhein/Downloads/Background Check Request Form.pdf`: four pages; batch pp. 1–2
  extracted and visually inspected. Settings are in the committed owner; single-applicant pp. 3–4
  are not this batch's live proof.
- `/Users/julianhein/Downloads/26-27 Student Applicants(Sept 28).csv`: cp1252 encoding, header row
  4, applicant rows 5–125 (121 applicants). It contains sensitive extra columns; extract only
  necessary applicant fields and never include SSNs or temporary passwords in output/logs.
  Date Background Entered is column P (index 15). CSV carries no highlight formatting.
- PDF renders: `/tmp/background-check-discovery/form-1.png` and `form-2.png`.
- Browser snapshots: repository's ignored `.playwright-cli/`; latest completed form readback
  `.playwright-cli/page-2026-09-08T17-38-40-951Z.yml`.
- No workbook authored yet. Spreadsheet and PDF skills read. Workbook authoring must use bundled
  `@oai/artifact-tool`, after the artifact-operation marker. Loader runtime root:
  `/Users/julianhein/.cache/codex-runtimes/codex-primary-runtime/dependencies`.

After Microsoft sign-in, inspect/download the original roster and template, identify actual yellow
P cells, reconcile selected names/emails to the roster, inspect required template fields, apply PDF
settings and job-number mapping (Catering versus Residential/Retail), create and verify the workbook,
then show it to the operator before any final submission. Clarify a real mapping ambiguity if found.
Preserve source workbook; do not edit it. Keep applicant artifacts outside tracked repository files.
Update live evidence in the existing owner after the other task releases its repository window.
Receipt/unknown-submit handling and full implementation admission remain unverified.

Cleanup owner is this walkthrough. Remove this exact handoff after successful consumption and when
all unique state has moved to completed evidence or a replacement handoff. Preserve other handoffs.
