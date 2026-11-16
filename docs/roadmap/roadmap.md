# Relay roadmap

Statuses: `done`, `now`, `next`, `later`. Keep one directive per implementation; track operator preview and live sign-off separately.

## Merging into staging

One line per feature branch. Merged features are in staging; the rest say what they wait for.

- [done] Runs replay, Runs status, Runs process, Settings subscription and usage, Storage health, Processing review, Workers member state — merged.
- [now] Logs failed run — its pull request waits on one failing architecture check: the new sign-in refusal fixtures are missing from the shared fixtures list.
- [now] Onboarding served data — its pull request waits on the same fixtures-list check; the live dry run and operator sign-off are the last ticket.
- [now] Work Study workflow — its pull request waits on one failing unit test whose expected sentence changed; the CI-fix ticket is in review, and the live PayPath dry run follows.
- [now] I-9 served data — its pull request waits on a storage-doctor test that sees no worker commit during its pass (the test baseline ticket); the live dry run and sign-off follow.
- [now] Emergency Contact served data — its pull request waits on a failing Run dialog test (the reference spreadsheet control is missing); typed Employee ID lookup is in review, and the full dry run and sign-off follow.
- [now] Assistant agent — checks are green; it waits only on proof that a copy of the real store upgrades to schema 29, which is running now. The browser check runs on staging after it merges.
- [now] Spreadsheets pin and tags — sits on the Assistant agent pull request, and merges after it; its staging sync is in review.
- [now] CI pipeline — its pull request has a required check cancelled by a newer run; two tickets are left, both waiting on later releases.
- [now] Storage read speed — no pull request yet; the change-log ticket is in review, then planner statistics, the store-copy proof and slow-read events.
- [now] Account Duo re-enrolment — no pull request yet; the routes ticket is in review, then the Settings Security group.
- [now] Timekeeper initials — no pull request yet; the Separations input ticket is in review, then a store-copy upgrade, a live dry run and sign-off.
- [next] Workers session state — no pull request yet; its staging sync is in review and the state replacement follows, after Emergency Contact merges.

## Foundation

- [done] Approved mock dashboard frozen — keep parity screenshots as the visual contract.
- [done] One combined codebase — keep frontend, backend and launch fixes in one codebase.
- [done] Renamed to Relay — use Relay in the app title, README, favicon and repository name.
- [done] AI limited to ChatGPT — use the operator's subscription for OCR and the dashboard assistant.
- [done] Singleton app lock and held operations — keep one app in charge of the runtime and hold maintenance operations until they settle.
- [done] Person Lookup and Separations rerun readiness — use current inputs and readiness checks for reruns.
- [done] Settings Test OCR — run the OCR test from Preflight.
- [done] PR flow — run staging pull request CI on Ubuntu with the macOS-only files, reserve native platform proofs and parity for operator-started full releases, and auto-merge into staging.
- [done] Review loop — one coder and one reviewer per lane take turns; the reviewer starts at the first local commit, uses the review skill and clears each commit before push. Green required checks merge the cleared SHA; there is no final reviewer pass. A workflow PR also passes a live dry run with the operator before it merges.
- [done] Docs and dev tooling — dissolve `docs/rebuild/`, add the AGENTS.md glossary, refresh the repo skills, link `.claude/skills` and add the `verify` skill for live dry runs.
- [next] Functional spec — keep product behaviour in the charter and mechanisms in reference docs.

## Built and wired

