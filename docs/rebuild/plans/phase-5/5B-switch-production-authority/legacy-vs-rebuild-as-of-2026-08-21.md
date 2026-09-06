# Legacy vs rebuild (as of 2026-08-21)

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Dated because it is an inventory of a moving world, not a contract.** Re-verified on 2026-08-21
against `config/legacy-capabilities.json`, `src/stores/`, `docs/rebuild/guard-inventory.json` and
the legacy checkout itself; four claims moved and are called out where they sit. The register is the
machine-readable half of the second table — if these disagree, the register wins and this section is
stale.

### Already built — what the rebuild does differently

| Area | Legacy | Rebuild |
|---|---|---|
| Run kernel | Daemon holds state in memory; crash mid-run leaves the row to be inferred | Authority re-read + CAS before **every** transition; lost claim can never terminalize over another owner; every task races an injected deadline |
| Write safety | No fence; a failed save leaves unknown state; a retry can double-file | Seven beats: probe → prepare → subject binding → **durable fence before the click** → commit → read-back proof → settle; uncertainty **parks** with durable intent; same permanent key re-run answers `already-present` in 2 ms |
| Dry run | A flag the workflow honors | On the run's immutable envelope; `commit` structurally absent; zero durable rows **asserted**; and since D238 a rehearsal can no longer wear `verified-done` — the schema makes that pair unrepresentable |
| Evidence | Reconstructed from log files | `RunEvidenceReceipt` = pure function of authority, byte-identical on re-derivation, per-field declared redaction; CLI and dashboard read the same derivation |
| Failures | `error: string` on a span | Structured `FailureRecord` + auto-captured, capture-time-redacted diagnostic bundle, committed with the terminal state |
| Ledger | None | Ordered, actor-attributed, fsync'd, digest-chained; any corruption stops the partition rather than renumbering history |
| Storage | JSONL + SQLite, no backup, no restore | ONE authority DB, SHA-pinned immutable migrations, live backup cadence, byte-verifying doctor, and a restore drilled **every commit** against a real-shaped copy — D181 is what made the path reachable at all, and the operational rehearsal against the real database is precondition P7 |
| Notifications | In-memory React store — reload loses it — **plus a real desktop channel and a voice cue** (`src/dashboard/lib/desktop-notifications.ts`, `src/tracker/alerts/notify.ts`, `src/infra/auth/voice-cue.ts`) | Durable inbox row committed **before** any OS delivery; repeated triggers fold into a count; no free-text, so it structurally cannot leak form contents. **The OS delivery is a declared seam with no implementation** — `OsNotificationDelivery` has no producer anywhere in `src/`, and an absent delivery means "no desktop channel configured", never "delivered". The durability half is ahead; the reach half is behind (second table) |
| Intake | Parse at enqueue, then gone | Durable session → mapping (suggestions can never auto-bind) → validation → **immutable manifest** + N runs + CAS in one transaction; reruns hash-diff |
| Edit Data | Exists | Resume claim IS the fence; edits become authority only by re-parsing through the producing node's own schema |
| Start | Fire-and-forget enqueue | Plan-then-consume; exact raw JSON retained beside canonical — defaults can never erase what you typed |
| Registries | ~10 hand-maintained parallel registries; a typo compiles | ONE `WORKFLOW_MODULES` tuple; stale fingerprint manifest is a red gate |
| Guards | 31 guards, accepted lint debt | **65** active guards (75 inventory entries: 65 active · 8 retired · 2 planned), zero debt, every mechanical arm proven against a violating fixture |

### Where legacy is still ahead (the honest list — this IS the Phase 3 surface)

**This list is derived from the register, not from memory.** `config/legacy-capabilities.json` holds
78 entries and **47 are open** at HEAD — every one owned by `workflow-admission-backlog`, and the
cutover requires zero (`cutoverRequiresZeroOpen: true`, `proxyDispositionAllowed: false`). The 47
split 15 / 32:

