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
- [done] Review loop — one coder and one reviewer per lane take turns; the reviewer starts at the first local commit, uses the review skill and clears each commit before push; a fresh reviewer replaces it for the final whole-diff read. A workflow PR also passes a live dry run with the operator before it merges.
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

- [done] Emergency Contact member Retry — retry one failed member with an atomic failure hold and superseding accounting.
- [now] Finish in-flight work — merge the macOS-native test baseline.
- [now] Worker custody by construction — the parent owns workers in memory, stops them over IPC, learns of exits from the OS and fences claims by generation; delete leases, stored heartbeats, stop journals and the polled browser control channel. Keep automatic backup and restore; after a restore show one dismiss-only toast with the backup time. Live sign-offs start after this merges.
- [done] Docs and dev tooling — dissolve `docs/rebuild/`, add the AGENTS.md glossary, refresh the repo skills, link `.claude/skills` and add the `verify` skill for live dry runs.
- [now] Assistant agent phase 0 — replace the phrase matcher with a tool-calling agent: free text to ChatGPT, tool plugins under `src/backend/assistant/plugins/`, Employee IDs as references and other typed identifiers masked, confirmed proposals for workflow starts (one or several people, or an attached PDF into OCR), rerun, pause, resume, cancel, notifications and Spreadsheets library setup, chat history with attachments, remove the grant check (Confirm is the authorization), then a model check and a live dry run.
- [next] Assistant phase 1 — serve replies as conversation parts, recognise a typed yes in Relay, apply edits now and undo by asking, add the scenario test harness with token budgets, dock the panel with History and put the Orbit mark in the Sessions bar.
- [next] Assistant phase 2 — serve Activity, view-only navigation, chained steps with stop and retry, and the duplicate guard with pre-flight checks.
- [next] Assistant phase 3 — add the read-only Check in UCPath workflow, evidence on decisions and watcher toasts.
- [next] Assistant phase 4 — add error-pattern insight, the spreadsheet versus UCPath cross-check and PDF batches into OCR.
- [now] Run decision UI — render every served decision through one DecisionCard with Cancel run, show a running pill on the rail, pick a person from the Search results card in Pick mode with an Enter employee ID row, rename runs from the queue row and title PDF runs by file name; ship as one feature PR after the parity refresh.
- [next] Relay app logo — use one mark that pairs with the Orbit assistant mark for the favicon, app icon and sidebar.
- [next] Store repairs — clear crash orphans at startup and read suspect backups at any supported schema, read-only.
- [now] Warnings as toasts — show warnings and failures as short toasts that only notify (a close X, no buttons), sticky when they need acting on; only dialog content, field validation, empty states and the run-log failure card stay inline.
- [now] Sign-up and accounts — require Touch ID and a Duo security key added at duo.ucsd.edu; use a Chromium virtual platform authenticator where the machine has no Touch ID. Keep credentials on logout, put Delete account in Settings > General, resume a signed-in profile after a restart, and let Log out finish while workflows run.
- [next] Person Lookup sign-off — pass a read-only exact-ID live run, fix what it finds in one PR, sign off.
- [next] Separations sign-off — pass a live dry run, fix what it finds in one PR, sign off.
- [next] OCR and Emergency Contact sign-off — serve per-person rows, prove the first live Save with the operator present, sign off.
- [next] OnBase activation — switch to served data, pass a live dry run, update its screenshots, sign off, then refresh the `verify` skill.
- [next] Onboarding activation — switch to served data, pass a live dry run, update its screenshots, sign off.
- [next] I-9 Lookup and Check activation — switch to served data, pass a live dry run, update their screenshots, sign off.
- [next] CRM Document Download activation — switch to served data, pass a live dry run, update its screenshots, sign off.
- [next] Operator preview — complete the full test pass and verify automatic backup and self-repair.

## Simplify the core

Each item deletes its own tests and guards. Worker custody (above) comes first.

- [done] Contract fingerprints — fingerprint each workflow from its own folder, schemas and kit version, bind writes to one app build id and delete the generated manifest; merge before the assistant agent.
- [done] Dead code — remove the restart command, duplicate retry and recover blocks, empty arms, bulk mode, unused stream topics, the parity verifier and browser-roots v1, move step-proof workflows and the scenario registry into tests, and serve HTTP through @hono/node-server.
- [next] Lean run journal — journal only operator commands, write heartbeats as a plain update and derive receipts once.
- [next] Login mutex — hold Duo and OnBase logins with an in-memory parent mutex.
- [next] One schema baseline — squash migrations into one baseline, delete old-format conversions and relocation, and store artifacts as raw bytes.
- [next] Credentials file — keep one encrypted credentials file per person, written atomically, with the keychain key.
- [next] Write-time checks only — drop read-time re-proving and split the authority database, command kernel and claimed-run executor by move.
- [next] Install control — replace installation, admission, registry and continuity proofs with one install-control module and a person-store handle.
- [now] Workflow facts once — declare workflow facts once in a hand-kept registry that replaces the generators; guards stop listing workflows by name.
- [next] Dashboard mocks — delete each workflow's mock at its activation, split LoadedApp before the next activation and drop parity-only mock arms after the assistant agent.
- [next] Tests and guards — keep one line per guard, move behaviour tests out of the architecture suite, scan instead of listing boundary schemas, un-alias merged test files and share one reusable CI workflow.
- [later] UI cleanup — right-size parity to 150-200 states, then move to one UI library in a single UI-only PR.

## Windows, after the Mac is signed off

- [next] Windows support — run the local web app through `relay.cmd` on a restricted Windows laptop without admin rights. Keep Windows file identities exact, fix security-key enrollment, stop cleanly after a Duo attempt, keep setup and start usable at laptop limits, and pass the Windows-native custody tests on the PC.
- [next] Prebuilt Windows bundle — ship a zip with Node, Chromium and dependencies by USB or GitHub Release, with always-on code-only logs and `relay.cmd diagnose`; never clone, install or run tests on the laptop. Then bundle the backend with esbuild.
- [next] Encryption at rest — protect Relay's sensitive data on an unencrypted Windows disk.

## After the dashboard is ready

- [later] Release and cutover — release staging to main and replace the old app.
- [later] Desktop app — package a per-user Windows installer and signed macOS build; install updates only on quit or while idle.
- [later] Removed workflows — build one again only when the operator asks.
- [later] Parked work — re-judge schema baseline and one UI library against the new core.