- [done] Portable storage core — keep one database and settings per person, simplify Mac safety checks, retain the last three quit-time backups and repair crash or corruption damage automatically without relocating folders.
- [done] Shared dashboard surfaces on served data — serve sessions, activity, inbox, search, spreadsheets and the assistant.
- [done] Workflow logins — use fast-duo for every workflow login.
- [done] Runs — pause and resume at completed steps, rerun failed items from saved results, confirm quitting and park interrupted submits as unknown.
- [done] Pause and Stop — cancel the current step and go back; a step that is writing finishes first, and a failed save settlement parks as unknown instead of pausing.
- [done] Write safety — capture browser steps and submit boundaries, retain dry-run evidence, show UCPath transaction findings for operator review and keep Kuali reload verification.
- [done] Served Explorer matches the mock — build Explorer timelines from served workflow definitions.
- [done] Explorer review spec — serve the generated review spec (run options, page cards, decision outcomes) from each workflow's definition.
- [done] Assistant usable — allowlist reads, make every changing action and workflow start a confirmed proposal, answer ordinary questions through ChatGPT, show the workflow, name, Employee ID and key options on each confirmation card, and run Test assistant from Settings > Preflight.
- [done] Operator dashboard fixes — tidy Settings (nav, theme, storage, account), derive the timekeeper name and initials from the signed-in name, clean Employee ID input, keep worker notices in toasts, fix spreadsheet import size and add Clear run history.
- [done] Readable run logs — show plain steps with no internal names and a failure card with its reason.
- [done] Logs panel decisions — serve each decision's options, answers and who answered, then answer every decision in place in Logs through one DecisionCard with Cancel run.
- [done] Queue rename and PDF titles — title PDF runs by file name, save renames and rename a run from its queue row.
- [done] Sidebar running pill and wordmark — show one running-now pill per workflow on a narrow rail; the sidebar shows the wordmark and the Baton logo stays on sign-up and login.
- [done] Warnings as toasts — show warnings and failures as short toasts that only notify, with no buttons; only dialog content, field validation, empty states and the run-log failure card stay inline.
- [done] Sessions panel — the whole bar opens the panel, and every worker card has one height and keeps its last values when it stops.
- [done] Sessions card data — serve sign-in and Duo state, the unavailable reason, the last step and sessions of a stopped worker, and the last run outcome.
- [done] Dashboard cleanups — make Explorer read-only, have the assistant always ask before acting and propose workflow starts, and save appearance preferences per person.
- [done] Spreadsheet library — retain named versions, bind reference plans to approved snapshots, authenticate SharePoint Sync and publish worksheet archives.
- [done] Built workflows on mock data — CRM Document Download, I-9 Check and Lookup, Onboarding and OnBase import are implemented; each switches to served data in its own activation below.
- [done] Emergency Contact member Retry — retry one failed member with an atomic failure hold and superseding accounting.
- [done] Emergency Contact OCR inline — serve and show the OCR reading as steps inside the Emergency Contact run.
- [done] macOS-native test baseline — keep the native baseline green.

## Workers and storage

Worker custody merges first. Schema changes merge one at a time, in this order: worker custody, reference spreadsheets, assistant.

- [done] Runs get a worker — resume, retry and recover bring back a stopped worker, a restarted dashboard retries an earlier worker, a stale stopped worker never blocks new runs, and a claim re-checks instead of stopping the worker.
- [now] Worker custody by construction — the parent owns workers in memory, stops them over IPC, learns of exits from the OS and fences claims by generation; delete leases, stored heartbeats, stop journals and the polled browser control channel. Keep automatic backup and restore; after a restore show one dismiss-only toast with the backup time. Live sign-offs start after this merges.
- [next] Worker follow-ups — a blocked preflight leaves the worker alive, a refused Resume on a parked run shows its toast, fence targets serve an opaque token instead of a hashed Employee ID, shutdown stops the Duo session and idle memory stays flat, an idle refresh frees its pool slot, `explain run` reads a per-person store, and search matches OCR record names and Employee IDs.
- [now] Settings served data — serve spreadsheet references and status, and keep the ChatGPT connection status and usage automatic with no manual check.
- [next] Reference spreadsheets — workflows declare the fields they need; any spreadsheet that covers them can be picked, several per run, defaulting to the last used; several matches for one person become a decision in the run; remove the library merge.
- [next] Store repairs — clear crash orphans at startup and read suspect backups at any supported schema, read-only.
- [now] Sign-up and accounts — require Touch ID and a Duo security key added at duo.ucsd.edu; use a Chromium virtual platform authenticator where the machine has no Touch ID. Keep credentials on logout, put Delete account in Settings > General, resume a signed-in profile after a restart, and let Log out finish while workflows run.

## New dashboard design

The approved combined mock on `design/dashboard-mock` is the dashboard. Port it once, then wire each area to served data and delete that area's fixtures. A served surface never shows fixture data.

- [next] Design port — merge the approved design into staging in one pull request: rewrite or delete the tests of removed pages and controls, and delete the unreachable old UI.
- [next] Logs panel wiring — serve the identity review with display labels and a short reason, a log for every batch member, pause and stop per member, Rerun with a Records pick and the result label of an answered decision.
- [next] Notifications wiring — the bell swaps the workflow list for notifications; serve command notifications (recovery, command result, bulk result) as Priority items with the needs-you count.
- [next] Run dialog wiring — every workflow takes reference spreadsheets in the Run and Rerun dialogs: several worksheets and a version per spreadsheet, column mappings per worksheet and name-to-ID matching.
- [next] Settings wiring — serve General permissions, Account (Relay account and UCPath sign-in), Subscription (plan and limits), Keyboard bindings and the Spreadsheets list and detail; delete the Storage, Status and Preflight pages.
- [next] Analytics wiring — serve the outcome split, failure steps and typical time per workflow.
- [next] Sessions bar wiring — serve the open state as a view setting, Pause all and Stop all for a group, and the idle refresh countdown.
- [next] Emergency Contact review form — show Employee ID, name, date completed, home address, phones and the Emergency Information half; drop PID and remove Add record.
- [next] Assistant panel wiring — run the floating panel on served conversation parts with typed-yes approval, the full-access mode and History; lands with Assistant phase 1.
- [next] Mock cleanup — delete each area's fixtures and mock flags once served renders the same.

## Workflows live on the Mac

