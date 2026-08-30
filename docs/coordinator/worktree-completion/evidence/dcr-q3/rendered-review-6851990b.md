# DCR Q3 rendered review — 6851990b

Date: 2026-08-30. Gate HEAD: `6851990b161830b5ad2a532bcdcfa69178a3ede4`.
Reviewer: native `sup_terra`, `gpt-5.6-terra`, high reasoning. Route: `/ui` → UI review → repository asserted parity lane → `view_image`.

## Evidence boundary

`parity-6851990b.log` records fresh asserted parity, exit 0, 265/265 tests. Its reporting subset asserts 30 PNG/a11y/metadata triples: five states × three supported viewports × two themes. No refreeze, reference edit, timeout change, or assertion weakening occurred. The following 10 representative PNGs were inspected with `view_image` only after the passing assertion. They are exact copies of existing references that this candidate matched, not fresh live-HR screenshots; `asserted-copy-proof-6851990b.log` records copy commands, byte comparisons, and hashes. Each PNG has its matching `.a11y.yml` and `.meta.json` beside it.

## Visual findings

Zero findings within these five fixed reporting states and the inspected viewport/theme pairs. This is not a claim that every possible viewport or all content below a screenshot's scroll position was manually viewed.

| State | Paper & Ink, 1440×900 | Graphite Warm, 1024×768 | Observed result |
| --- | --- | --- | --- |
| Activity present | [PNG](asserted-6851990b/activity-report--paper-ink--1440x900.png) | [PNG](asserted-6851990b/activity-report--graphite-warm--narrow-1024x768.png) | 12 runs, 8 distinct people, 7 finished, 2 still open, 20% error (2 of 10 terminal); Unread is explicit. Narrow cards reflow to 2×2 without horizontal overrun. The missing-end-instant duration caveat is visible in the wide view. |
| Activity unavailable | [PNG](asserted-6851990b/activity-report-unavailable--paper-ink--1440x900.png) | [PNG](asserted-6851990b/activity-report-unavailable--graphite-warm--narrow-1024x768.png) | Distinct people is unavailable, not zero; the open explanation names mixed pseudonym key generations and remains legible within the viewport. Its normal overlay is distinct from the underlying summary cards. |
| Comparison ready | [PNG](asserted-6851990b/run-receipt-comparison--paper-ink--1440x900.png) | [PNG](asserted-6851990b/run-receipt-comparison--graphite-warm--narrow-1024x768.png) | Earlier-run heading and withheld-detail explanation are legible; the added Document status value is visible in both. Wide view also shows the removed Assignment note and changed Effective date heading. Narrow stacked view scrolls the target into view; earlier receipt content is above that scroll position, not missing authority. |
| Comparison refused | [PNG](asserted-6851990b/run-receipt-comparison-refused--paper-ink--1440x900.png) | [PNG](asserted-6851990b/run-receipt-comparison-refused--graphite-warm--narrow-1024x768.png) | The refusal alert is legible in both layouts and explicitly preserves the receipt above. It does not substitute an empty/successful comparison. Wide view shows the unchanged Done receipt concurrently. |
| Cross-date search | [PNG](asserted-6851990b/cross-date-search--paper-ink--1440x900.png) | [PNG](asserted-6851990b/cross-date-search--graphite-warm--narrow-1024x768.png) | Modal fits both viewports; measured Separations corpus, Across dates scope, query, one exact durable result, date, parked-gate/dry-run badges, and focused result boundary are legible. Background dimming separates the modal from the dashboard. |

The comparison-ready a11y companion includes Added, Removed, Changed, and `Protected reference Withheld to protect this detail.` The protected row is below the visible screenshot area: its presence is an assertion-backed a11y fact, not a claim of direct visual inspection of that row. Project parity also verifies target-region visibility, unchanged focus during positioning, theme writers, and shell geometry. Search tests assert keyboard result focus and Escape/return-focus behavior; screenshots alone do not establish those interactions.

## Scope and resources

No visual redesign, source edits, live BFF, credential access, HR workflow, or manual browser fleet was used. Full parity owned the headless browsers and isolated fixture/seeded servers and exited 0. Coverage and parity lock holders exited before this review; parent was signaled at the final heavy result. Only report/evidence artifacts were added. The retained historical red remains immutable, and the pre-commit gate-order deviation remains recorded in `reports/dcr-q3.md`.
