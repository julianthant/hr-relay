# Emergency Contact (OCR)

Emergency Contact (EC) is a served workflow. It owns its OCR: there is no OCR entry in the sidebar or Run picker, and OCR runs only inside EC as its first Logs steps. OCR reads a PDF, groups records and looks up identities; the operator reviews and releases the approved records. EC then delegates each approved record to an EC member that previews that person's primary contact in UCPath.

## Sub-features

- OCR inside EC: Reading, Looking up, Verified, Needs lookup, failed-page lines; OCR Review and release; manual mode (blank predefined records).
- EC parent: one queue row, operation row with record lines in source order; EC members show Previewing/Previewed in a dry run.

## How to get to it (user POV)

Settings → ChatGPT account connected (OCR uses the operator's ChatGPT sign-in). Run → Emergency Contact → choose a PDF (`config/test-data.json` `files.synthetic-sample-pdf`, synthetic, no HR content) → Confirm → Start with dryRun checked.

## Driving it with playwright-cli

Upload with `playwright-cli upload <pdf>` through the launcher. Stop at the OCR review gate; the operator releases it. Do not release, approve, pick or run Test OCR for them.

## Passing dry run

Logs open with the OCR reading steps, then the OCR review gate with record lines, then Verified after release. After release: members end Previewed (never Saved), the parent result retains the approved snapshot, and `explain run` shows no Save attempt. A settled mixed-outcome EC parent still admits Retry of each eligible failed member. UNKNOWN and a committed or unresolved Save still refuse.

## Gotchas

- Real HR documents are never used for verification; synthetic PDF only.
- `Test OCR` in Settings › Preflight is explicit and spends ChatGPT usage; run it only on operator say-so.
