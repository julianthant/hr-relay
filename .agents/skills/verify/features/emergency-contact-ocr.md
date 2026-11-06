# Emergency Contact (OCR)

OCR reads a PDF, groups records and looks up identities; the operator reviews and releases the approved records. Emergency Contact (EC) then delegates each approved record to an EC member that previews that person's primary contact in UCPath.

## Sub-features

- OCR: Reading, Looking up, Verified, Needs lookup, failed-page lines; OCR Review and release; manual mode (blank predefined records).
- EC parent: operation row with record lines in source order; EC members show Previewing/Previewed in a dry run.

## How to get to it (user POV)

Settings → ChatGPT account connected (OCR uses the operator's ChatGPT sign-in). Run → OCR (or Emergency Contact when its source is `served`) → choose a PDF (`config/test-data.json` `files.synthetic-sample-pdf`, synthetic, no HR content) → Confirm → Start.

## Driving it with playwright-cli

Check the source first: `grep emergency-contact config/dashboard-workflow-sources.json`. While it is `mock`, verify OCR alone. Upload with `playwright-cli upload <pdf>` through the launcher. The operator releases the OCR review; do not release or approve for them.

## Passing dry run

OCR reaches the review gate with record lines, then Verified after release. When EC is served: members end Previewed (never Saved), the parent result retains the approved snapshot, and `explain run` shows no Save attempt. A settled mixed-outcome EC parent is immutable and refuses member Retry.

## Gotchas

- Real HR documents are never used for verification; synthetic PDF only.
- `Test OCR` in Settings › Preflight is explicit and spends ChatGPT usage; run it only on operator say-so.
