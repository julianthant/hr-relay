# Relay roadmap

Statuses: `done`, `now`, `next`, `later`. Keep one directive per implementation; track operator preview and live sign-off separately.

## Foundation

- [done] Approved mock dashboard frozen — keep parity screenshots as the visual contract.
- [done] One combined codebase — keep frontend, backend and launch fixes in one codebase.
- [done] Renamed to Relay — use Relay in the app title, README, favicon and repository name.
- [done] AI limited to ChatGPT — use the operator's subscription for OCR and the dashboard assistant.
- [done] Singleton app lock and held operations — keep one app in charge of the runtime and hold maintenance operations until they settle.
- [done] Person Lookup and Separations rerun readiness — use current inputs and readiness checks for reruns.
- [done] Settings Test OCR — run the OCR test from Preflight.
- [done] Automatic PR flow — publish history, run cloud CI on Ubuntu with macOS for macOS-only tests, get Cursor Bugbot review and auto-merge into staging.
- [next] Functional spec — keep product behaviour in the charter and mechanisms in reference docs.

## Dashboard ready

Complete these in order.

- [done] Portable storage core — keep one database and settings per person, simplify Mac safety checks, retain the last three quit-time backups and repair crash or corruption damage automatically without relocating folders.
- [done] Sign-up and accounts — require Touch ID and a Duo security key, both added in Duo's device management at duo.ucsd.edu. Use a Chromium virtual platform authenticator where the machine has no Touch ID hardware. Keep credentials on logout. Put Delete account in Settings > General. Tell an empty machine to sign up first. Back up the old store, then start clean.
- [done] Workflow logins — use fast-duo for every workflow login.
- [done] Runs — pause and resume at completed steps, rerun failed items from saved results, confirm quitting and park interrupted submits as unknown.
- [done] Write safety — capture browser steps and submit boundaries, retain dry-run evidence, show UCPath transaction findings for operator review and keep Kuali reload verification.
- [now] OCR and Emergency Contact on the new core — review OCR, save corrections as revisions and feed approved snapshots into Emergency Contact.
- [done] Dashboard cleanups — make Explorer read-only, have the assistant always ask before acting and propose workflow starts, and save appearance preferences per person.
- [done] Spreadsheet library — retain named versions, bind reference plans to approved snapshots, authenticate SharePoint Sync and publish worksheet archives.
- [done] CRM Document Download — package verified PDFs by worksheet with retained reference choices.
- [done] I-9 Check and Lookup — start reviewed PDF batches, delegate person checks and publish retention results.
- [done] Onboarding — start selected roster rows, review hire changes and verify I-9, UCPath and master-workbook writes.
- [done] OnBase import — import PDFs through the child workflow with durable exclusive sessions.
- [now] Duo enrollment — verify sign-up capture and cancellation at duo.ucsd.edu.
- [next] SharePoint Download — build the document download workflow.
- [next] Operator preview — complete the full test pass and verify automatic backup and self-repair before preview.
- [next] Workflow sign-off — Person Lookup live read and sign-off, then Separations dry run and sign-off, then OCR to Emergency Contact dry run and sign-off, then real runs.

## After the dashboard is ready

- [later] Windows support — portable storage and required Windows checks.
- [later] Desktop app — package for Mac and Windows; install updates only on quit or while idle.
- [later] Remaining workflows, one at a time — implement Oath Signature, Oath Upload, Work-Study, Kronos Pay Rule, Old Kronos Reports and Background Check.
- [later] Parked work — re-judge schema baseline, one UI library and bundled backend against the new core.
- [later] Release and cutover — release staging to main and replace the old app.
