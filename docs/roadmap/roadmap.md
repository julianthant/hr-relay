# Relay roadmap

Statuses: `done`, `now`, `next`, `later`. One line per key implementation.

## Foundation

- [done] Approved mock dashboard frozen — parity screenshots define the visual contract.
- [done] One combined codebase — frontend, backend and launch fixes share one codebase.
- [done] Renamed to Relay — app title, README, favicon and repository name.
- [done] AI limited to ChatGPT — OCR and the dashboard assistant use the operator's subscription.
- [done] Singleton app lock and held operations — one app owns the runtime and holds maintenance operations until they settle.
- [done] Person Lookup and Separations rerun readiness — reruns use the current inputs and readiness checks.
- [done] Settings Test OCR — the OCR test runs from Preflight.
- [now] Automatic PR flow — publish history, run cloud CI on macOS and Windows, get Cursor Bugbot review and auto-merge into staging.
- [next] Functional spec — the charter owns product behaviour; reference docs own mechanisms.

## Dashboard ready

Complete these in order.

- [next] Portable storage core — one database and settings per person, simpler safety checks on Mac and Windows, backup and same-person restore, with no folder relocation.
- [next] Sign-up and accounts — require Touch ID and a Duo security key, both added in Duo's device management at duo.ucpath.edu. Use a Chromium virtual platform authenticator where the machine has no Touch ID hardware. Logout keeps credentials. Put Delete account in Settings > General. An empty machine says to sign up first. Back up the old store, then start clean.
- [next] Windows test runner and portability — make Windows checks required.
- [next] Runs — add Pause and Resume, "Pause all and quit" and reruns of failed items only. A crash parks items caught mid-submit as unknown.
- [next] Write safety — take screenshots at every browser step and before and after submit. Dry runs fill the whole workflow with sample values where needed, without submitting. UCPath shows transaction-list findings for the operator to decide. Kuali keeps its reload check.
- [next] OCR and Emergency Contact on the new core — review OCR, save corrections as revisions and feed approved snapshots into Emergency Contact.
- [next] Dashboard cleanups — make Explorer read-only, have the assistant always ask before acting and propose workflow starts, save appearance preferences per person and put Backup/Restore in Settings.
- [next] Operator preview — complete the full test pass and verify a backup before preview.
- [next] Workflow sign-off — Person Lookup live read and sign-off, then Separations dry run and sign-off, then OCR to Emergency Contact dry run and sign-off, then real runs.

## After the dashboard is ready

- [later] Workflow logins — use fast-duo and remove duo-autopilot.
- [later] Shared-laptop access — add a login screen and profile menu.
- [later] Desktop app — package for Mac and Windows with updates.
- [later] Remaining workflows, one at a time — Oath Signature, Oath Upload, OnBase Emergency Contact, I-9 Check, I-9 Lookup, Onboarding, Work-Study, Kronos Pay Rule, CRM Document Download, SharePoint Download, Old Kronos Reports and Background Check.
- [later] Parked work — re-judge schema baseline, one UI library and bundled backend against the new core.
- [later] Release and cutover — release staging to main and replace the old app.
