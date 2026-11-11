# I-9 Check

The public `i9-check-start` workflow reads original I-9 PDFs, waits for document review, checks approved people in UCPath and publishes retention results. `i9-check` and `i9-lookup` run only as children. Lookup has no public catalog entry.

## Acceptance path

Acceptance runs with `dryRun=true`. LIVE remains blocked until the orchestrator issues LIVE GO after Emergency Contact and Onboarding sign-off. Do not switch Dry run off.

A dry run executes every read, review gate and read-only child for real. It previews the results workbook and performs no local publication: nothing is saved to the Spreadsheets library and the tracker file is not touched.

## Required data

- An operator-selected I-9 packet and admitted subject provenance. No I-9 subject is currently declared in `config/test-data.json`. Follow the subject-admission decision before reading private inputs; never substitute another workflow's canary.
- An imported Action History workbook of type `action-history`, keyed by `eid`, with `eid`, `ppsEid`, `separationDate` and `roster.action` fields. Select its named version before Start. The shared reference-type registration comes from Emergency Contact's activation; this feature does not seed types or operator data.
- Any required OCR roster reference must be available through the admitted parent/child planning path. Missing data is a refusal.
- A connected ChatGPT account for subscription OCR and available UCPath and I-9 profiles. The operator completes login and Duo.
- A configured `paths.i9CheckTrackerPath` with valid destination ownership. An existing unowned workbook must remain a conflict.

## Entry and review

Use the store-owning checkout and the runtime checks in [hr-manage](../../hr-manage/SKILL.md). Follow the login and evidence rules in [verify](../SKILL.md). Start no runtime or run before LIVE GO.

Spreadsheets → import and select the reference workbook/version. Run → I-9 Check → attach the original PDFs → Confirm. One batch contains all attached PDFs. Confirm must show the exact PDFs, served reviewer/date, captured reference/version, `Dry run: On` and no planned results workbook.

The parent Logs groups are **Read and approve PDFs**, **Look up in roster**, and **Check retention and save results**. OCR retains original page coordinates, proposed identity checks and delegated I-9 signer/status results. Stop at every review gate. The operator approves the selected records; the agent never approves a gate.

After the operator releases document review, exactly one `i9-check` child runs per approved person. Its Logs show **Match person**, **Check hire date**, and **Match retention roster**, including honest skipped branches. Each row retains its source sections and captured Action History coordinates. Later reference edits or a changed default cannot replace the captured version.

Open I-9 Lookup from its owning OCR record or linked child run. Its **Look up Section 2 signer** step retains the actual signer/status or the actual missing/restricted outcome. It has no standalone Run or Explorer choice. The parent Explorer timeline follows the registered definition.

## Passing preview

Confirm shows Dry run: On. Every descendant run carries `dryRun=true`; prove the original-source lineage, captured reference, operator review and read-only child results. In the parent Logs, the save step reads "Dry run: this save was prepared and checked. Nothing was saved." and the tracker step is unavailable. The parent ends done with a `publication-dry-run-preview` result: `save-workbook` is `publication-preview`, `publish-results` is `unavailable`. Records show each approved person as Verified, never Saved.

Prove no local effect: the Spreadsheets library has no new workbook, the tracker file's modified time and hash are unchanged, and `explain run <runId> --json` shows the `DRY_RUN_PREVIEW` warning with no workbook receipt and no tracker acknowledgement. HR records remain unchanged. A saved workbook, a tracker write or a workflow result on a dry run fails the walkthrough.

## Evidence

Keep private evidence under the assigned ignored evidence folder. Retain Confirm, Queue, Records, ordered Logs, Explorer and result screenshots; run and trace IDs; `explain run <runId> --json`; storage after the run; and source-system unchanged proof. Record the acceptance path, actual dry-run flag, local effects, each subject's state and every blocked criterion. A catalog boot or a refused dry run alone is not workflow acceptance.
