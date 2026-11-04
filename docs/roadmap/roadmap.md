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
- [done] Automatic PR flow — run staging pull request CI on Ubuntu, reserve native platform proofs for operator-started full releases, require a fresh Codex review before storage, schema or authority changes merge (Claude reviews only on request), and auto-merge the rest into staging.
- [next] Functional spec — keep product behaviour in the charter and mechanisms in reference docs.

## Dashboard ready

Complete these in order on the Mac.

- [done] Portable storage core — keep one database and settings per person, simplify Mac safety checks, retain the last three quit-time backups and repair crash or corruption damage automatically without relocating folders.
- [now] Sign-up and accounts — require Touch ID and a Duo security key, both added in Duo's device management at duo.ucsd.edu. Use a Chromium virtual platform authenticator where the machine has no Touch ID hardware. Keep credentials on logout. Put Delete account in Settings > General. Tell an empty machine to sign up first. Back up the old store, then start clean. Resume a signed-in profile after a restart; Log out ends it. Let Log out finish while workflows run, and keep the login page checking until it completes.
- [done] Workflow logins — use fast-duo for every workflow login.
- [done] Runs — pause and resume at completed steps, rerun failed items from saved results, confirm quitting and park interrupted submits as unknown.
- [done] Write safety — capture browser steps and submit boundaries, retain dry-run evidence, show UCPath transaction findings for operator review and keep Kuali reload verification.
- [now] OCR and Emergency Contact — dry-run preview and fake-driver Save are proven and live selectors are captured; finish the selector fixes, Add record, review retry and per-person rows, then wire production Save.
- [done] Served Explorer matches the mock — make Person Lookup and Separations Explorer read like the approved mock from served workflow definitions.
- [now] Assistant usable — allowlist reads, make every changing action and workflow start a confirmed proposal, show citations and failures, and add Test assistant.
- [now] Operator dashboard fixes — tidy Settings (nav, theme, storage, account), derive the timekeeper name and initials from the signed-in name, clean Employee ID input, keep worker notices in toasts, fix spreadsheet import size and add Clear run history.
- [done] Dashboard cleanups — make Explorer read-only, have the assistant always ask before acting and propose workflow starts, and save appearance preferences per person.
- [done] Spreadsheet library — retain named versions, bind reference plans to approved snapshots, authenticate SharePoint Sync and publish worksheet archives.
- [done] CRM Document Download — package verified PDFs by worksheet with retained reference choices.
- [done] I-9 Check and Lookup — start reviewed PDF batches, delegate person checks and publish retention results.
- [done] Onboarding — start selected roster rows, review hire changes and verify I-9, UCPath and master-workbook writes.
- [done] OnBase import — import PDFs through the child workflow with durable exclusive sessions.
- [now] Duo enrollment — show Duo's real error codes and verify sign-up capture and cancellation on the Mac at duo.ucsd.edu.
- [next] Operator preview — complete the full test pass and verify automatic backup and self-repair before preview.
- [now] Person Lookup and Separations readiness — fix run and session start errors, the worker preflight crash and the read-failure label.
- [next] Workflow sign-off — Person Lookup live read and sign-off, then Separations dry run and sign-off, then OCR to Emergency Contact sign-off after production Save and live selector support, then real runs.

## Windows, after the Mac is signed off

- [next] Windows support — run the local web app through `relay.cmd` on a restricted Windows laptop without admin rights. Keep Windows file identities exact, fix security-key enrollment, stop cleanly after a Duo attempt, keep setup and start usable at laptop limits, and pass the Windows-native custody tests on the PC.
- [next] Prebuilt Windows bundle — ship a zip with Node, Chromium and dependencies by USB or GitHub Release, with always-on code-only logs and `relay.cmd diagnose`; never clone, install or run tests on the laptop. Then bundle the backend with esbuild.
- [next] Encryption at rest — protect Relay's sensitive data on an unencrypted Windows disk.

## After the dashboard is ready

- [later] Desktop app — after the local web app, package a per-user Windows installer and signed macOS build; install updates only on quit or while idle.
- [later] Remaining workflows, one at a time — implement Oath Signature, Oath Upload, Work-Study, Kronos Pay Rule, Old Kronos Reports and Background Check.
- [later] Parked work — re-judge schema baseline and one UI library against the new core.
- [later] Release and cutover — release staging to main and replace the old app.
