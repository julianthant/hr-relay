# R2 real dashboard inspection — 2026-09-02

Inspected with `playwright-cli` headless session `r2-inspect`, 1440×900 viewport, current served separations fingerprint `955991960b7b388ac4f44e64badd0ce895288797e5eb327bc9d6c5f0ccb7c6f1`. The named session was closed after cancelling the start modal; `playwright-cli list` then reported no browsers. Dashboard stays running. Screenshot files are restricted ignored local artifacts, with hashes in `screenshots.json`; no person values are copied here.

## Direct inspection door

`http://localhost:5174/?day=2026-09-01&run=ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`

The direct URL selects the exact historical run and opens its detail/receipt. Queue workflow selection is separate browser preference: a fresh session initially showed Person Lookup in the left queue while correctly displaying the selected separations run. To align the queue, open **Workflow Panel → Separations**. Then use **Logs** or **Receipt** in the run panel. The selected run can be identified without a person value by trace `sp-155454-ca6a`, attempt 1, and receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`.

| Surface | Verified observation | Local screenshot |
|---|---|---|
| Logs | Rich document/identity/timecard read data renders; Kuali document-number field is 4589. Run header states dry run / partial. | `r2-logs.png` |
| Receipt | Exact receipt and run IDs render, `Partial outcome`, confidence unknown, dry-run banner, observations, actions, verification rows and `DRY_RUN_PREVIEW` warning. | `r2-receipt.png` |
| Run shape | First four steps show read progress; UCPath transaction and Kuali finalization show pending. This run did not execute those downstream writes. | `r2-logs.png` |
| Run data | **Still misleading:** “No run data recorded — this run has not extracted or written any fields yet.” The same screen's Logs/Receipt contain extracted values. Source empty arm: `src/dashboard/surfaces/context-rail.tsx:872`. No UI fix made. | `r2-logs.png`, `r2-receipt.png` |
| Start input | Separations takes Kuali document numbers separated by semicolon or newline; 3–8 digits. One/Two-document examples visible. Person Lookup also startable; UI shows `5 not startable`. | snapshot `r2-start.yml` |
| Options | Customize steps, Dry run, Capture browser screenshots; fixed timekeeper and refuse-overlapping-subject policy; Interactive/Bulk priority; Headless/Headed mode. In this fresh inspection modal **Dry run was unchecked**, screenshots checked, priority Interactive, browser Headed. These are observed current UI values, not permission to execute. | `r2-start-options.png` |
| Steps | 6/6 included. Kuali extraction, Identity check and Job summary checked/locked. Kronos timecard, UCPath transaction and Kuali finalization checked/optional. | `r2-steps.png` |

Start-door inspection used the already named document number only to advance Input → Options → Customize steps → Steps. No omission was changed, no Confirm page was entered, no server plan was confirmed, no run started, and no approval/retry/delete was issued. Cancel dismissed the modal. Durable run count remained 19 and all global write counts remained zero.

Historical outcome: terminal `done` at first transaction `clear-pending`, dry-run preview settled `already-present` **before staging** on 2026-09-02T00:08:15.397Z. Receipt is partial/unknown; `node.clear-pending`, `node.file-termination`, `node.receipt`, `node.finalize-kuali` and `completion.terminal-result` are unknown. This is useful read/gate/UI evidence and does not prove filing/finalization UI execution or current live target availability. Historical fingerprint `0e750f53…` differs from current `95599196…`; no fresh rehearsal occurred.

Runtime/UI residue: Session Panel displayed 0 running, 0 starting, 1 idle, 1 failed, 2 stopped, and one worker needing attention (`lease expired — its process stopped reporting`). These are historical authority-card facts, not new worker processes; R2 started no worker. Browser console's only error was `favicon.ico` HTTP 404; no application rendering error was observed. Storage was healthy/current and spans reconciled 19/19.