**Fifteen legacy workflow directories, none closed.** crm-doc-download · emergency-contact ·
i9-check · i9-lookup · kronos-pay-rule · oath-signature · oath-upload · ocr · old-kronos-reports ·
onbase · onboarding · person-lookup · separations · sharepoint-download · work-study. Two of those
are worth reading twice: **person-lookup is open even though order 0 shipped and ran live**, because
order 1's Search and Match modes have no counterpart for legacy's `crm-search.ts`, `match.ts` and
`outcome.ts`; and **separations is open while its migration is at 8 of 9**, because a capability
closes when the legacy directory is covered, not when a workflow by that name exists here.

**Thirty-two non-workflow capabilities**, by kind:

| kind | n | entries |
|---|---|---|
| route | 14 | ai-assist · base · daemon-stop-instance · files · oath-upload · ocr · ops · screenshots · search · settings · sharepoint · static · workflow-design · workflow-presentation |
| dashboard | 7 | capture · log-panel · navigation · oath-upload · ocr · settings · workflow-modifier |
| export | 3 | export-excel · i9-check-tracker · spreadsheet (incl. the master I-9 retention workbook) |
| maintenance | 3 | ops-clean-tracker · ops-compact-tracker · ops-setup (the setup wizard) |
| codegen | 2 | codegen-export-schemas · workflow-design-build-data-bank |
| cli | 1 | cli-main — legacy's per-workflow subcommands and system probes, including `test-login` |
| dev-tool | 1 | debug-kronos |
| service | 1 | llm |

**In product terms**, that register is: the OCR review/approve UI · the screenshots gallery and the
artifact-bytes route · cross-date search · three Excel export writers · the workflow graph editor and
its data bank · editable settings · the production phone-capture delivery path · LAN mode · the setup
wizard · `test-login` · **the desktop notification channel and voice cue** · and **five system stores
that are declaration-only here** — `i9`, `old-kronos`, `onbase`, `servicenow`, `sharepoint`, each a
session declaration with **zero tasks** (`src/stores/`).

**Four corrections against the 2026-08-20 wording**, each verified rather than assumed:

1. **Five declaration-only stores, not six.** `new-kronos` acquired a real driver, session recipe and
   two task files at separations chunk 1 (D196), so it left the list.
2. **The record-sanity-check AI tool is RETIRED, not deferred to order 8.** The operator retired it on
   2026-08-18 (D192), and the register carries all three advisories as `retired` —
   `tool-ops-sanity-check-record`, `tool-ops-selector-suggest`, `tool-ops-summarize-run`. The gate
   packet's own server-computed deterministic comparison IS the sanity check. What stays OPEN is the
   route and the service that hosted them (`route-ai-assist`, `service-llm`), which is a different
   thing from the feature.
3. **Two matrix rows have no surface at all** — Group People and OCR Review, both `declared-unserved`
   (D184). They are not on the register as their own entries because the register tracks legacy
   capabilities and these are rebuild-side absences; `ref frontend-backend-integration` §10 criterion
   1 is where they are gated.
4. **The desktop notification channel is a genuine legacy-ahead item**, added here for the first time:
   the rebuild's durable inbox is strictly better as a RECORD and currently reaches nobody who is not
   looking at the dashboard.

### What the rebuild will never do, by design

- **Unverified silent fallbacks** — the founding rule; enforced by ratchets run against violating fixtures
- **Selector `.or()` fallback chains** — live re-verification at migration replaces them
- **Per-daemon stdout logs / ~30 bespoke polling hooks / secondary count caches** — one projection, one SSE spine; a second data path cannot disagree with the first
- **Per-action mutation routes / fire-and-forget enqueue** — one idempotent actor-stamped command endpoint
- **Generic retry on a parked write** — only proof-of-presence or operator-confirmed-absence releases one
- **DSL/codegen workflow authoring (D79a)** — selectors, schemas, proof, and graph structure stay code, forever
- **LAN/remote operator mode** — loopback only; the token-scoped phone ingress is the one deny-by-default exception
- **Hosting** (D193) — never deployed to a platform; it runs on your machine. A locally-run app package and a cooperation mode over solo are *later, unplanned* ideas, not a hosted future
- **Legacy change accounting (D150)** — replaced by mandatory live re-verification at each migration
