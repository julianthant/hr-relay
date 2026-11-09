# I-9 Check

The public `i9-check-start` workflow reads original I-9 PDFs, waits for document review, checks approved people in UCPath and publishes retention results. `i9-check` and `i9-lookup` run only as children. Lookup has no public catalog entry.

## Current acceptance block

The source is served; live acceptance and operator sign-off are pending. LIVE remains blocked until the operator chooses an acceptance path and the orchestrator issues LIVE GO after Emergency Contact and Onboarding sign-off.

The registered graph and its descendants have no transaction nodes. The planner refuses `dryRun=true` with `dry-run-unsupported`. A source switch does not add preview support. Do not uncheck Dry run or change the planner to complete this walkthrough.

The operator has two choices. Neither choice below authorizes execution by itself.

1. **Ordinary execution with local publication.** The operator explicitly authorizes `dryRun=false` for the selected packet and local destinations. HR systems are read-only, but the run saves a results workbook in the Spreadsheets library and updates the configured tracker file. The tracker sink is a local XLSX destination; it is not another library workbook. Preserve its ownership checks. This path requires an explicit amendment to the verify skill's dry-run-only rule before operation.
2. **Separate preview lane.** Another backend lane implements and verifies the preview contract before this walkthrough runs with `dryRun=true`. That contract must define whether local results and tracker publication are suppressed or previewed, and how dependent steps appear. Do not add a dummy transaction or infer preview behavior from today's ordinary run.

## Required data

- An operator-selected I-9 packet and admitted subject provenance. No I-9 subject is currently declared in `config/test-data.json`. Follow the subject-admission decision before reading private inputs; never substitute another workflow's canary.
- An imported Action History workbook of type `action-history`, keyed by `eid`, with `eid`, `ppsEid`, `separationDate` and `roster.action` fields. Select its named version before Start. The shared reference-type registration comes from Emergency Contact's activation; this feature does not seed types or operator data.
- Any required OCR roster reference must be available through the admitted parent/child planning path. Missing data is a refusal.
- A connected ChatGPT account for subscription OCR and available UCPath and I-9 profiles. The operator completes login and Duo.
- A configured `paths.i9CheckTrackerPath` with valid destination ownership. An existing unowned workbook must remain a conflict.

## Entry and review

Use the store-owning checkout and the runtime checks in [hr-manage](../../hr-manage/SKILL.md). Follow the login and evidence rules in [verify](../SKILL.md). Start no runtime or run before LIVE GO and the acceptance decision above.

Spreadsheets → import and select the reference workbook/version. Run → I-9 Check → attach the original PDFs → Confirm. One batch contains all attached PDFs. Confirm must show the exact PDFs, served reviewer/date, captured reference/version and one planned results workbook with rows determined after review.

The parent Logs groups are **Read and approve PDFs**, **Look up in roster**, and **Check retention and save results**. OCR retains original page coordinates, proposed identity checks and delegated I-9 signer/status results. Stop at every review gate. The operator approves the selected records; the agent never approves a gate.

## Passing ordinary execution after authorization

After the operator releases document review, exactly one `i9-check` child runs per approved person. Its Logs show **Match person**, **Check hire date**, and **Match retention roster**, including honest skipped branches. Each row retains its source sections and captured Action History coordinates. Later reference edits or a changed default cannot replace the captured version.

Open I-9 Lookup from its owning OCR record or linked child run. Its **Look up Section 2 signer** step retains the actual signer/status or the actual missing/restricted outcome. It has no standalone Run or Explorer choice. The parent Explorer timeline follows the registered definition.

The completed parent has one results workbook with a row per approved person and an acknowledged tracker projection. Verify the library origin, row count, workbook receipt and tracker readback. HR records remain unchanged. No UCPath or I-9 submit, external write attempt or submit receipt is allowed. Local publication is a real effect; report it as saved, never Previewed.

## Passing preview after the separate lane

The approved preview implementation must accept `dryRun=true` and preserve that flag in every descendant. Prove the same original-source lineage, captured reference, operator review and read-only child results that its contract admits. Verify local output handling against that contract. An unavailable result stays unavailable. A fabricated workbook receipt or ordinary tracker write cannot stand in for preview evidence.

## Evidence

Keep private evidence under the assigned ignored evidence folder. Retain Confirm, Queue, Records, ordered Logs, Explorer and result screenshots; run and trace IDs; `explain run <runId> --json`; storage after the run; and source-system unchanged proof. Record the acceptance path, actual dry-run flag, local effects, each subject's state and every blocked criterion. A catalog boot or a refused dry run alone is not workflow acceptance.
