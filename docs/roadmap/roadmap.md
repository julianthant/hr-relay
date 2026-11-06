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
- [done] PR flow — run staging pull request CI on Ubuntu with the macOS-only files, reserve native platform proofs and parity for operator-started full releases, and auto-merge into staging.
- [done] Review loop — the reviewer clears each local commit before push and loops with the coder; a fresh reviewer reads the whole diff before merge. A workflow PR also passes a live dry run with the operator before it merges.
- [next] Functional spec — keep product behaviour in the charter and mechanisms in reference docs.

## Built and wired

- [done] Portable storage core — keep one database and settings per person, simplify Mac safety checks, retain the last three quit-time backups and repair crash or corruption damage automatically without relocating folders.
- [done] Shared dashboard surfaces on served data — serve sessions, activity, inbox, search, spreadsheets and the assistant.
- [done] Workflow logins — use fast-duo for every workflow login.
- [done] Runs — pause and resume at completed steps, rerun failed items from saved results, confirm quitting and park interrupted submits as unknown.
- [done] Write safety — capture browser steps and submit boundaries, retain dry-run evidence, show UCPath transaction findings for operator review and keep Kuali reload verification.
- [done] Served Explorer matches the mock — build Explorer timelines from served workflow definitions.
- [done] Assistant usable — allowlist reads, make every changing action and workflow start a confirmed proposal, answer ordinary questions through ChatGPT, show the workflow, name, Employee ID and key options on each confirmation card, and run Test assistant from Settings > Preflight.
- [done] Operator dashboard fixes — tidy Settings (nav, theme, storage, account), derive the timekeeper name and initials from the signed-in name, clean Employee ID input, keep worker notices in toasts, fix spreadsheet import size and add Clear run history.
- [done] Readable run logs — show plain steps with no internal names and a failure card with its reason.
- [done] Dashboard cleanups — make Explorer read-only, have the assistant always ask before acting and propose workflow starts, and save appearance preferences per person.
- [done] Spreadsheet library — retain named versions, bind reference plans to approved snapshots, authenticate SharePoint Sync and publish worksheet archives.
- [done] Built workflows on mock data — CRM Document Download, I-9 Check and Lookup, Onboarding and OnBase import are implemented; each switches to served data in its own activation below.

## Dashboard ready on the Mac

Complete these in order. A workflow is ready after its live dry run and operator sign-off.

- [now] Finish in-flight work — merge Emergency Contact member Retry (#153), the Duo setup window (#142), restored worker custody (Secure Enclave key across a reboot; blocks live runs) and the macOS-native test baseline.
- [now] Assistant follow-ups — start one workflow for several people with one confirmation, then send attached files to the model and keep them in chat history.
- [now] Sign-up and accounts — require Touch ID and a Duo security key added at duo.ucsd.edu; use a Chromium virtual platform authenticator where the machine has no Touch ID. Keep credentials on logout, put Delete account in Settings > General, resume a signed-in profile after a restart, and let Log out finish while workflows run.
- [next] Person Lookup sign-off — pass a read-only exact-ID live run, fix what it finds in one PR, sign off.
- [next] Separations sign-off — pass a live dry run, fix what it finds in one PR, sign off.
- [next] OCR and Emergency Contact sign-off — serve per-person rows, prove the first live Save with the operator present, sign off.
- [next] Catalog cleanup — remove Work-Study, Kronos Pay Rule, Oath Signature, Oath Upload, Old Kronos Reports and SharePoint Download from the catalog, preflight and docs, and regenerate parity screenshots once with the parity refresh.
- [next] OnBase activation — switch to served data, pass a live dry run, update its screenshots, sign off.
- [next] Onboarding activation — switch to served data, pass a live dry run, update its screenshots, sign off.
- [next] I-9 Lookup and Check activation — switch to served data, pass a live dry run, update their screenshots, sign off.
- [next] CRM Document Download activation — switch to served data, pass a live dry run, update its screenshots, sign off.
- [next] Operator preview — complete the full test pass and verify automatic backup and self-repair.

## Windows, after the Mac is signed off

- [next] Windows support — run the local web app through `relay.cmd` on a restricted Windows laptop without admin rights. Keep Windows file identities exact, fix security-key enrollment, stop cleanly after a Duo attempt, keep setup and start usable at laptop limits, and pass the Windows-native custody tests on the PC.
- [next] Prebuilt Windows bundle — ship a zip with Node, Chromium and dependencies by USB or GitHub Release, with always-on code-only logs and `relay.cmd diagnose`; never clone, install or run tests on the laptop. Then bundle the backend with esbuild.
- [next] Encryption at rest — protect Relay's sensitive data on an unencrypted Windows disk.

## After the dashboard is ready

- [later] Release and cutover — release staging to main and replace the old app.
- [later] Desktop app — package a per-user Windows installer and signed macOS build; install updates only on quit or while idle.
- [later] Removed workflows — build one again only when the operator asks.
- [later] Parked work — re-judge schema baseline and one UI library against the new core.