Live sign-offs start after worker custody merges and run one at a time. A workflow is ready after its live dry run and operator sign-off.

- [next] Person Lookup sign-off — pass a read-only exact-ID live run, fix what it finds in one PR, sign off.
- [next] Separations sign-off — pass a live dry run, fix what it finds in one PR, sign off.
- [now] OCR and Emergency Contact sign-off — serve Emergency Contact in the dashboard with per-person rows and a 120-page scan cap, pass the full-scan live dry run, prove the first live Save with the operator present, sign off.
- [next] Typed Employee ID lookup — ask for a typed Employee ID only when Relay cannot find the person.
- [next] OnBase activation — run OnBase as a hidden child step under each Emergency Contact member, remove its sidebar entry, pass a live dry run, update its screenshots, sign off, then refresh the `verify` skill.
- [now] Onboarding activation — switch to served data, pass a live dry run, update its screenshots, sign off.
- [now] I-9 Lookup and Check activation — switch to served data, pass a live dry run, update their screenshots, sign off.
- [next] CRM Document Download activation — switch to served data, pass a live dry run, update its screenshots, sign off.
- [next] Operator preview — complete the full test pass on the new design and verify automatic backup and self-repair.

## Assistant

- [now] Assistant agent phase 0 — replace the phrase matcher with a tool-calling agent: free text to ChatGPT, tool plugins under `src/backend/assistant/plugins/`, Employee IDs as references and other typed identifiers masked, confirmed proposals for workflow starts (one or several people, or an attached PDF into OCR), rerun, pause, resume, cancel, notifications and Spreadsheets library setup, chat history with attachments, remove the grant check (Confirm is the authorization), then a model check and a live dry run.
- [now] Assistant phase 1 — serve replies as conversation parts with usage accounting, structured history, permission tiers and explicit sessions, durable proposal records, a typed yes recognised in Relay with per-row execution, apply edits now and undo by asking, and the scenario test harness with token budgets.
- [later] Assistant phase 2 — serve Activity, view-only navigation, chained steps with stop and retry, and the duplicate guard with pre-flight checks.
- [later] Assistant phase 3 — add the read-only Check in UCPath workflow, evidence on decisions and watcher toasts.
- [later] Assistant phase 4 — add error-pattern insight, the spreadsheet versus UCPath cross-check and PDF batches into OCR.

## Simplify the core

Each item deletes its own tests and guards. Worker custody (above) comes first.

- [done] Contract fingerprints — fingerprint each workflow from its own folder, schemas and kit version, bind writes to one app build id and delete the generated manifest; merge before the assistant agent.
- [done] Dead code — remove the restart command, duplicate retry and recover blocks, empty arms, bulk mode, unused stream topics, the parity verifier and browser-roots v1, move step-proof workflows and the scenario registry into tests, and serve HTTP through @hono/node-server.
- [done] Workflow facts once — declare workflow facts once in a hand-kept registry that replaces the generators; guards stop listing workflows by name.
- [next] Lean run journal — journal only operator commands, write heartbeats as a plain update and derive receipts once.
- [next] Login mutex — hold Duo and OnBase logins with an in-memory parent mutex.
- [next] One schema baseline — squash migrations into one baseline, delete old-format conversions and relocation, and store artifacts as raw bytes.
- [next] Credentials file — keep one encrypted credentials file per person, written atomically, with the keychain key.
- [next] Write-time checks only — drop read-time re-proving and split the authority database, command kernel and claimed-run executor by move.
- [next] Install control — replace installation, admission, registry and continuity proofs with one install-control module and a person-store handle.
- [next] Dashboard mocks — delete each workflow's mock at its activation, split LoadedApp before the next activation and drop parity-only mock arms after the assistant agent.
- [next] Tests and guards — keep one line per guard, move behaviour tests out of the architecture suite, scan instead of listing boundary schemas, un-alias merged test files and share one reusable CI workflow.
- [later] UI cleanup — move to one UI library in a single UI-only PR.

## Windows, after the Mac is signed off

- [next] Windows support — run the local web app through `relay.cmd` on a restricted Windows laptop without admin rights. Keep Windows file identities exact, fix security-key enrollment, stop cleanly after a Duo attempt, keep setup and start usable at laptop limits, and pass the Windows-native custody tests on the PC.
- [next] Prebuilt Windows bundle — ship a zip with Node, Chromium and dependencies by USB or GitHub Release, with always-on code-only logs and `relay.cmd diagnose`; never clone, install or run tests on the laptop. Then bundle the backend with esbuild.
- [next] Encryption at rest — protect Relay's sensitive data on an unencrypted Windows disk.

## After the dashboard is ready

- [later] Release and cutover — release staging to main and replace the old app.
- [later] Desktop app — package a per-user Windows installer and signed macOS build; install updates only on quit or while idle.
- [later] Removed workflows — build one again only when the operator asks.
- [later] Parked work — re-judge schema baseline and one UI library against the new core.
